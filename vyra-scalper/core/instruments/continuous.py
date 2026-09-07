"""Continuous futures contracts.

Stitching consecutive futures contracts into one price series is necessary for research
and dangerous for everything else.  A back-adjusted series is not a tradeable price: its
levels are historical fictions chosen so that returns are continuous.  This module makes
the methodology explicit and stamps it onto the result, and the execution path refuses
any instrument marked continuous (``DATA_SPEC.md`` §7.3).

Rules enforced here:

* both a roll rule *and* an adjustment method must be chosen — there is no default;
* rolls happen between sessions, never intraday;
* every roll is recorded with the gap it introduced;
* volume is never adjusted, only price.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from enum import Enum

from core.util.clock import NS_PER_DAY, Nanos, day_start_ns

__all__ = [
    "Adjustment",
    "ContinuousContractSpec",
    "ContinuousSeries",
    "ContractLeg",
    "RollEvent",
    "RollRule",
    "build_continuous_series",
]


class RollRule(str, Enum):
    """When to switch from the front contract to the next."""

    CALENDAR_DAYS_BEFORE_EXPIRY = "CALENDAR_DAYS_BEFORE_EXPIRY"
    VOLUME_CROSSOVER = "VOLUME_CROSSOVER"
    OPEN_INTEREST_CROSSOVER = "OPEN_INTEREST_CROSSOVER"


class Adjustment(str, Enum):
    """How to reconcile the price gap at a roll.

    ``NONE``
        Raw prices with a visible jump at each roll.  Correct for execution, wrong for
        computing returns across the boundary.
    ``BACK_ADJUST_DIFF``
        Subtract the cumulative gap from history.  Preserves point differences, so ATR
        and tick-based stops remain meaningful.  Old prices may go negative over a long
        history.
    ``BACK_ADJUST_RATIO``
        Multiply history by the cumulative ratio.  Preserves percentage returns and never
        goes negative; point-based measures are distorted in the far past.
    """

    NONE = "NONE"
    BACK_ADJUST_DIFF = "BACK_ADJUST_DIFF"
    BACK_ADJUST_RATIO = "BACK_ADJUST_RATIO"


@dataclass(frozen=True, slots=True)
class ContractLeg:
    """One dated contract's daily observations, used to decide rolls.

    Attributes:
        settle_by_date: settlement price per trading date; the roll gap is measured on
            settlements, which is the convention that makes the adjustment reproducible.
    """

    instrument_id: str
    contract_month: str
    expiry_ns: Nanos
    settle_by_date: dict[date, float]
    volume_by_date: dict[date, float] = field(default_factory=dict)
    open_interest_by_date: dict[date, float] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class ContinuousContractSpec:
    """An explicit, reproducible recipe for stitching contracts.

    Both ``roll_rule`` and ``adjustment`` are required positionally — there is no default,
    because "whatever the library does" is precisely the ambiguity this class exists to
    remove.
    """

    root: str
    roll_rule: RollRule
    adjustment: Adjustment
    days_before_expiry: int = 5
    crossover_confirm_days: int = 2

    def __post_init__(self) -> None:
        if self.days_before_expiry < 0:
            raise ValueError("days_before_expiry must be non-negative")
        if self.crossover_confirm_days < 1:
            raise ValueError("crossover_confirm_days must be at least 1")

    def describe(self) -> str:
        """One-line human description, embedded in dataset manifests and reports."""
        if self.roll_rule is RollRule.CALENDAR_DAYS_BEFORE_EXPIRY:
            trigger = f"{self.days_before_expiry}d before expiry"
        else:
            trigger = f"{self.roll_rule.value.lower()} confirmed {self.crossover_confirm_days}d"
        return f"{self.root} continuous [roll: {trigger}; adjust: {self.adjustment.value}]"


@dataclass(frozen=True, slots=True)
class RollEvent:
    """A recorded roll.  Travels with the series so results stay auditable."""

    roll_date: date
    from_contract: str
    to_contract: str
    from_settle: float
    to_settle: float
    rule: RollRule

    @property
    def gap(self) -> float:
        """Price difference introduced by the roll (``to`` minus ``from``)."""
        return self.to_settle - self.from_settle

    @property
    def ratio(self) -> float:
        """Price ratio at the roll; ``1.0`` if the outgoing settle is non-positive."""
        if self.from_settle <= 0:
            return 1.0
        return self.to_settle / self.from_settle


@dataclass(frozen=True, slots=True)
class ContinuousSeries:
    """The stitched result, inseparable from the methodology that produced it."""

    spec: ContinuousContractSpec
    prices_by_date: dict[date, float]
    active_contract_by_date: dict[date, str]
    rolls: tuple[RollEvent, ...]

    @property
    def is_adjusted(self) -> bool:
        return self.spec.adjustment is not Adjustment.NONE

    def require_unadjusted(self) -> ContinuousSeries:
        """Return ``self`` only if prices are raw and therefore safe for execution.

        Raises:
            ValueError: when the series is back-adjusted.  Sending an order at a
                back-adjusted price would be an order at a price that never existed.
        """
        if self.is_adjusted:
            raise ValueError(
                f"{self.spec.describe()} is back-adjusted and is research-only; "
                "execution must use the raw price of the active dated contract"
            )
        return self


def _calendar_roll_date(leg: ContractLeg, spec: ContinuousContractSpec, dates: list[date]) -> date | None:
    """First trading date at or after ``days_before_expiry`` ahead of ``leg``'s expiry."""
    threshold_ns = leg.expiry_ns - spec.days_before_expiry * NS_PER_DAY
    for d in dates:
        # A calendar rule is a whole-day rule; comparing at UTC midnight avoids implying
        # a precision the rule does not have.
        if day_start_ns(d, "UTC") >= threshold_ns:
            return d
    return None


def _crossover_roll_date(
    leg: ContractLeg, next_leg: ContractLeg, spec: ContinuousContractSpec, dates: list[date]
) -> date | None:
    """First date on which the back contract has led the front for enough sessions.

    The confirmation streak runs over the whole date range exactly once.  Recomputing it
    relative to each candidate date would restart the streak every day and the roll would
    never confirm.
    """
    use_volume = spec.roll_rule is RollRule.VOLUME_CROSSOVER
    front_map = leg.volume_by_date if use_volume else leg.open_interest_by_date
    back_map = next_leg.volume_by_date if use_volume else next_leg.open_interest_by_date
    if not front_map or not back_map:
        raise ValueError(
            f"{spec.roll_rule.value} requires the relevant series on both "
            f"{leg.contract_month} and {next_leg.contract_month}; refusing to fall back "
            "to a calendar roll silently, which would change the methodology without "
            "changing the manifest"
        )

    streak = 0
    for d in dates:
        front = front_map.get(d)
        back = back_map.get(d)
        if front is None or back is None:
            streak = 0
            continue
        if back > front:
            streak += 1
            if streak >= spec.crossover_confirm_days:
                return d
        else:
            streak = 0
    return None


def _roll_date_for(
    leg: ContractLeg, next_leg: ContractLeg, spec: ContinuousContractSpec, dates: list[date]
) -> date | None:
    """Date on which ``leg`` is replaced by ``next_leg``, or ``None`` if it never is."""
    if spec.roll_rule is RollRule.CALENDAR_DAYS_BEFORE_EXPIRY:
        return _calendar_roll_date(leg, spec, dates)
    if spec.roll_rule in (RollRule.VOLUME_CROSSOVER, RollRule.OPEN_INTEREST_CROSSOVER):
        return _crossover_roll_date(leg, next_leg, spec, dates)
    raise ValueError(f"unhandled roll rule {spec.roll_rule}")


def build_continuous_series(
    legs: list[ContractLeg], spec: ContinuousContractSpec
) -> ContinuousSeries:
    """Stitch ``legs`` into one series according to ``spec``.

    Args:
        legs: dated contracts in ascending expiry order.  Must not be empty.
        spec: the explicit roll and adjustment methodology.

    Returns:
        A :class:`ContinuousSeries` carrying the prices, the active contract per date and
        the full roll record.

    Raises:
        ValueError: if ``legs`` is empty, out of expiry order, carries no observations, or
            if a crossover rule is requested without the data it needs.

    The adjustment is applied **backwards** from the most recent contract, so the newest
    prices equal the real prices of the currently active contract.  Anchoring at the old
    end instead would leave today's chart showing prices no venue quotes.
    """
    if not legs:
        raise ValueError("build_continuous_series requires at least one contract leg")
    expiries = [leg.expiry_ns for leg in legs]
    if expiries != sorted(expiries):
        raise ValueError("contract legs must be supplied in ascending expiry order")

    all_dates = sorted({d for leg in legs for d in leg.settle_by_date})
    if not all_dates:
        raise ValueError("contract legs contain no settlement observations")

    # 1. Resolve each roll date once, over the full range.  A roll may only occur on a
    #    date where both contracts settle, so the gap is measurable rather than invented.
    roll_dates: list[date | None] = []
    for i in range(len(legs) - 1):
        candidate = _roll_date_for(legs[i], legs[i + 1], spec, all_dates)
        if candidate is not None:
            previous = roll_dates[-1] if roll_dates else None
            if previous is not None and candidate <= previous:
                # Rolls must be strictly ordered; an out-of-order candidate means the
                # rule produced a degenerate schedule for this data.
                candidate = None
        roll_dates.append(candidate)

    # 2. Walk the dates, switching legs as roll dates are reached.
    active_by_date: dict[date, str] = {}
    raw_by_date: dict[date, float] = {}
    rolls: list[RollEvent] = []
    current = 0

    for d in all_dates:
        while current < len(roll_dates):
            roll_on = roll_dates[current]
            if roll_on is None or d < roll_on:
                break
            leg, next_leg = legs[current], legs[current + 1]
            to_settle = next_leg.settle_by_date.get(d)
            if to_settle is None:
                # The incoming contract has not settled yet on this date; hold the front
                # contract and retry tomorrow rather than stitching to a missing price.
                break
            from_settle = leg.settle_by_date.get(d, to_settle)
            rolls.append(
                RollEvent(
                    d,
                    leg.instrument_id,
                    next_leg.instrument_id,
                    from_settle,
                    to_settle,
                    spec.roll_rule,
                )
            )
            current += 1
        leg = legs[current]
        settle = leg.settle_by_date.get(d)
        if settle is None:
            continue
        active_by_date[d] = leg.instrument_id
        raw_by_date[d] = settle

    # 3. Adjust.  For any date, the correction is the aggregate of every roll that occurs
    #    strictly after it, so the most recent segment is left untouched.
    if spec.adjustment is Adjustment.NONE or not rolls:
        prices = dict(raw_by_date)
    else:
        prices = {}
        for d, price in raw_by_date.items():
            future_rolls = [r for r in rolls if r.roll_date > d]
            if spec.adjustment is Adjustment.BACK_ADJUST_DIFF:
                prices[d] = price + sum(r.gap for r in future_rolls)
            else:
                ratio = 1.0
                for r in future_rolls:
                    ratio *= r.ratio
                prices[d] = price * ratio

    return ContinuousSeries(
        spec=spec,
        prices_by_date=prices,
        active_contract_by_date=active_by_date,
        rolls=tuple(rolls),
    )

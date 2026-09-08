"""Transaction-cost models.

The platform exists to determine whether expectancy survives costs, so these models are
the most consequential code in it.  Three rules follow:

* **Every cost component is reported separately.** Spread cost cannot hide inside
  slippage, and commission cannot hide inside either.  A strategy that trades a two-tick
  spread must show that two-tick spread on its report.
* **Costs are never optimistic by default.** Latency is non-zero, slippage is non-zero,
  and the market-impact model is applied to any order large enough to move the book.
* **Market impact is a model, not a measurement**, and is labelled as such wherever it
  appears (``BACKTEST_SPEC.md`` §4).
"""

from __future__ import annotations

import math
import random
from dataclasses import dataclass
from enum import StrEnum

from core.config.loader import ConfigSection
from core.instruments.instrument import Instrument
from core.util.numeric import round_money

__all__ = [
    "CommissionModel",
    "CommissionType",
    "CostModel",
    "ExecutionCost",
    "LatencyModel",
    "MarketImpactModel",
    "SlippageModel",
    "SlippageType",
]


class CommissionType(StrEnum):
    PER_UNIT = "PER_UNIT"
    FLAT = "FLAT"
    NOTIONAL_BPS = "NOTIONAL_BPS"


class SlippageType(StrEnum):
    FIXED_TICKS = "FIXED_TICKS"
    SPREAD_FRACTION = "SPREAD_FRACTION"
    VOLATILITY_SCALED = "VOLATILITY_SCALED"


@dataclass(frozen=True, slots=True)
class ExecutionCost:
    """The full cost of one execution, itemised.

    ``total`` is the only figure that should ever be netted against PnL; the components
    exist so that a cost problem can be attributed to the right cause.
    """

    commission: float = 0.0
    exchange_fees: float = 0.0
    spread_cost: float = 0.0
    slippage_cost: float = 0.0
    impact_cost: float = 0.0
    slippage_ticks: float = 0.0
    impact_ticks: float = 0.0

    @property
    def total(self) -> float:
        return round_money(
            self.commission
            + self.exchange_fees
            + self.spread_cost
            + self.slippage_cost
            + self.impact_cost
        )

    @property
    def explicit(self) -> float:
        """Costs that appear on a broker statement."""
        return round_money(self.commission + self.exchange_fees)

    @property
    def implicit(self) -> float:
        """Costs paid to the market, which no statement itemises."""
        return round_money(self.spread_cost + self.slippage_cost + self.impact_cost)

    def to_dict(self) -> dict[str, float]:
        return {
            "commission": round_money(self.commission),
            "exchange_fees": round_money(self.exchange_fees),
            "spread_cost": round_money(self.spread_cost),
            "slippage_cost": round_money(self.slippage_cost),
            "impact_cost": round_money(self.impact_cost),
            "slippage_ticks": round(self.slippage_ticks, 6),
            "impact_ticks": round(self.impact_ticks, 6),
            "explicit": self.explicit,
            "implicit": self.implicit,
            "total": self.total,
        }


@dataclass(frozen=True, slots=True)
class CommissionModel:
    """Per-instrument commission with an optional minimum and maximum."""

    commission_type: CommissionType = CommissionType.PER_UNIT
    amount: float = 0.0
    minimum: float = 0.0
    maximum: float | None = None

    def compute(self, instrument: Instrument, quantity: float, price: float) -> float:
        if quantity <= 0:
            return 0.0
        if self.commission_type is CommissionType.PER_UNIT:
            raw = self.amount * quantity
        elif self.commission_type is CommissionType.FLAT:
            raw = self.amount
        else:
            notional = instrument.notional(price, quantity)
            raw = notional * self.amount / 10_000.0
        raw = max(raw, self.minimum)
        if self.maximum is not None:
            raw = min(raw, self.maximum)
        return round_money(raw)


@dataclass(frozen=True, slots=True)
class SlippageModel:
    """Adverse price movement between decision and fill, beyond the spread.

    Deterministic given a seed: the same run produces the same slippage, which is what
    makes a backtest reproducible while still being non-zero.
    """

    slippage_type: SlippageType = SlippageType.SPREAD_FRACTION
    fixed_ticks: float = 1.0
    spread_fraction: float = 0.5
    volatility_coefficient: float = 0.1
    seed: int = 0

    def ticks(
        self,
        instrument: Instrument,
        spread: float | None,
        atr: float | None = None,
        participation: float = 0.0,
        rng: random.Random | None = None,
    ) -> float:
        """Expected adverse slippage in ticks.  Always non-negative."""
        tick = instrument.tick_size
        if self.slippage_type is SlippageType.FIXED_TICKS:
            base = self.fixed_ticks
        elif self.slippage_type is SlippageType.SPREAD_FRACTION:
            spread_ticks = (spread / tick) if spread and spread > 0 else 1.0
            base = spread_ticks * self.spread_fraction
        else:
            atr_ticks = (atr / tick) if atr and atr > 0 else 1.0
            base = self.volatility_coefficient * atr_ticks * math.sqrt(max(0.0, participation))

        if rng is not None:
            # Symmetric jitter around the expectation.  Slippage is not constant, and a
            # strategy whose edge depends on it being constant should fail visibly.
            base *= 1.0 + rng.uniform(-0.5, 0.5)
        return max(0.0, base)

    def cost(self, instrument: Instrument, quantity: float, slippage_ticks: float) -> float:
        return round_money(slippage_ticks * instrument.tick_value * quantity)


@dataclass(frozen=True, slots=True)
class MarketImpactModel:
    """Square-root market impact.

    ``impact = coefficient * sigma * sqrt(participation)``, applied only above a
    participation threshold.

    This is a **model, not a measurement.**  The square-root law is a well-supported
    empirical regularity in aggregate, but the coefficient for any specific instrument and
    order profile is unknown until measured against real fills.  Every report that
    includes impact says so.
    """

    enabled: bool = True
    coefficient: float = 0.1
    threshold_participation: float = 0.01

    def ticks(
        self,
        instrument: Instrument,
        quantity: float,
        reference_volume: float | None,
        atr: float | None,
    ) -> float:
        if not self.enabled or quantity <= 0:
            return 0.0
        if not reference_volume or reference_volume <= 0:
            # No volume reference means participation is unknown.  Returning zero here is
            # a known optimism, so it is surfaced by the report's cost-coverage line
            # rather than hidden.
            return 0.0
        participation = quantity / reference_volume
        if participation < self.threshold_participation:
            return 0.0
        atr_ticks = (atr / instrument.tick_size) if atr and atr > 0 else 1.0
        return self.coefficient * atr_ticks * math.sqrt(participation)

    def cost(self, instrument: Instrument, quantity: float, impact_ticks: float) -> float:
        return round_money(impact_ticks * instrument.tick_value * quantity)


@dataclass(frozen=True, slots=True)
class LatencyModel:
    """Simulated latencies, in microseconds.

    Defaults are non-zero.  A zero-latency configuration is available for diagnosis and
    marks the run ``IDEALISED`` so it cannot be mistaken for a tradeable result
    (``BACKTEST_SPEC.md`` §6).
    """

    market_data_latency_us: float = 800.0
    order_latency_us: float = 1500.0
    cancel_latency_us: float = 1500.0
    ack_latency_us: float = 1200.0
    jitter_us: float = 300.0

    @property
    def is_idealised(self) -> bool:
        return (
            self.market_data_latency_us <= 0
            and self.order_latency_us <= 0
            and self.cancel_latency_us <= 0
        )

    def _jittered(self, base_us: float, rng: random.Random | None) -> int:
        value = base_us
        if rng is not None and self.jitter_us > 0:
            value += rng.uniform(-self.jitter_us, self.jitter_us)
        return int(max(0.0, value) * 1_000)  # microseconds -> nanoseconds

    def market_data_ns(self, rng: random.Random | None = None) -> int:
        return self._jittered(self.market_data_latency_us, rng)

    def order_ns(self, rng: random.Random | None = None) -> int:
        return self._jittered(self.order_latency_us, rng)

    def cancel_ns(self, rng: random.Random | None = None) -> int:
        return self._jittered(self.cancel_latency_us, rng)

    def ack_ns(self, rng: random.Random | None = None) -> int:
        return self._jittered(self.ack_latency_us, rng)

    def to_dict(self) -> dict[str, float]:
        return {
            "market_data_latency_us": self.market_data_latency_us,
            "order_latency_us": self.order_latency_us,
            "cancel_latency_us": self.cancel_latency_us,
            "ack_latency_us": self.ack_latency_us,
            "jitter_us": self.jitter_us,
        }


class CostModel:
    """Combines commission, fees, spread, slippage and impact for one venue."""

    __slots__ = (
        "_commissions",
        "_default_commission",
        "_default_fee",
        "_fees",
        "_impact",
        "_slippage",
    )

    def __init__(
        self,
        default_commission: CommissionModel,
        commissions: dict[str, CommissionModel] | None = None,
        default_fee: float = 0.0,
        fees: dict[str, float] | None = None,
        slippage: SlippageModel | None = None,
        impact: MarketImpactModel | None = None,
    ) -> None:
        self._default_commission = default_commission
        self._commissions = commissions or {}
        self._default_fee = default_fee
        self._fees = fees or {}
        self._slippage = slippage or SlippageModel()
        self._impact = impact or MarketImpactModel()

    @property
    def slippage_model(self) -> SlippageModel:
        return self._slippage

    @property
    def impact_model(self) -> MarketImpactModel:
        return self._impact

    def commission_for(self, instrument_id: str) -> CommissionModel:
        return self._commissions.get(instrument_id, self._default_commission)

    def fee_for(self, instrument_id: str) -> float:
        return self._fees.get(instrument_id, self._default_fee)

    def compute(
        self,
        instrument: Instrument,
        quantity: float,
        fill_price: float,
        *,
        spread: float | None = None,
        crossed_spread: bool = True,
        atr: float | None = None,
        reference_volume: float | None = None,
        rng: random.Random | None = None,
    ) -> ExecutionCost:
        """Itemise the cost of one execution.

        Args:
            crossed_spread: whether this fill paid the spread (an aggressive order) or
                earned it (a passive fill).  Passive fills carry no spread cost, which is
                the whole economic point of resting an order — and the reason a fill model
                must not treat every limit order as filled.
        """
        commission = self.commission_for(instrument.instrument_id).compute(
            instrument, quantity, fill_price
        )
        fees = round_money(self.fee_for(instrument.instrument_id) * quantity)

        spread_cost = 0.0
        if crossed_spread and spread and spread > 0:
            half_spread_ticks = (spread / instrument.tick_size) / 2.0
            spread_cost = round_money(half_spread_ticks * instrument.tick_value * quantity)

        participation = (
            quantity / reference_volume if reference_volume and reference_volume > 0 else 0.0
        )
        slippage_ticks = self._slippage.ticks(instrument, spread, atr, participation, rng)
        slippage_cost = self._slippage.cost(instrument, quantity, slippage_ticks)

        impact_ticks = self._impact.ticks(instrument, quantity, reference_volume, atr)
        impact_cost = self._impact.cost(instrument, quantity, impact_ticks)

        return ExecutionCost(
            commission=commission,
            exchange_fees=fees,
            spread_cost=spread_cost,
            slippage_cost=slippage_cost,
            impact_cost=impact_cost,
            slippage_ticks=slippage_ticks,
            impact_ticks=impact_ticks,
        )

    @classmethod
    def from_config(cls, section: ConfigSection) -> CostModel:
        """Build from the ``execution.yaml`` cost blocks."""

        def commission_from(spec: dict[str, object]) -> CommissionModel:
            return CommissionModel(
                commission_type=CommissionType(str(spec.get("type", "PER_UNIT"))),
                amount=float(spec.get("amount", 0.0)),  # type: ignore[arg-type]
                minimum=float(spec.get("minimum", 0.0)),  # type: ignore[arg-type]
                maximum=float(spec["maximum"]) if spec.get("maximum") is not None else None,  # type: ignore[arg-type]
            )

        comm = section.section("commission")
        default_commission = commission_from(comm.section("default").data)
        overrides = {
            iid: commission_from(spec)
            for iid, spec in (comm.section("overrides", required=False).data or {}).items()
            if isinstance(spec, dict)
        }

        fee_section = section.section("exchange_fees", required=False)
        default_fee = fee_section.float_("default", 0.0)
        fee_overrides = {
            str(k): float(v)
            for k, v in (fee_section.section("overrides", required=False).data or {}).items()
        }

        slip = section.section("slippage", required=False)
        slippage = SlippageModel(
            slippage_type=SlippageType(slip.str_("model", "SPREAD_FRACTION")),
            fixed_ticks=slip.float_("fixed_ticks", 1.0),
            spread_fraction=slip.float_("spread_fraction", 0.5),
            volatility_coefficient=slip.float_("volatility_coefficient", 0.1),
            seed=slip.int_("seed", 0),
        )

        imp = section.section("market_impact", required=False)
        impact = MarketImpactModel(
            enabled=imp.bool_("enabled", True),
            coefficient=imp.float_("coefficient", 0.1),
            threshold_participation=imp.float_("threshold_participation", 0.01),
        )

        return cls(default_commission, overrides, default_fee, fee_overrides, slippage, impact)

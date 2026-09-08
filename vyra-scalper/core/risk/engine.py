"""The Risk Engine.

Absolute authority over strategies (``RISK_SPEC.md`` §1).  Every signal passes through
:meth:`RiskEngine.evaluate`, which returns a :class:`RiskDecision`.  There is no other
path from a signal to an order.

Three properties matter more than the individual checks:

* **Fail-closed.** An exception inside any check becomes ``REJECT`` with
  ``RISK_CHECK_ERROR``.  An engine that cannot evaluate does not approve.
* **Complete audit.** Approvals are recorded as fully as rejections.  A trail that
  contains only refusals cannot demonstrate that a limit was ever evaluated.
* **Checks are ordered cheapest-first and short-circuit on HALT**, so a tripped kill
  switch is never overtaken by a slower check.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import date
from enum import StrEnum
from typing import Any

from core.events import Regime, StalenessState
from core.instruments.instrument import Instrument
from core.instruments.registry import InstrumentRegistry
from core.portfolio.portfolio import Portfolio
from core.risk.kill_switch import KillSwitch, Trigger
from core.risk.limits import RiskLimits
from core.risk.reasons import Reason
from core.risk.sizing import SizingResult, compute_position_size
from core.signals.signal import Signal, SignalIntent
from core.util.clock import NS_PER_SEC, Nanos
from core.util.logging import get_logger

__all__ = ["MarketState", "RiskAction", "RiskDecision", "RiskEngine"]

_log = get_logger("risk.engine")


class RiskAction(StrEnum):
    APPROVE = "APPROVE"
    REDUCE = "REDUCE"
    REJECT = "REJECT"
    HALT = "HALT"

    @property
    def permits_order(self) -> bool:
        return self in (RiskAction.APPROVE, RiskAction.REDUCE)


@dataclass(frozen=True, slots=True)
class MarketState:
    """The market conditions a decision is made against.

    Passed in rather than read from a global, so the engine is a pure function of its
    inputs and a decision can be replayed exactly from the audit log.
    """

    ts: Nanos
    spread_ticks: float | None = None
    top_of_book_size: float | None = None
    atr_ticks: float | None = None
    staleness: StalenessState = StalenessState.FRESH
    expected_slippage_ticks: float | None = None
    is_session_open: bool = True
    blocked_window_reason: str | None = None
    news_blackout: bool = False
    regime: Regime = Regime.UNKNOWN


@dataclass(frozen=True, slots=True)
class RiskDecision:
    """The engine's verdict on one signal.  Recorded for every action, including approval."""

    decision_id: str
    signal_id: str
    strategy_id: str
    instrument_id: str
    action: RiskAction
    requested_qty: float
    approved_qty: float
    reason_codes: tuple[str, ...]
    binding_limit: str | None
    equity: float
    risk_amount: float
    ts: Nanos
    sizing: SizingResult | None = None
    detail: dict[str, Any] = field(default_factory=dict)

    @property
    def permits_order(self) -> bool:
        return self.action.permits_order and self.approved_qty > 0

    def to_dict(self) -> dict[str, Any]:
        return {
            "decision_id": self.decision_id,
            "signal_id": self.signal_id,
            "strategy_id": self.strategy_id,
            "instrument_id": self.instrument_id,
            "action": self.action.value,
            "requested_qty": self.requested_qty,
            "approved_qty": self.approved_qty,
            "reason_codes": list(self.reason_codes),
            "binding_limit": self.binding_limit,
            "equity": self.equity,
            "risk_amount": self.risk_amount,
            "ts": self.ts,
            "sizing": self.sizing.to_dict() if self.sizing else None,
            "detail": self.detail,
        }


@dataclass(slots=True)
class _StrategyState:
    """Per-strategy counters that limits are evaluated against."""

    trades_this_session: int = 0
    consecutive_losses: int = 0
    cooldown_until_ns: Nanos = 0


class RiskEngine:
    """Evaluates signals against the configured limits.

    Args:
        limits: the configured thresholds.
        portfolio: live portfolio state (equity, exposure, drawdown).
        registry: instrument definitions and no-trade windows.
        kill_switch: the global halt.
        id_prefix: prefix for decision ids.
    """

    __slots__ = (
        "_counter",
        "_decisions",
        "_evaluated_signal_ids",
        "_id_prefix",
        "_kill_switch",
        "_limits",
        "_portfolio",
        "_registry",
        "_state",
    )

    def __init__(
        self,
        limits: RiskLimits,
        portfolio: Portfolio,
        registry: InstrumentRegistry,
        kill_switch: KillSwitch,
        id_prefix: str = "rd",
    ) -> None:
        self._limits = limits
        self._portfolio = portfolio
        self._registry = registry
        self._kill_switch = kill_switch
        self._id_prefix = id_prefix
        self._counter = 0
        self._state: dict[str, _StrategyState] = {}
        self._decisions: list[RiskDecision] = []
        self._evaluated_signal_ids: set[str] = set()

    @property
    def limits(self) -> RiskLimits:
        return self._limits

    @property
    def kill_switch(self) -> KillSwitch:
        return self._kill_switch

    @property
    def decisions(self) -> tuple[RiskDecision, ...]:
        return tuple(self._decisions)

    def state_for(self, strategy_id: str) -> _StrategyState:
        return self._state.setdefault(strategy_id, _StrategyState())

    # -- main entry point ---------------------------------------------------------------

    def evaluate(self, signal: Signal, market: MarketState) -> RiskDecision:
        """Decide whether — and at what size — ``signal`` may become an order.

        Never raises.  Any internal failure becomes a ``REJECT`` carrying
        ``RISK_CHECK_ERROR``, because a risk engine that propagates an exception into the
        event loop is a risk engine that stops evaluating subsequent signals.
        """
        self._counter += 1
        decision_id = f"{self._id_prefix}-{self._counter:08d}"
        try:
            return self._evaluate_inner(decision_id, signal, market)
        except Exception as exc:
            _log.exception(
                "risk_check_error",
                decision_id=decision_id,
                signal_id=signal.signal_id,
                strategy_id=signal.strategy_id,
                instrument=signal.instrument_id,
                error=str(exc),
            )
            return self._record(
                RiskDecision(
                    decision_id=decision_id,
                    signal_id=signal.signal_id,
                    strategy_id=signal.strategy_id,
                    instrument_id=signal.instrument_id,
                    action=RiskAction.REJECT,
                    requested_qty=0.0,
                    approved_qty=0.0,
                    reason_codes=(Reason.RISK_CHECK_ERROR,),
                    binding_limit=Reason.RISK_CHECK_ERROR,
                    equity=self._portfolio.equity,
                    risk_amount=0.0,
                    ts=signal.ts,
                    detail={"error": str(exc), "error_type": type(exc).__name__},
                )
            )

    def _evaluate_inner(
        self, decision_id: str, signal: Signal, market: MarketState
    ) -> RiskDecision:
        instrument = self._registry.get(signal.instrument_id)
        equity = self._portfolio.equity

        # Exits are evaluated on a much shorter path: refusing to close a position because
        # the spread widened would strand risk the engine already accepted.
        if signal.intent in (SignalIntent.EXIT, SignalIntent.SCALE_OUT):
            return self._evaluate_exit(decision_id, signal, instrument)

        halt = self._check_halt_conditions(market)
        if halt is not None:
            trigger, detail = halt
            self._kill_switch.trip(trigger, detail, ts=market.ts)
            return self._record(
                self._verdict(
                    decision_id, signal, RiskAction.HALT, 0.0, (Reason.KILL_SWITCH_ACTIVE,),
                    Reason.KILL_SWITCH_ACTIVE, equity, 0.0,
                    detail={"trigger": trigger.value, "detail": detail},
                )
            )

        if self._kill_switch.is_tripped:
            return self._record(
                self._verdict(
                    decision_id, signal, RiskAction.HALT, 0.0, (Reason.KILL_SWITCH_ACTIVE,),
                    Reason.KILL_SWITCH_ACTIVE, equity, 0.0,
                )
            )

        blocking = self._first_blocking_reason(signal, market, instrument)
        if blocking is not None:
            return self._record(
                self._verdict(
                    decision_id, signal, RiskAction.REJECT, 0.0, (blocking,), blocking, equity, 0.0
                )
            )

        sizing = compute_position_size(
            instrument=instrument,
            equity=equity,
            risk_fraction=self._limits.max_risk_per_trade_pct,
            entry=signal.suggested_entry,
            stop=signal.suggested_stop,
            min_stop_distance_ticks=self._limits.min_stop_distance_ticks,
            confidence=signal.confidence,
            confidence_floor=self._limits.size_confidence_floor,
        )
        if not sizing.is_tradeable:
            return self._record(
                self._verdict(
                    decision_id, signal, RiskAction.REJECT, sizing.raw_quantity,
                    sizing.reason_codes, sizing.binding_limit, equity, sizing.risk_amount,
                    sizing=sizing,
                )
            )

        approved, reasons, binding = self._apply_exposure_caps(
            signal, instrument, sizing.quantity, equity
        )
        if approved <= 0:
            return self._record(
                self._verdict(
                    decision_id, signal, RiskAction.REJECT, sizing.quantity,
                    tuple(reasons) or (Reason.MAX_PORTFOLIO_EXPOSURE,), binding, equity,
                    sizing.risk_amount, sizing=sizing,
                )
            )

        action = RiskAction.REDUCE if approved < sizing.quantity else RiskAction.APPROVE
        codes = tuple(reasons) if reasons else (Reason.APPROVED,)
        decision = self._verdict(
            decision_id, signal, action, approved, codes, binding, equity,
            sizing.risk_amount, sizing=sizing,
        )
        _log.info(
            "risk_decision",
            decision_id=decision_id,
            signal_id=signal.signal_id,
            strategy_id=signal.strategy_id,
            instrument=signal.instrument_id,
            action=action.value,
            approved_qty=approved,
            reason_codes=list(codes),
        )
        return self._record(decision)

    def _evaluate_exit(
        self, decision_id: str, signal: Signal, instrument: Instrument
    ) -> RiskDecision:
        """Approve an exit for the open quantity.

        Exits are refused only when the kill switch's emergency policy explicitly says to
        hold positions.  Otherwise reducing risk is always permitted, including while
        halted.
        """
        position = self._portfolio.position(signal.instrument_id)
        quantity = abs(position.quantity)
        equity = self._portfolio.equity

        if quantity <= 0:
            return self._record(
                self._verdict(
                    decision_id, signal, RiskAction.REJECT, 0.0, (Reason.DUPLICATE_SIGNAL,),
                    Reason.DUPLICATE_SIGNAL, equity, 0.0,
                )
            )
        if self._kill_switch.is_tripped and not self._kill_switch.allows_risk_reducing_exit():
            return self._record(
                self._verdict(
                    decision_id, signal, RiskAction.HALT, 0.0, (Reason.KILL_SWITCH_ACTIVE,),
                    Reason.KILL_SWITCH_ACTIVE, equity, 0.0,
                    detail={"emergency_policy": self._kill_switch.emergency_policy.value},
                )
            )
        return self._record(
            self._verdict(
                decision_id, signal, RiskAction.APPROVE, quantity, (Reason.APPROVED,),
                None, equity, 0.0, detail={"exit": True},
            )
        )

    # -- checks -------------------------------------------------------------------------

    def _check_halt_conditions(self, market: MarketState) -> tuple[Trigger, str] | None:
        """Conditions that stop trading entirely rather than refusing one order."""
        limits = self._limits
        portfolio = self._portfolio

        session_loss_pct = portfolio.session_pnl_pct()
        if session_loss_pct <= -limits.max_daily_loss_pct:
            return (
                Trigger.DAILY_LOSS_EXCEEDED,
                f"session PnL {session_loss_pct:.4%} breached the "
                f"{limits.max_daily_loss_pct:.2%} daily loss limit",
            )

        if portfolio.drawdown_pct >= limits.max_drawdown_pct:
            return (
                Trigger.DRAWDOWN_EXCEEDED,
                f"drawdown {portfolio.drawdown_pct:.4%} breached the "
                f"{limits.max_drawdown_pct:.2%} limit",
            )

        if market.staleness is StalenessState.DEAD:
            return (
                Trigger.MARKET_DATA_STALE,
                "market data is dead; refusing to trade on an unknown book",
            )
        return None

    def _first_blocking_reason(
        self, signal: Signal, market: MarketState, instrument: Instrument
    ) -> str | None:
        """Return the first reason this signal must be rejected, or ``None``.

        Ordered cheapest-first.  Each check is a small named function so a failure maps to
        exactly one reason code.
        """
        checks: tuple[tuple[str, Callable[[], bool]], ...] = (
            (Reason.SESSION_RESTRICTED, lambda: not market.is_session_open),
            (
                Reason.SESSION_RESTRICTED,
                lambda: market.blocked_window_reason is not None
                or self._registry.is_blocked_window(signal.instrument_id, market.ts) is not None,
            ),
            (Reason.STALE_MARKET_DATA, lambda: market.staleness is StalenessState.STALE),
            (Reason.NEWS_BLACKOUT, lambda: market.news_blackout),
            # Cause before mechanism: a loss streak also starts a cooldown, and
            # "MAX_CONSECUTIVE_LOSSES" tells an operator what to look at, whereas
            # "COOLDOWN_ACTIVE" only says the engine is waiting.
            (Reason.MAX_CONSECUTIVE_LOSSES, lambda: self._consecutive_losses_exceeded(signal)),
            (Reason.MAX_TRADES_PER_SESSION, lambda: self._session_trades_exceeded(signal)),
            (Reason.COOLDOWN_ACTIVE, lambda: self._in_cooldown(signal, market.ts)),
            (Reason.MAX_SPREAD, lambda: self._spread_exceeded(market, instrument)),
            (Reason.MIN_LIQUIDITY, lambda: self._liquidity_insufficient(market)),
            (Reason.MAX_EXPECTED_SLIPPAGE, lambda: self._slippage_exceeded(market)),
            (Reason.VOLATILITY_LIMIT, lambda: self._volatility_out_of_band(market)),
            (Reason.MAX_DAILY_LOSS, lambda: self._daily_loss_exceeded()),
            (Reason.MAX_WEEKLY_LOSS, lambda: self._weekly_loss_exceeded(signal, market.ts)),
            (Reason.DUPLICATE_SIGNAL, lambda: self._is_duplicate(signal)),
        )
        for reason, predicate in checks:
            if predicate():
                return reason
        return None

    def _in_cooldown(self, signal: Signal, ts: Nanos) -> bool:
        return ts < self.state_for(signal.strategy_id).cooldown_until_ns

    def _session_trades_exceeded(self, signal: Signal) -> bool:
        return (
            self.state_for(signal.strategy_id).trades_this_session
            >= self._limits.max_trades_per_session
        )

    def _consecutive_losses_exceeded(self, signal: Signal) -> bool:
        return (
            self.state_for(signal.strategy_id).consecutive_losses
            >= self._limits.max_consecutive_losses
        )

    def _spread_exceeded(self, market: MarketState, instrument: Instrument) -> bool:
        if market.spread_ticks is None:
            return False
        # The per-instrument limit wins where it is tighter than the global one: a 2-tick
        # spread is normal on MES and pathological on ES.
        limit = min(self._limits.max_spread_ticks, instrument.max_spread_ticks)
        return market.spread_ticks > limit

    def _liquidity_insufficient(self, market: MarketState) -> bool:
        if market.top_of_book_size is None:
            return False
        return market.top_of_book_size < self._limits.min_liquidity_size

    def _slippage_exceeded(self, market: MarketState) -> bool:
        if market.expected_slippage_ticks is None:
            return False
        return market.expected_slippage_ticks > self._limits.max_expected_slippage_ticks

    def _volatility_out_of_band(self, market: MarketState) -> bool:
        if market.atr_ticks is None:
            return False
        return not (self._limits.min_atr_ticks <= market.atr_ticks <= self._limits.max_atr_ticks)

    def _daily_loss_exceeded(self) -> bool:
        return self._portfolio.session_pnl_pct() <= -self._limits.max_daily_loss_pct

    def _weekly_loss_exceeded(self, signal: Signal, ts: Nanos) -> bool:
        day = self._portfolio.trading_date(signal.instrument_id, ts)
        return self._portfolio.weekly_pnl_pct(day) <= -self._limits.max_weekly_loss_pct

    def _is_duplicate(self, signal: Signal) -> bool:
        """Reject a signal id that has already been evaluated.

        Scoped deliberately narrowly.  Re-evaluating the same ``signal_id`` means the
        event was delivered twice, which must not become two positions.  Preventing a
        *second, different* signal while an order is still working is a distinct concern
        and belongs to the order manager's in-flight registry
        (``EXECUTION_SPEC.md`` §4), which knows what is actually outstanding.

        The check is a pure read.  These predicates short-circuit, so a check that mutated
        state would record inconsistently depending on which earlier check fired; the
        bookkeeping happens in :meth:`_record` instead, on every decision.
        """
        return signal.signal_id in self._evaluated_signal_ids

    # -- exposure caps ------------------------------------------------------------------

    def _apply_exposure_caps(
        self, signal: Signal, instrument: Instrument, quantity: float, equity: float
    ) -> tuple[float, list[str], str | None]:
        """Reduce ``quantity`` until every exposure limit is satisfied.

        Returns the permitted quantity, the limits that bound it, and the tightest one.
        Caps *reduce* rather than reject so that a strategy near a limit still trades a
        smaller size, which is the behaviour that keeps a portfolio at its limit rather
        than oscillating between full size and nothing.
        """
        limits = self._limits
        reasons: list[str] = []
        binding: str | None = None
        price = signal.suggested_entry
        current = self._portfolio.position(signal.instrument_id)
        sign = signal.direction.sign
        existing_signed = current.quantity

        def cap(available_notional: float, reason: str) -> float:
            return instrument.max_position_from_notional(price, max(0.0, available_notional))

        # Instrument exposure: what the position would become, not just what we are adding.
        instrument_budget = equity * limits.max_instrument_exposure_pct
        prospective_units = abs(existing_signed + sign * quantity)
        if instrument.notional(price, prospective_units) > instrument_budget:
            allowed_total = cap(instrument_budget, Reason.MAX_INSTRUMENT_EXPOSURE)
            quantity = max(0.0, allowed_total - abs(existing_signed))
            reasons.append(Reason.MAX_INSTRUMENT_EXPOSURE)
            binding = Reason.MAX_INSTRUMENT_EXPOSURE

        portfolio_budget = equity * limits.max_portfolio_exposure_pct
        headroom = portfolio_budget - self._portfolio.gross_exposure
        if instrument.notional(price, quantity) > headroom:
            quantity = min(quantity, cap(headroom, Reason.MAX_PORTFOLIO_EXPOSURE))
            reasons.append(Reason.MAX_PORTFOLIO_EXPOSURE)
            binding = Reason.MAX_PORTFOLIO_EXPOSURE

        group = limits.group_for(signal.instrument_id)
        if group is not None:
            members = limits.correlation_groups[group]
            group_budget = equity * limits.max_correlated_exposure_pct
            group_used = self._portfolio.group_exposure_pct(members) * equity
            group_headroom = group_budget - group_used
            if instrument.notional(price, quantity) > group_headroom:
                quantity = min(quantity, cap(group_headroom, Reason.MAX_CORRELATED_EXPOSURE))
                reasons.append(Reason.MAX_CORRELATED_EXPOSURE)
                binding = Reason.MAX_CORRELATED_EXPOSURE

        leverage_budget = equity * limits.max_leverage
        leverage_headroom = leverage_budget - self._portfolio.gross_exposure
        if instrument.notional(price, quantity) > leverage_headroom:
            quantity = min(quantity, cap(leverage_headroom, Reason.MAX_LEVERAGE))
            reasons.append(Reason.MAX_LEVERAGE)
            binding = Reason.MAX_LEVERAGE

        quantity = instrument.round_qty(max(0.0, quantity))
        return quantity, reasons, binding

    # -- feedback -----------------------------------------------------------------------

    def on_trade_closed(self, strategy_id: str, net_pnl: float, ts: Nanos) -> None:
        """Update per-strategy counters after a round trip closes.

        A losing trade starts a cooldown; a run of them starts a longer one.  Both come
        from configuration, so the pause after a loss is a policy, not a constant.
        """
        state = self.state_for(strategy_id)
        state.trades_this_session += 1
        if net_pnl < 0:
            state.consecutive_losses += 1
            cooldown = self._limits.cooldown_after_loss_seconds
            if state.consecutive_losses >= self._limits.max_consecutive_losses:
                cooldown = self._limits.cooldown_after_consecutive_losses_seconds
            state.cooldown_until_ns = ts + int(cooldown * NS_PER_SEC)
        else:
            state.consecutive_losses = 0

    def start_session(self, trading_date: date) -> None:
        """Reset per-session counters.  Consecutive losses deliberately carry over."""
        self._portfolio.start_session(trading_date)
        for state in self._state.values():
            state.trades_this_session = 0

    def check_equity_update(self, ts: Nanos) -> bool:
        """Evaluate halt conditions on an equity change, between orders.

        Returns ``True`` if the switch tripped.  Called on every mark so a position that
        drifts through the daily-loss limit halts trading without a new order having to be
        attempted.
        """
        halt = self._check_halt_conditions(MarketState(ts=ts))
        if halt is None:
            return False
        trigger, detail = halt
        self._kill_switch.trip(trigger, detail, ts=ts)
        return True

    # -- helpers ------------------------------------------------------------------------

    def _verdict(
        self,
        decision_id: str,
        signal: Signal,
        action: RiskAction,
        approved_qty: float,
        reason_codes: tuple[str, ...],
        binding_limit: str | None,
        equity: float,
        risk_amount: float,
        sizing: SizingResult | None = None,
        detail: dict[str, Any] | None = None,
    ) -> RiskDecision:
        return RiskDecision(
            decision_id=decision_id,
            signal_id=signal.signal_id,
            strategy_id=signal.strategy_id,
            instrument_id=signal.instrument_id,
            action=action,
            requested_qty=sizing.quantity if sizing else approved_qty,
            approved_qty=approved_qty,
            reason_codes=reason_codes,
            binding_limit=binding_limit,
            equity=equity,
            risk_amount=risk_amount,
            ts=signal.ts,
            sizing=sizing,
            detail=detail or {},
        )

    def _record(self, decision: RiskDecision) -> RiskDecision:
        """Persist every decision, approvals included (``RISK_SPEC.md`` §1)."""
        self._decisions.append(decision)
        self._evaluated_signal_ids.add(decision.signal_id)
        return decision

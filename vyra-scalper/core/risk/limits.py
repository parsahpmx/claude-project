"""Risk limit configuration.

A typed, validated view over ``risk.yaml``.  Every threshold the engine consults is here;
none is read from a strategy or hardcoded in a check.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from core.config.loader import ConfigSection

__all__ = ["RiskLimits"]


@dataclass(frozen=True, slots=True)
class RiskLimits:
    """All configured limits (``RISK_SPEC.md`` §3)."""

    # per trade
    max_risk_per_trade_pct: float = 0.0025
    min_stop_distance_ticks: float = 2.0
    max_stop_distance_atr: float = 4.0
    size_confidence_floor: float = 0.4

    # exposure
    max_instrument_exposure_pct: float = 1.0
    max_portfolio_exposure_pct: float = 3.0
    max_correlated_exposure_pct: float = 1.5
    max_leverage: float = 5.0

    # loss limits
    max_daily_loss_pct: float = 0.02
    max_weekly_loss_pct: float = 0.04
    max_drawdown_pct: float = 0.08
    max_consecutive_losses: int = 4
    max_trades_per_session: int = 20
    cooldown_after_loss_seconds: float = 60.0
    cooldown_after_consecutive_losses_seconds: float = 900.0

    # market conditions
    max_spread_ticks: float = 4.0
    min_liquidity_size: float = 1.0
    max_expected_slippage_ticks: float = 3.0
    min_atr_ticks: float = 2.0
    max_atr_ticks: float = 200.0
    max_quote_age_ms: float = 2000.0

    # news
    news_blackout_minutes_before: float = 5.0
    news_blackout_minutes_after: float = 5.0
    news_min_importance: int = 3

    correlation_groups: dict[str, tuple[str, ...]] = field(default_factory=dict)

    def __post_init__(self) -> None:
        fractions = {
            "max_risk_per_trade_pct": self.max_risk_per_trade_pct,
            "max_daily_loss_pct": self.max_daily_loss_pct,
            "max_weekly_loss_pct": self.max_weekly_loss_pct,
            "max_drawdown_pct": self.max_drawdown_pct,
        }
        for name, value in fractions.items():
            if not 0 < value < 1:
                # A fraction entered as 2 instead of 0.02 is a hundredfold risk error that
                # no type check would catch.
                raise ValueError(
                    f"{name} must be a fraction in (0, 1), got {value}. "
                    "Percentages are expressed as fractions: 2% is 0.02."
                )
        if self.max_daily_loss_pct > self.max_weekly_loss_pct:
            raise ValueError(
                f"max_daily_loss_pct ({self.max_daily_loss_pct}) exceeds "
                f"max_weekly_loss_pct ({self.max_weekly_loss_pct}); the weekly limit "
                "would never bind"
            )
        if self.min_stop_distance_ticks <= 0:
            raise ValueError("min_stop_distance_ticks must be positive: sizing divides by it")
        if self.max_consecutive_losses < 1:
            raise ValueError("max_consecutive_losses must be at least 1")
        if not 0 < self.size_confidence_floor <= 1:
            raise ValueError("size_confidence_floor must be in (0, 1]")

    def group_for(self, instrument_id: str) -> str | None:
        """The correlation group containing ``instrument_id``, if any."""
        for group, members in self.correlation_groups.items():
            if instrument_id in members:
                return group
        return None

    @classmethod
    def from_config(cls, section: ConfigSection) -> RiskLimits:
        per_trade = section.section("per_trade")
        exposure = section.section("exposure")
        loss = section.section("loss_limits")
        market = section.section("market_conditions")
        news = section.section("news", required=False)
        groups_raw = section.get("correlation_groups") or {}
        if not isinstance(groups_raw, dict):
            raise ValueError("risk.correlation_groups must be a mapping")

        return cls(
            max_risk_per_trade_pct=per_trade.in_range("max_risk_per_trade_pct", 0.0, 1.0),
            min_stop_distance_ticks=per_trade.float_("min_stop_distance_ticks", 2.0),
            max_stop_distance_atr=per_trade.float_("max_stop_distance_atr", 4.0),
            size_confidence_floor=per_trade.in_range("size_confidence_floor", 0.0, 1.0, 0.4),
            max_instrument_exposure_pct=exposure.float_("max_instrument_exposure_pct", 1.0),
            max_portfolio_exposure_pct=exposure.float_("max_portfolio_exposure_pct", 3.0),
            max_correlated_exposure_pct=exposure.float_("max_correlated_exposure_pct", 1.5),
            max_leverage=exposure.float_("max_leverage", 5.0),
            max_daily_loss_pct=loss.in_range("max_daily_loss_pct", 0.0, 1.0),
            max_weekly_loss_pct=loss.in_range("max_weekly_loss_pct", 0.0, 1.0),
            max_drawdown_pct=loss.in_range("max_drawdown_pct", 0.0, 1.0),
            max_consecutive_losses=loss.int_("max_consecutive_losses", 4),
            max_trades_per_session=loss.int_("max_trades_per_session", 20),
            cooldown_after_loss_seconds=loss.float_("cooldown_after_loss_seconds", 60.0),
            cooldown_after_consecutive_losses_seconds=loss.float_(
                "cooldown_after_consecutive_losses_seconds", 900.0
            ),
            max_spread_ticks=market.float_("max_spread_ticks", 4.0),
            min_liquidity_size=market.float_("min_liquidity_size", 1.0),
            max_expected_slippage_ticks=market.float_("max_expected_slippage_ticks", 3.0),
            min_atr_ticks=market.float_("min_atr_ticks", 2.0),
            max_atr_ticks=market.float_("max_atr_ticks", 200.0),
            max_quote_age_ms=market.float_("max_quote_age_ms", 2000.0),
            news_blackout_minutes_before=news.float_("blackout_minutes_before", 5.0),
            news_blackout_minutes_after=news.float_("blackout_minutes_after", 5.0),
            news_min_importance=news.int_("min_importance", 3),
            correlation_groups={
                str(k): tuple(str(x) for x in v) for k, v in groups_raw.items()
            },
        )

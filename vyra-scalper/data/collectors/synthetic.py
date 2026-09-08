"""Deterministic synthetic tick generator.

Used to exercise the whole pipeline without vendor data, and to prove reproducibility.
Given a seed it emits a byte-identical stream every time.

**This data supports no claim about expectancy.**  It has no real microstructure, no news,
no participants and no regime persistence beyond what the parameters impose.  Every report
generated from it is watermarked ``SYNTHETIC`` (see :mod:`core.analytics.report`).  Its
purpose is to test the plumbing: that bars close correctly, that costs are applied, that
the risk engine binds, and that two runs of the same configuration agree exactly.

The process is a discretised Ornstein-Uhlenbeck-damped geometric random walk on the mid,
with an independent spread process and Poisson trade arrivals.  Damping is included so
that a mean-reversion strategy has something to act on; that is a property of the
generator, not evidence about markets.
"""

from __future__ import annotations

import math
import random
from collections.abc import Iterator
from dataclasses import dataclass

from core.events import Aggressor, QuoteEvent, TradeEvent
from core.instruments.instrument import Instrument
from core.instruments.sessions import SessionCalendar
from core.util.clock import NS_PER_MS, Nanos
from core.util.ids import content_hash

__all__ = ["SyntheticConfig", "SyntheticTickSource"]

_SECONDS_PER_TRADING_YEAR = 252 * 6.5 * 3600


@dataclass(frozen=True, slots=True)
class SyntheticConfig:
    """Generator parameters.  All of them appear in the run manifest."""

    seed: int = 20240315
    start_price: float = 5100.0
    annual_volatility: float = 0.18
    trade_arrival_per_second: float = 1.5
    spread_ticks_mean: float = 1.0
    spread_ticks_wide_prob: float = 0.05
    spread_ticks_wide_multiple: float = 4.0
    mean_reversion_strength: float = 0.02
    anchor_drift_volatility: float = 0.6
    tick_interval_ms: float = 250.0
    trade_size_mean: float = 3.0
    exchange_latency_us: float = 400.0

    def __post_init__(self) -> None:
        if self.start_price <= 0:
            raise ValueError("start_price must be positive")
        if self.tick_interval_ms <= 0:
            raise ValueError("tick_interval_ms must be positive")
        if not 0 <= self.spread_ticks_wide_prob <= 1:
            raise ValueError("spread_ticks_wide_prob must be a probability")
        if self.annual_volatility < 0:
            raise ValueError("annual_volatility must be non-negative")

    def to_dict(self) -> dict[str, float | int]:
        from dataclasses import asdict

        return asdict(self)


class SyntheticTickSource:
    """Generates quotes and trades for one instrument.

    Args:
        instrument: the instrument to generate for; its tick size quantises every price.
        config: generator parameters.
        calendar: when supplied, ticks are emitted only during open sessions, so bars,
            session VWAP and daily-loss buckets behave as they would on real data.
    """

    __slots__ = ("_calendar", "_config", "_instrument")

    def __init__(
        self,
        instrument: Instrument,
        config: SyntheticConfig | None = None,
        calendar: SessionCalendar | None = None,
    ) -> None:
        self._instrument = instrument
        self._config = config or SyntheticConfig()
        self._calendar = calendar

    @property
    def source_id(self) -> str:
        return f"SYNTH:v1:seed={self._config.seed}"

    @property
    def instruments(self) -> tuple[str, ...]:
        return (self._instrument.instrument_id,)

    def content_fingerprint(self) -> str:
        """Hash over the parameters that fully determine the output."""
        return content_hash(
            {
                "generator": "SyntheticTickSource",
                "version": 1,
                "instrument": self._instrument.instrument_id,
                "tick_size": self._instrument.tick_size,
                "config": self._config.to_dict(),
                "calendar": self._calendar.session.session_id if self._calendar else None,
            }
        )

    def events(self, start_ns: Nanos, end_ns: Nanos) -> Iterator[QuoteEvent | TradeEvent]:
        """Yield a deterministic quote/trade stream over ``[start_ns, end_ns)``.

        Raises:
            ValueError: if the range is empty or inverted.  A silently empty backtest is
                worse than a failed one.
        """
        if end_ns <= start_ns:
            raise ValueError(f"end_ns ({end_ns}) must be after start_ns ({start_ns})")

        cfg = self._config
        inst = self._instrument
        rng = random.Random(cfg.seed)

        interval_ns = int(cfg.tick_interval_ms * NS_PER_MS)
        dt_seconds = cfg.tick_interval_ms / 1000.0
        # Per-step volatility from an annualised figure, over trading seconds.
        sigma_step = cfg.annual_volatility * math.sqrt(dt_seconds / _SECONDS_PER_TRADING_YEAR)
        anchor = math.log(cfg.start_price)
        log_mid = anchor
        # The anchor itself is a slow random walk.  An anchor fixed for the whole run makes
        # the series revert to one constant price, which any mean-reversion rule harvests
        # perfectly -- the first full run of this generator produced 90 trades, 90 wins and
        # a Sharpe of 40.  That is a property of the generator, not an edge, and a test bed
        # that hands a strategy a free win tests nothing about the strategy.
        anchor_sigma = sigma_step * cfg.anchor_drift_volatility
        sequence = 0
        latency_ns = int(cfg.exchange_latency_us * 1_000)

        ts = start_ns
        while ts < end_ns:
            if self._calendar is not None and not self._calendar.is_open(ts):
                # Skip to the next open rather than emitting closed-session ticks.  When
                # the calendar has no further sessions, stop: inventing data past the end
                # of the calendar would be exactly the silent fill this platform forbids.
                nxt = self._calendar.next_open(ts)
                if nxt is None or nxt >= end_ns:
                    return
                ts = nxt
                continue

            # Mean-reverting drift toward a slowly drifting anchor, plus a diffusive shock.
            anchor += rng.gauss(0.0, anchor_sigma)
            log_mid += -cfg.mean_reversion_strength * (log_mid - anchor) * dt_seconds
            log_mid += rng.gauss(0.0, sigma_step)
            mid = math.exp(log_mid)

            wide = rng.random() < cfg.spread_ticks_wide_prob
            spread_ticks = cfg.spread_ticks_mean * (
                cfg.spread_ticks_wide_multiple if wide else 1.0
            )
            half = spread_ticks * inst.tick_size / 2.0
            bid = inst.round_price(mid - half)
            ask = inst.round_price(mid + half)
            if ask <= bid:
                ask = inst.round_price(bid + inst.tick_size)

            sequence += 1
            yield QuoteEvent(
                instrument_id=inst.instrument_id,
                exchange=inst.exchange,
                ts_exchange=ts,
                ts_receive=ts + latency_ns,
                ts_processed=ts + latency_ns,
                sequence_id=sequence,
                source=self.source_id,
                bid=bid,
                ask=ask,
                bid_size=float(rng.randint(1, 50)),
                ask_size=float(rng.randint(1, 50)),
            )

            # Poisson arrivals over the interval, thinned to at most a few per step.
            expected = cfg.trade_arrival_per_second * dt_seconds
            n_trades = _poisson(rng, expected)
            for _ in range(n_trades):
                buy = rng.random() < 0.5
                price = ask if buy else bid
                size = max(1.0, round(rng.expovariate(1.0 / cfg.trade_size_mean)))
                sequence += 1
                yield TradeEvent(
                    instrument_id=inst.instrument_id,
                    exchange=inst.exchange,
                    ts_exchange=ts,
                    ts_receive=ts + latency_ns,
                    ts_processed=ts + latency_ns,
                    sequence_id=sequence,
                    source=self.source_id,
                    price=price,
                    size=size,
                    aggressor=Aggressor.BUY if buy else Aggressor.SELL,
                )

            ts += interval_ns


def _poisson(rng: random.Random, mean: float) -> int:
    """Knuth's Poisson sampler.

    Adequate and exactly reproducible for the small means used here (< 1 per step).  For
    large means it would be slow, which is why the caller keeps the step interval short.
    """
    if mean <= 0:
        return 0
    limit = math.exp(-mean)
    k = 0
    p = 1.0
    while True:
        p *= rng.random()
        if p <= limit:
            return k
        k += 1
        if k > 100:  # guard against a pathological parameter rather than looping forever
            return k

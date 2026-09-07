"""The instrument registry — configuration to typed objects.

This is where ``markets.yaml`` and ``sessions.yaml`` become :class:`Instrument` and
:class:`SessionCalendar` objects.  All validation happens here, at startup, so that a
mistyped tick value or an unknown session id fails before any data is processed rather
than partway through a run.
"""

from __future__ import annotations

from datetime import date, datetime, time
from typing import Any

from core.config.loader import ConfigError, ConfigSection
from core.events.enums import AssetClass
from core.instruments.continuous import Adjustment, ContinuousContractSpec, RollRule
from core.instruments.instrument import Instrument, InstrumentError
from core.instruments.sessions import (
    SessionCalendar,
    SessionSegment,
    SessionSpecError,
    TradingSession,
)
from core.util.clock import Nanos, from_iso

__all__ = ["InstrumentRegistry", "NoTradeWindow"]


def _as_date(value: Any, context: str) -> date:
    """Coerce a YAML scalar to a :class:`date`.

    PyYAML already produces ``date`` for bare ``2024-12-25``; quoted values arrive as
    strings.  Both are accepted so a calendar does not break on a quoting change.
    """
    if isinstance(value, date) and not isinstance(value, datetime):
        return value
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, str):
        try:
            return date.fromisoformat(value)
        except ValueError as exc:
            raise ConfigError(f"{context}: {value!r} is not an ISO date") from exc
    raise ConfigError(f"{context}: expected a date, got {type(value).__name__}")


def _as_time(value: Any, context: str) -> time:
    if isinstance(value, time):
        return value
    if isinstance(value, str):
        try:
            hh, mm = value.split(":")
            return time(int(hh), int(mm))
        except ValueError as exc:
            raise ConfigError(f"{context}: {value!r} is not an HH:MM time") from exc
    raise ConfigError(f"{context}: expected an HH:MM time, got {type(value).__name__}")


class NoTradeWindow:
    """A session-relative window in which entries are refused.

    Expressed relative to the session open or close rather than as absolute clock times,
    so it stays correct across DST and early closes.
    """

    __slots__ = ("after_open_ns", "before_close_ns", "reason")

    def __init__(
        self, after_open_ns: int | None, before_close_ns: int | None, reason: str
    ) -> None:
        if after_open_ns is None and before_close_ns is None:
            raise ConfigError(
                f"no_trade_window {reason!r} defines neither after_open_seconds "
                "nor before_close_seconds"
            )
        self.after_open_ns = after_open_ns
        self.before_close_ns = before_close_ns
        self.reason = reason

    def blocks(self, ts: Nanos, session_open: Nanos, session_close: Nanos) -> bool:
        """Whether ``ts`` falls inside this window for the given session bounds."""
        if self.after_open_ns is not None and ts < session_open + self.after_open_ns:
            return True
        if self.before_close_ns is not None and ts > session_close - self.before_close_ns:
            return True
        return False

    def __repr__(self) -> str:
        return f"NoTradeWindow(reason={self.reason!r})"


class InstrumentRegistry:
    """Typed access to instruments, sessions and continuous-contract recipes.

    Built once at startup.  Lookups are total: an unknown instrument raises with the list
    of known ids rather than returning ``None`` for a caller to mishandle.
    """

    __slots__ = ("_calendars", "_continuous", "_instruments", "_no_trade", "_sessions")

    def __init__(
        self,
        instruments: dict[str, Instrument],
        sessions: dict[str, TradingSession],
        continuous: dict[str, ContinuousContractSpec] | None = None,
        no_trade_windows: dict[str, list[NoTradeWindow]] | None = None,
    ) -> None:
        self._instruments = instruments
        self._sessions = sessions
        self._continuous = continuous or {}
        self._no_trade = no_trade_windows or {}
        self._calendars: dict[str, SessionCalendar] = {
            sid: SessionCalendar(session) for sid, session in sessions.items()
        }
        self._validate_references()

    def _validate_references(self) -> None:
        """Every instrument must name a session that exists.

        Checked eagerly: a dangling session id would otherwise surface as a ``KeyError``
        on the first tick, in the middle of the event loop.
        """
        missing = {
            inst.instrument_id: inst.session_id
            for inst in self._instruments.values()
            if inst.session_id not in self._sessions
        }
        if missing:
            known = ", ".join(sorted(self._sessions)) or "(none)"
            detail = "; ".join(f"{k} -> {v!r}" for k, v in sorted(missing.items()))
            raise ConfigError(
                f"instruments reference unknown sessions: {detail}. Known sessions: {known}"
            )

    # -- lookups -----------------------------------------------------------------------

    def get(self, instrument_id: str) -> Instrument:
        try:
            return self._instruments[instrument_id]
        except KeyError:
            raise ConfigError(
                f"unknown instrument {instrument_id!r}; known: "
                f"{', '.join(sorted(self._instruments))}"
            ) from None

    def calendar(self, instrument_id: str) -> SessionCalendar:
        return self._calendars[self.get(instrument_id).session_id]

    def session(self, session_id: str) -> TradingSession:
        try:
            return self._sessions[session_id]
        except KeyError:
            raise ConfigError(f"unknown session {session_id!r}") from None

    def continuous_spec(self, root: str) -> ContinuousContractSpec:
        try:
            return self._continuous[root]
        except KeyError:
            raise ConfigError(
                f"no continuous-contract recipe for root {root!r}; contracts are never "
                "stitched implicitly (DATA_SPEC.md §7.3)"
            ) from None

    def no_trade_windows(self, instrument_id: str) -> list[NoTradeWindow]:
        return self._no_trade.get(self.get(instrument_id).session_id, [])

    def is_blocked_window(self, instrument_id: str, ts: Nanos) -> str | None:
        """Reason string if ``ts`` is inside a no-trade window, else ``None``."""
        windows = self.no_trade_windows(instrument_id)
        if not windows:
            return None
        bounds = self.calendar(instrument_id).session_bounds(ts)
        if bounds is None:
            return None
        open_ns, close_ns = bounds
        for window in windows:
            if window.blocks(ts, open_ns, close_ns):
                return window.reason
        return None

    def ids(self) -> tuple[str, ...]:
        return tuple(sorted(self._instruments))

    def by_asset_class(self, asset_class: AssetClass) -> tuple[Instrument, ...]:
        return tuple(i for i in self._instruments.values() if i.asset_class is asset_class)

    def __len__(self) -> int:
        return len(self._instruments)

    def __contains__(self, instrument_id: object) -> bool:
        return instrument_id in self._instruments

    # -- construction ------------------------------------------------------------------

    @classmethod
    def from_config(
        cls, markets: ConfigSection, sessions_cfg: ConfigSection
    ) -> InstrumentRegistry:
        """Build a registry from the ``markets`` and ``sessions`` config sections.

        Raises:
            ConfigError: on any malformed definition, with the instrument or session id in
                the message.  Instrument-level errors are collected so that one startup
                surfaces every problem rather than one per restart.
        """
        sessions = cls._build_sessions(sessions_cfg)
        instruments, errors = cls._build_instruments(markets)
        if errors:
            raise ConfigError("invalid instrument definitions:\n  - " + "\n  - ".join(errors))
        continuous = cls._build_continuous(markets)
        no_trade = cls._build_no_trade(sessions_cfg)
        return cls(instruments, sessions, continuous, no_trade)

    @staticmethod
    def _build_sessions(cfg: ConfigSection) -> dict[str, TradingSession]:
        out: dict[str, TradingSession] = {}
        section = cfg.section("sessions")
        for session_id in section.keys():
            spec = section.section(session_id)
            segments_raw = spec.list_("segments")
            if not segments_raw:
                raise ConfigError(f"session {session_id!r} defines no segments")
            segments = tuple(
                SessionSegment(
                    start=_as_time(s.get("start"), f"session {session_id} segment start"),
                    end=_as_time(s.get("end"), f"session {session_id} segment end"),
                    name=str(s.get("name", "MAIN")),
                )
                for s in segments_raw
            )
            holidays = frozenset(
                _as_date(h, f"session {session_id} holiday") for h in spec.list_("holidays")
            )
            early_raw = spec.get("early_closes") or {}
            if not isinstance(early_raw, dict):
                raise ConfigError(f"session {session_id!r}: early_closes must be a mapping")
            early = {
                _as_date(k, f"session {session_id} early_close key"): _as_time(
                    v, f"session {session_id} early_close value"
                )
                for k, v in early_raw.items()
            }
            weekdays = frozenset(int(d) for d in spec.list_("weekdays", [1, 2, 3, 4, 5]))
            try:
                out[session_id] = TradingSession(
                    session_id=session_id,
                    timezone=spec.str_("timezone"),
                    segments=segments,
                    weekdays=weekdays,
                    holidays=holidays,
                    early_closes=early,
                )
            except SessionSpecError as exc:
                raise ConfigError(f"session {session_id!r}: {exc}") from exc
        return out

    @staticmethod
    def _build_instruments(cfg: ConfigSection) -> tuple[dict[str, Instrument], list[str]]:
        defaults = cfg.section("defaults", required=False)
        section = cfg.section("instruments")
        out: dict[str, Instrument] = {}
        errors: list[str] = []

        for instrument_id in section.keys():
            spec = section.section(instrument_id)
            try:
                expiry_raw = spec.get("expiry")
                expiry_ns = from_iso(str(expiry_raw)) if expiry_raw else None
                out[instrument_id] = Instrument(
                    instrument_id=instrument_id,
                    symbol=spec.str_("symbol"),
                    asset_class=AssetClass(spec.str_("asset_class")),
                    exchange=spec.str_("exchange"),
                    currency=spec.str_("currency", defaults.str_("currency", "USD")),
                    tick_size=spec.float_("tick_size"),
                    tick_value=spec.float_("tick_value"),
                    multiplier=spec.float_("multiplier"),
                    min_qty=spec.float_("min_qty", 1.0),
                    qty_step=spec.float_("qty_step", 1.0),
                    max_qty=spec.float_("max_qty") if spec.get("max_qty") is not None else None,
                    max_spread_ticks=spec.float_("max_spread_ticks", 10.0),
                    session_id=spec.str_("session_id", "24x7"),
                    timezone=spec.str_("timezone", "UTC"),
                    expiry_ns=expiry_ns,
                    contract_month=spec.get("contract_month"),
                    underlying=spec.get("underlying"),
                    price_precision=spec.int_(
                        "price_precision", defaults.int_("price_precision", 2)
                    ),
                )
            except (InstrumentError, ConfigError, ValueError) as exc:
                errors.append(f"{instrument_id}: {exc}")
        return out, errors

    @staticmethod
    def _build_continuous(cfg: ConfigSection) -> dict[str, ContinuousContractSpec]:
        section = cfg.section("continuous_contracts", required=False)
        out: dict[str, ContinuousContractSpec] = {}
        for root in section.keys():
            spec = section.section(root)
            try:
                out[root] = ContinuousContractSpec(
                    root=spec.str_("root", root),
                    roll_rule=RollRule(spec.str_("roll_rule")),
                    adjustment=Adjustment(spec.str_("adjustment")),
                    days_before_expiry=spec.int_("days_before_expiry", 5),
                    crossover_confirm_days=spec.int_("crossover_confirm_days", 2),
                )
            except ValueError as exc:
                raise ConfigError(f"continuous contract {root!r}: {exc}") from exc
        return out

    @staticmethod
    def _build_no_trade(cfg: ConfigSection) -> dict[str, list[NoTradeWindow]]:
        section = cfg.section("no_trade_windows", required=False)
        out: dict[str, list[NoTradeWindow]] = {}
        for session_id in section.keys():
            windows: list[NoTradeWindow] = []
            for entry in section.list_(session_id):
                if not isinstance(entry, dict):
                    raise ConfigError(f"no_trade_windows.{session_id}: entries must be mappings")
                after = entry.get("after_open_seconds")
                before = entry.get("before_close_seconds")
                windows.append(
                    NoTradeWindow(
                        after_open_ns=int(after) * 1_000_000_000 if after is not None else None,
                        before_close_ns=int(before) * 1_000_000_000 if before is not None else None,
                        reason=str(entry.get("reason", "NO_TRADE_WINDOW")),
                    )
                )
            out[session_id] = windows
        return out

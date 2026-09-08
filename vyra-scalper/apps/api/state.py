"""The engine state the API reads.

The API is a **read-mostly window onto a running engine**, plus a small number of
privileged commands. It does not own trading state and does not compute anything a
strategy depends on: it reads what the engine has already decided and renders it.

That separation is deliberate. An API that could mutate risk state would be a second path
into the risk engine, and the platform's central guarantee is that there is only one.

In this build the state is populated from completed run artefacts on disk. When the live
trader exists it will register itself here instead, and the routers do not change.
"""

from __future__ import annotations

import json
from collections.abc import Iterator
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from core.config.loader import ConfigBundle, load_bundle
from core.instruments.registry import InstrumentRegistry
from core.risk.kill_switch import EmergencyPolicy, KillSwitch
from core.risk.limits import RiskLimits
from core.util.clock import now_ns, to_iso
from core.util.ids import canonicalize
from core.util.logging import get_logger

__all__ = ["EngineState", "RunSummary", "get_state", "set_state"]

_log = get_logger("api.state")

# Field names that must never appear in an API response, whatever their value.
#
# A bare ``account`` is deliberately absent: ``risk.yaml`` has an ``account`` block holding
# starting equity and currency, which the risk dashboard needs and which identifies nobody.
# A broker *account identifier* is matched by ``account_id``/``account_number``, and every
# one in the shipped configuration also sits inside a connection block, which goes wholesale.
_CREDENTIAL_HINTS = (
    "password", "passwd", "secret", "token", "api_key", "apikey", "access_key",
    "private_key", "credential", "authorization", "account_id", "account_number",
    "accountid", "login", "username", "user_id", "client_id", "clientid",
    "passphrase", "session_id", "signing",
)

# Whole blocks removed regardless of their contents. A connection block exists to hold
# the details of reaching a venue; a dashboard has no use for any of them, and enumerating
# which individual fields are sensitive is a list that will eventually be incomplete —
# `client_id` was missing from the hints above until a test caught it.
_CREDENTIAL_BLOCKS = ("connection", "credentials", "auth")


def strip_credentials(payload: Any) -> Any:
    """Remove anything credential-shaped from a structure bound for a response.

    Applied to every config the API serves. The engine already redacts credentials in
    logs; this is the same guarantee at the HTTP boundary, and it removes the key rather
    than masking its value — a masked key still tells an attacker what to look for.
    """
    if isinstance(payload, dict):
        # Keys are stringified before matching: YAML yields datetime.date keys for a
        # holiday calendar, and calling .lower() on one raises.
        return {
            key: strip_credentials(value)
            for key, value in payload.items()
            if (lowered := str(key).lower()) not in _CREDENTIAL_BLOCKS
            and not any(hint in lowered for hint in _CREDENTIAL_HINTS)
        }
    if isinstance(payload, list):
        return [strip_credentials(item) for item in payload]
    return payload


@dataclass(frozen=True, slots=True)
class RunSummary:
    """A completed backtest, as the API surfaces it."""

    run_id: str
    directory: Path
    manifest: dict[str, Any]
    metrics: dict[str, Any]

    @property
    def created_at(self) -> str:
        return str(self.manifest.get("created_at", ""))

    @property
    def warnings(self) -> list[str]:
        return list(self.manifest.get("warnings", []))

    @property
    def strategy_labels(self) -> list[str]:
        """Strategy identifiers as display strings.

        The manifest records each strategy as an object (id plus the version that produced
        the run), because a result belongs to a specific version. A summary row needs one
        string, so the two are joined here rather than in every client — a client that
        rendered the object directly would print ``[object Object]``, which is exactly what
        happened before this existed. The full objects remain on the detail endpoint.
        """
        labels: list[str] = []
        for entry in self.manifest.get("strategies", []):
            if isinstance(entry, dict):
                name = str(entry.get("id", "unknown"))
                version = entry.get("version")
                labels.append(f"{name}@{version}" if version else name)
            else:
                labels.append(str(entry))
        return labels

    def to_dict(self, include_metrics: bool = True) -> dict[str, Any]:
        net = self.metrics.get("net", {})
        payload: dict[str, Any] = {
            "run_id": self.run_id,
            "created_at": self.created_at,
            "mode": self.manifest.get("mode"),
            "strategies": self.strategy_labels,
            "instruments": self.manifest.get("instruments", []),
            "fill_model": self.manifest.get("fill_model"),
            "reproducible": self.manifest.get("is_reproducible"),
            "result_hash": self.manifest.get("result_hash"),
            "warnings": self.warnings,
            "net_pnl": net.get("total_pnl"),
            "trade_count": net.get("trade_count"),
            "survives_costs": self.metrics.get("survives_costs"),
        }
        if include_metrics:
            payload["metrics"] = self.metrics
        return payload


@dataclass(slots=True)
class EngineState:
    """Everything the API can see.

    Args:
        config_dir: the shipped configuration.
        runs_dir: where completed runs are written. The API only ever reads it.
        state_dir: where the API's own durable state lives — currently the kill-switch
            file. Separate from ``runs_dir`` because the switch is not a run artefact, and
            because it lets a deployment mount the runs directory read-only: the record of
            what a run produced should not be alterable by the service that displays it.
            Defaults to ``runs_dir`` so a local session needs no extra path.
        kill_switch: the live switch. In this build it is API-local and persisted to disk,
            so tripping it survives a restart of the service. When the live trader exists
            it will pass in the same object the risk engine holds — the API must never own
            a *second* switch, or one of the two would be advisory.
    """

    config_dir: Path
    runs_dir: Path
    state_dir: Path
    bundle: ConfigBundle = field(init=False)
    registry: InstrumentRegistry = field(init=False)
    limits: RiskLimits = field(init=False)
    kill_switch: KillSwitch = field(init=False)
    started_at: int = field(default_factory=now_ns)

    def __init__(
        self,
        config_dir: str | Path,
        runs_dir: str | Path,
        kill_switch: KillSwitch | None = None,
        state_dir: str | Path | None = None,
    ) -> None:
        self.config_dir = Path(config_dir)
        self.runs_dir = Path(runs_dir)
        self.state_dir = Path(state_dir) if state_dir is not None else self.runs_dir
        self.started_at = now_ns()
        self.bundle = load_bundle(self.config_dir)
        self.registry = InstrumentRegistry.from_config(
            self.bundle["markets"], self.bundle["sessions"]
        )
        self.limits = RiskLimits.from_config(self.bundle["risk"])

        kill_cfg = self.bundle["risk"].section("kill_switch", required=False)
        self.kill_switch = kill_switch or KillSwitch(
            emergency_policy=EmergencyPolicy(kill_cfg.str_("emergency_policy", "HOLD")),
            min_trip_seconds=kill_cfg.float_("min_trip_seconds", 60.0),
            state_file=self.state_dir / "kill_switch_state.json",
        )
        _log.info(
            "api_state_initialised",
            config_hash=self.bundle.hash,
            instruments=len(self.registry),
            kill_switch=self.kill_switch.state.value,
            state_dir=str(self.state_dir),
        )

    @property
    def uptime_seconds(self) -> float:
        return (now_ns() - self.started_at) / 1_000_000_000

    # -- runs ---------------------------------------------------------------------------

    def iter_runs(self) -> Iterator[RunSummary]:
        """Yield completed runs, newest first.

        A run directory missing its manifest or metrics is skipped with a warning rather
        than raising: one interrupted run must not make the whole endpoint fail.
        """
        if not self.runs_dir.is_dir():
            return
        candidates = sorted(
            (p for p in self.runs_dir.iterdir() if p.is_dir()),
            key=lambda p: p.stat().st_mtime,
            reverse=True,
        )
        for directory in candidates:
            manifest_path = directory / "manifest.json"
            metrics_path = directory / "metrics.json"
            if not manifest_path.is_file() or not metrics_path.is_file():
                continue
            try:
                manifest = json.loads(manifest_path.read_text())
                metrics = json.loads(metrics_path.read_text())
            except (OSError, json.JSONDecodeError):
                _log.warning("unreadable_run_artefacts", directory=str(directory))
                continue
            yield RunSummary(directory.name, directory, manifest, metrics)

    def get_run(self, run_id: str) -> RunSummary | None:
        return next((r for r in self.iter_runs() if r.run_id == run_id), None)

    def read_run_rows(
        self, run_id: str, filename: str, limit: int, sample: bool = False
    ) -> tuple[list[dict[str, Any]], int]:
        """Read at most ``limit`` rows from one JSONL artefact, with the total available.

        Bounded on purpose: a tick-rate equity curve is millions of rows, and an endpoint
        that returns all of them is an endpoint that takes the service down.

        Args:
            sample: when true, spread the rows evenly across the whole file instead of
                taking the first ``limit``. A curve is the one case where the head of the
                file is actively misleading — the first 500 points of a 410,000-point
                equity curve are all at the opening balance, and a client drawing them
                renders a flat line for a run that made and lost money. The last row is
                always included so the curve ends where the run ended.

        Returns:
            The rows, and how many the artefact holds in total. The total is returned so a
            client can say it is showing a sample rather than the whole thing.
        """
        run = self.get_run(run_id)
        if run is None:
            return [], 0
        path = run.directory / filename
        if not path.is_file():
            return [], 0

        if not sample:
            rows: list[dict[str, Any]] = []
            total = 0
            with path.open() as handle:
                for line in handle:
                    if not line.strip():
                        continue
                    total += 1
                    if len(rows) < limit:
                        rows.append(json.loads(line))
            return rows, total

        total = sum(1 for line in path.open() if line.strip())
        if total == 0:
            return [], 0
        stride = max(1, total // limit)
        sampled: list[dict[str, Any]] = []
        with path.open() as handle:
            index = -1
            last_line = ""
            for line in handle:
                if not line.strip():
                    continue
                index += 1
                last_line = line
                if index % stride == 0 and len(sampled) < limit:
                    sampled.append(json.loads(line))
            # The final point is what the run actually ended at; a stride that happens not
            # to land on it would cut the curve short of its own result.
            if last_line and (index % stride != 0 or len(sampled) >= limit):
                if len(sampled) >= limit:
                    sampled.pop()
                sampled.append(json.loads(last_line))
        return sampled, total

    # -- configuration ------------------------------------------------------------------

    def safe_config(self, section: str | None = None) -> dict[str, Any]:
        """Configuration with every credential-shaped field removed, JSON-ready.

        Canonicalised as well as stripped: YAML yields ``datetime.date`` keys for a
        holiday calendar, and ``json.dumps`` refuses a non-string key, so a response
        containing one would fail at serialisation rather than at the boundary here.
        """
        if section is not None:
            cleaned = canonicalize(strip_credentials(self.bundle[section].data))
            # A config section is always a mapping; asserting it here keeps the response
            # type honest rather than casting a shape nobody checked.
            assert isinstance(cleaned, dict)
            return cleaned
        return {
            name: canonicalize(strip_credentials(self.bundle[name].data))
            for name in sorted(self.bundle.sections)
        }

    def health(self) -> dict[str, Any]:
        return {
            "status": "degraded" if self.kill_switch.is_tripped else "ok",
            "uptime_seconds": round(self.uptime_seconds, 3),
            "started_at": to_iso(self.started_at),
            "config_hash": self.bundle.hash,
            "instruments": len(self.registry),
            "kill_switch": self.kill_switch.state.value,
            "runs_available": sum(1 for _ in self.iter_runs()),
        }


_STATE: EngineState | None = None


def set_state(state: EngineState) -> None:
    """Install the state the routers read. Called once at startup."""
    global _STATE
    _STATE = state


def get_state() -> EngineState:
    """The installed state.

    Raises:
        RuntimeError: when the API is used before startup completed. Failing here is
            better than serving a route backed by nothing.
    """
    if _STATE is None:
        raise RuntimeError("engine state has not been initialised; call set_state() first")
    return _STATE

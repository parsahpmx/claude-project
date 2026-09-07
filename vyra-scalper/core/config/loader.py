"""Configuration loading, validation and versioning.

Every trading parameter lives in ``configs/*.yaml``; strategy source files contain no
numeric trading constants (``ARCHITECTURE.md`` §5.6).  Two properties matter:

* **Traceability** — a loaded config is hashed, and that hash is written into every
  backtest manifest and live session record, so a result can always be tied back to the
  parameters that produced it.
* **Fail-fast validation** — a missing or mistyped key raises at load, naming the file and
  the key path.  A ``None`` that reaches the risk engine as a threshold is a limit that
  never binds.
"""

from __future__ import annotations

import os
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, TypeVar

import yaml

from core.util.ids import content_hash

__all__ = ["ConfigBundle", "ConfigError", "ConfigSection", "load_bundle", "load_yaml"]

T = TypeVar("T")

_ENV_PATTERN = re.compile(r"\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}")


class ConfigError(ValueError):
    """Raised for any malformed or missing configuration.

    Always carries the file and the key path, because "invalid config" without a location
    costs more time than the bug itself.
    """


def _expand_env(value: str, *, source: str) -> str:
    """Substitute ``${VAR}`` / ``${VAR:-default}`` references from the environment.

    Secrets are supplied this way and never written to a config file (§27 of the platform
    specification).  A reference with no value and no default raises rather than silently
    resolving to an empty string, which would produce an anonymous connection attempt.
    """

    def replace(match: re.Match[str]) -> str:
        name, default = match.group(1), match.group(2)
        env_value = os.environ.get(name)
        if env_value is not None:
            return env_value
        if default is not None:
            return default
        raise ConfigError(
            f"{source}: environment variable {name!r} is referenced but not set, "
            "and no default was given"
        )

    return _ENV_PATTERN.sub(replace, value)


def _expand_tree(node: Any, *, source: str) -> Any:
    if isinstance(node, str):
        return _expand_env(node, source=source)
    if isinstance(node, dict):
        return {k: _expand_tree(v, source=source) for k, v in node.items()}
    if isinstance(node, list):
        return [_expand_tree(v, source=source) for v in node]
    return node


def load_yaml(path: str | Path) -> dict[str, Any]:
    """Read a YAML file into a dict, expanding environment references.

    Raises:
        ConfigError: if the file is missing, unparseable, or does not contain a mapping.
    """
    p = Path(path)
    if not p.is_file():
        raise ConfigError(f"config file not found: {p}")
    try:
        raw = yaml.safe_load(p.read_text()) or {}
    except yaml.YAMLError as exc:
        raise ConfigError(f"{p}: YAML parse error: {exc}") from exc
    if not isinstance(raw, dict):
        raise ConfigError(f"{p}: top level must be a mapping, got {type(raw).__name__}")
    return _expand_tree(raw, source=str(p))


@dataclass(frozen=True, slots=True)
class ConfigSection:
    """A validated view over one config mapping.

    Accessors are explicit about type and requiredness so that a wrong type in YAML is
    caught at load with a readable message instead of surfacing as a ``TypeError`` inside
    the risk engine hours later.
    """

    name: str
    data: dict[str, Any]
    source: str = ""

    def _fail(self, key: str, message: str) -> ConfigError:
        location = f"{self.source}:" if self.source else ""
        return ConfigError(f"{location}{self.name}.{key}: {message}")

    def get(self, key: str, default: Any = None) -> Any:
        return self.data.get(key, default)

    def require(self, key: str) -> Any:
        """Return ``key``'s value, raising if absent or ``None``."""
        if key not in self.data or self.data[key] is None:
            raise self._fail(key, "required value is missing")
        return self.data[key]

    def float_(self, key: str, default: float | None = None) -> float:
        value = self.data.get(key, default)
        if value is None:
            raise self._fail(key, "required float is missing")
        try:
            return float(value)
        except (TypeError, ValueError) as exc:
            raise self._fail(key, f"expected a number, got {value!r}") from exc

    def int_(self, key: str, default: int | None = None) -> int:
        value = self.data.get(key, default)
        if value is None:
            raise self._fail(key, "required integer is missing")
        if isinstance(value, bool):  # bool is an int subclass; almost never intended here
            raise self._fail(key, f"expected an integer, got boolean {value!r}")
        try:
            return int(value)
        except (TypeError, ValueError) as exc:
            raise self._fail(key, f"expected an integer, got {value!r}") from exc

    def bool_(self, key: str, default: bool | None = None) -> bool:
        value = self.data.get(key, default)
        if value is None:
            raise self._fail(key, "required boolean is missing")
        if isinstance(value, bool):
            return value
        if isinstance(value, str) and value.lower() in ("true", "false", "yes", "no", "1", "0"):
            return value.lower() in ("true", "yes", "1")
        raise self._fail(key, f"expected a boolean, got {value!r}")

    def str_(self, key: str, default: str | None = None) -> str:
        value = self.data.get(key, default)
        if value is None:
            raise self._fail(key, "required string is missing")
        return str(value)

    def list_(self, key: str, default: list[Any] | None = None) -> list[Any]:
        value = self.data.get(key, default if default is not None else [])
        if not isinstance(value, list):
            raise self._fail(key, f"expected a list, got {type(value).__name__}")
        return value

    def section(self, key: str, required: bool = True) -> ConfigSection:
        """Return a nested section.  Missing optional sections come back empty."""
        value = self.data.get(key)
        if value is None:
            if required:
                raise self._fail(key, "required section is missing")
            value = {}
        if not isinstance(value, dict):
            raise self._fail(key, f"expected a mapping, got {type(value).__name__}")
        return ConfigSection(f"{self.name}.{key}", value, self.source)

    def in_range(
        self, key: str, low: float, high: float, default: float | None = None
    ) -> float:
        """Read a float and assert ``low <= value <= high``.

        Used for fractions and percentages, where a value entered as ``2`` instead of
        ``0.02`` is a 100× risk error that the type system cannot catch.
        """
        value = self.float_(key, default)
        if not low <= value <= high:
            raise self._fail(key, f"value {value} is outside the allowed range [{low}, {high}]")
        return value

    def keys(self) -> list[str]:
        return list(self.data)

    def items(self) -> list[tuple[str, Any]]:
        return list(self.data.items())


@dataclass(frozen=True, slots=True)
class ConfigBundle:
    """All configuration for one run, with per-file and aggregate hashes.

    The aggregate ``hash`` is what appears in a backtest manifest.  Changing any byte of
    any config file changes it, so two runs claiming the same hash genuinely used the same
    parameters.
    """

    sections: dict[str, ConfigSection]
    file_hashes: dict[str, str]
    root: str = ""
    _hash: str = field(default="", repr=False)

    @property
    def hash(self) -> str:
        return self._hash

    def __getitem__(self, name: str) -> ConfigSection:
        try:
            return self.sections[name]
        except KeyError:
            available = ", ".join(sorted(self.sections)) or "(none)"
            raise ConfigError(
                f"config section {name!r} was not loaded; available: {available}"
            ) from None

    def get(self, name: str) -> ConfigSection | None:
        return self.sections.get(name)

    def manifest(self) -> dict[str, Any]:
        """The provenance block embedded in run manifests."""
        return {"config_hash": self._hash, "configs": dict(self.file_hashes), "root": self.root}


def load_bundle(config_dir: str | Path, names: list[str] | None = None) -> ConfigBundle:
    """Load every named config file from ``config_dir``.

    Args:
        config_dir: directory containing the YAML files.
        names: bare names without extension, e.g. ``["risk", "markets"]``.  Defaults to
            the standard set.

    Raises:
        ConfigError: if the directory or any named file is missing.  Missing config is a
            startup failure, never a "use defaults" path — defaults that nobody wrote down
            are the parameters you cannot reproduce.
    """
    root = Path(config_dir)
    if not root.is_dir():
        raise ConfigError(f"config directory not found: {root}")
    wanted = names or [
        "markets",
        "sessions",
        "risk",
        "strategies",
        "brokers",
        "execution",
        "backtest",
    ]

    sections: dict[str, ConfigSection] = {}
    file_hashes: dict[str, str] = {}
    for name in wanted:
        path = root / f"{name}.yaml"
        data = load_yaml(path)
        sections[name] = ConfigSection(name, data, str(path))
        file_hashes[f"{name}.yaml"] = content_hash(data)

    aggregate = content_hash({name: sections[name].data for name in sorted(sections)})
    return ConfigBundle(sections=sections, file_hashes=file_hashes, root=str(root), _hash=aggregate)

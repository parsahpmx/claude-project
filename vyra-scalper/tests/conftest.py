"""Shared fixtures.

Fixtures build objects from the *real* ``configs/`` directory wherever possible, so the
test suite exercises the configuration the platform actually ships with.  A test that
passes against a hand-built fixture but fails against the shipped config is a test that
proves nothing.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from core.config.loader import ConfigBundle, load_bundle
from core.events.enums import AssetClass
from core.instruments.instrument import Instrument
from core.instruments.registry import InstrumentRegistry

REPO_ROOT = Path(__file__).resolve().parents[1]
CONFIG_DIR = REPO_ROOT / "configs"


@pytest.fixture(scope="session")
def config_bundle() -> ConfigBundle:
    return load_bundle(CONFIG_DIR)


@pytest.fixture(scope="session")
def registry(config_bundle: ConfigBundle) -> InstrumentRegistry:
    return InstrumentRegistry.from_config(config_bundle["markets"], config_bundle["sessions"])


@pytest.fixture(scope="session")
def mes(registry: InstrumentRegistry) -> Instrument:
    """Micro E-mini S&P: tick 0.25, multiplier 5, tick value 1.25."""
    return registry.get("CME:MES")


@pytest.fixture(scope="session")
def es(registry: InstrumentRegistry) -> Instrument:
    """E-mini S&P: tick 0.25, multiplier 50, tick value 12.50."""
    return registry.get("CME:ES")


@pytest.fixture(scope="session")
def aapl(registry: InstrumentRegistry) -> Instrument:
    return registry.get("NASDAQ:AAPL")


@pytest.fixture(scope="session")
def xauusd(registry: InstrumentRegistry) -> Instrument:
    """A CFD instrument — no centralised depth, broker-defined contract size."""
    return registry.get("CFD:XAUUSD")


@pytest.fixture
def synthetic_equity() -> Instrument:
    """A minimal equity used where a registry is unnecessary."""
    return Instrument(
        instrument_id="TEST:EQ",
        symbol="EQ",
        asset_class=AssetClass.EQUITY,
        exchange="TEST",
        currency="USD",
        tick_size=0.01,
        tick_value=0.01,
        multiplier=1.0,
        session_id="24x7",
    )

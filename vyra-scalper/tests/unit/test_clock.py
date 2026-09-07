"""Time handling: exactness, timezone correctness and DST behaviour."""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta

import pytest

from core.util.clock import (
    NS_PER_DAY,
    NS_PER_HOUR,
    NS_PER_SEC,
    add_days,
    align_down,
    day_start_ns,
    format_duration,
    from_datetime,
    from_iso,
    local_date,
    to_datetime,
    to_iso,
)


class TestConversionExactness:
    @pytest.mark.parametrize(
        "iso",
        [
            "2024-03-15T14:30:00.123456Z",
            "1969-07-20T20:17:00Z",  # pre-epoch: naive int(timestamp()) truncates wrongly
            "2035-11-01T05:00:00+00:00",
            "1970-01-01T00:00:00Z",
        ],
    )
    def test_iso_round_trip_is_exact(self, iso: str) -> None:
        ts = from_iso(iso)
        assert from_iso(to_iso(ts)) == ts

    def test_pre_epoch_is_negative_and_exact(self) -> None:
        ts = from_iso("1969-12-31T23:59:59Z")
        assert ts == -NS_PER_SEC

    def test_microsecond_resolution_survives(self) -> None:
        ts = from_iso("2024-01-01T00:00:00.000001Z")
        assert ts == from_iso("2024-01-01T00:00:00Z") + 1_000

    def test_large_timestamp_does_not_lose_precision(self) -> None:
        """A float division by 1e9 would quantise this to the nearest ~256 ns."""
        ts = from_iso("2024-06-01T12:00:00Z") + 123_456
        assert to_datetime(ts).microsecond == 123

    def test_naive_datetime_is_rejected(self) -> None:
        with pytest.raises(ValueError, match="naive datetime"):
            from_datetime(datetime(2024, 1, 1, 12, 0))

    def test_iso_without_offset_is_rejected(self) -> None:
        with pytest.raises(ValueError, match="no timezone offset"):
            from_iso("2024-01-01T12:00:00")


class TestTimezoneHandling:
    def test_local_date_differs_from_utc_date_across_the_boundary(self) -> None:
        ts = from_iso("2024-03-15T02:00:00Z")  # 21:00 previous day in Chicago
        assert local_date(ts, "UTC") == date(2024, 3, 15)
        assert local_date(ts, "America/Chicago") == date(2024, 3, 14)

    def test_day_start_respects_dst(self) -> None:
        """US DST began 10 March 2024; the 9th->10th gap is 23 hours, not 24."""
        before = day_start_ns(date(2024, 3, 9), "America/New_York")
        after = day_start_ns(date(2024, 3, 10), "America/New_York")
        assert after - before == 24 * NS_PER_HOUR
        next_day = day_start_ns(date(2024, 3, 11), "America/New_York")
        assert next_day - after == 23 * NS_PER_HOUR

    def test_add_days_preserves_local_wall_clock_across_dst(self) -> None:
        ts = from_datetime(datetime(2024, 3, 9, 12, 0, tzinfo=UTC))
        moved = add_days(ts, 2, "America/New_York")
        assert to_datetime(moved, "America/New_York").hour == to_datetime(
            ts, "America/New_York"
        ).hour
        # Physical elapsed time is one hour short of two nominal days.
        assert moved - ts == 2 * NS_PER_DAY - NS_PER_HOUR


class TestAlignment:
    def test_aligns_to_grid_from_epoch(self) -> None:
        ts = from_iso("2024-03-15T14:37:22Z")
        assert to_iso(align_down(ts, NS_PER_HOUR)) == "2024-03-15T14:00:00+00:00"

    def test_aligns_to_a_session_origin_not_utc_midnight(self) -> None:
        """A 4h bar on a session opening at 17:00 must start at the session open."""
        origin = from_iso("2024-03-14T22:00:00Z")
        ts = from_iso("2024-03-15T03:30:00Z")
        assert to_iso(align_down(ts, 4 * NS_PER_HOUR, origin)) == "2024-03-15T02:00:00+00:00"

    def test_floors_toward_negative_infinity_before_the_origin(self) -> None:
        origin = from_iso("2024-03-15T00:00:00Z")
        ts = origin - 1
        assert align_down(ts, NS_PER_HOUR, origin) == origin - NS_PER_HOUR

    def test_rejects_non_positive_interval(self) -> None:
        with pytest.raises(ValueError, match="must be positive"):
            align_down(0, 0)


def test_format_duration_scales() -> None:
    assert format_duration(500) == "500ns"
    assert format_duration(1_500) == "1.5us"
    assert format_duration(2_500_000) == "2.5ms"
    assert format_duration(90 * NS_PER_SEC) == "1.5m"

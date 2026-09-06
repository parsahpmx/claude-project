import { describe, expect, it } from 'vitest';
import {
  formatNumber, formatDistance, formatDuration, formatPace, formatElevation,
  formatDate, formatTime, formatLoadG, isoDate, addDays, startOfWeek,
} from './format';

/**
 * These matter more than they look. The V1 web app shipped a hydration error
 * caused by Node and Chromium disagreeing on an `Intl` month abbreviation, so
 * this module avoids `Intl` entirely — and these tests are what keep it that way.
 */
describe('numbers', () => {
  it('groups thousands', () => {
    expect(formatNumber(1234567)).toBe('1,234,567');
    expect(formatNumber(999)).toBe('999');
    expect(formatNumber(-4200)).toBe('-4,200');
    expect(formatNumber(0)).toBe('0');
  });
});

describe('distance', () => {
  it('switches from metres to kilometres at 1000', () => {
    expect(formatDistance(999)).toBe('999 m');
    expect(formatDistance(1000)).toBe('1.00 km');
  });

  it('drops a decimal place past ten kilometres', () => {
    expect(formatDistance(5432)).toBe('5.43 km');
    expect(formatDistance(15432)).toBe('15.4 km');
  });

  it('converts to miles when asked', () => {
    expect(formatDistance(1609.344, 'imperial')).toBe('1.00 mi');
  });
});

describe('duration', () => {
  it('drops the hour when there is not one', () => {
    expect(formatDuration(65)).toBe('1:05');
    expect(formatDuration(3665)).toBe('1:01:05');
  });

  it('never renders a negative time', () => {
    expect(formatDuration(-10)).toBe('0:00');
  });
});

describe('pace', () => {
  it('formats seconds per kilometre', () => {
    expect(formatPace(300)).toBe('5:00/km');
    expect(formatPace(329)).toBe('5:29/km');
  });

  it('converts to miles', () => {
    expect(formatPace(300, 'imperial')).toBe('8:03/mi');
  });

  it('shows a dash rather than a fabricated pace', () => {
    expect(formatPace(null)).toBe('—');
  });
});

describe('dates', () => {
  it('formats without Intl and without the current year', () => {
    // A Sunday, deliberately: the weekday index must not be off by one.
    expect(formatDate('2026-09-06T10:00:00.000Z', new Date('2026-01-01T00:00:00Z')))
      .toBe('Sun 6 Sep');
  });

  it('adds the year when it is not the current one', () => {
    expect(formatDate('2025-03-04T10:00:00.000Z', new Date('2026-01-01T00:00:00Z')))
      .toBe('Tue 4 Mar 2025');
  });

  it('returns a dash for an unparseable value rather than "Invalid Date"', () => {
    expect(formatDate('not a date')).toBe('—');
    expect(formatTime('not a date')).toBe('—');
  });

  it('formats time zero-padded', () => {
    expect(formatTime('2026-09-06T07:05:00.000Z')).toBe('07:05');
  });
});

describe('date arithmetic', () => {
  it('adds days across a month boundary', () => {
    expect(addDays('2026-08-31', 1)).toBe('2026-09-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('starts the week on Monday, because training weeks do', () => {
    expect(startOfWeek('2026-09-06')).toBe('2026-08-31'); // Sunday → previous Monday
    expect(startOfWeek('2026-08-31')).toBe('2026-08-31'); // Monday → itself
    expect(startOfWeek('2026-09-05')).toBe('2026-08-31'); // Saturday → that Monday
  });

  it('round-trips through isoDate', () => {
    expect(isoDate(new Date('2026-09-06T23:30:00.000Z'))).toBe('2026-09-06');
  });
});

describe('load', () => {
  it('renders whole kilos without a spurious decimal', () => {
    expect(formatLoadG(100_000)).toBe('100 kg');
    expect(formatLoadG(102_500)).toBe('102.5 kg');
  });

  it('converts to pounds', () => {
    expect(formatLoadG(45_359, 'imperial')).toBe('100.0 lb');
  });
});

describe('elevation', () => {
  it('formats metres and feet', () => {
    expect(formatElevation(1234)).toBe('1,234 m');
    expect(formatElevation(1000, 'imperial')).toBe('3,281 ft');
  });
});

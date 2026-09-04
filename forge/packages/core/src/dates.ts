/**
 * Calendar helpers.
 *
 * Everything the member sees is anchored to a plain `YYYY-MM-DD` local day, not
 * an instant. A workout scheduled for Monday must stay on Monday when the
 * member flies to Tokyo mid-block, so plan days never carry a timezone.
 */

export type IsoDate = string;

const DAY_MS = 86_400_000;

export const WEEKDAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;

export function toIsoDate(date: Date): IsoDate {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function fromIsoDate(iso: IsoDate): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1));
}

export function addDays(iso: IsoDate, days: number): IsoDate {
  return toIsoDate(new Date(fromIsoDate(iso).getTime() + days * DAY_MS));
}

export function daysBetween(from: IsoDate, to: IsoDate): number {
  return Math.round((fromIsoDate(to).getTime() - fromIsoDate(from).getTime()) / DAY_MS);
}

/** 0 = Sunday, matching `Date.getUTCDay()`. */
export function weekdayIndex(iso: IsoDate): number {
  return fromIsoDate(iso).getUTCDay();
}

export function weekdayName(iso: IsoDate): string {
  return WEEKDAY_NAMES[weekdayIndex(iso)] ?? 'Monday';
}

/** The Monday on or before `iso` — FORGE training weeks always start Monday. */
export function startOfWeek(iso: IsoDate): IsoDate {
  const dow = weekdayIndex(iso);
  const backtrack = dow === 0 ? 6 : dow - 1;
  return addDays(iso, -backtrack);
}

export function formatLongDate(iso: IsoDate): string {
  const date = fromIsoDate(iso);
  const weekday = WEEKDAY_NAMES[date.getUTCDay()] ?? '';
  const month = MONTH_NAMES[date.getUTCMonth()] ?? '';
  return `${weekday}, ${month} ${date.getUTCDate()}`;
}

export function formatShortDate(iso: IsoDate): string {
  const date = fromIsoDate(iso);
  const month = MONTH_NAMES[date.getUTCMonth()]?.slice(0, 3) ?? '';
  return `${month} ${date.getUTCDate()}`;
}

/** Inclusive list of ISO days from `from` to `to`. */
export function eachDay(from: IsoDate, to: IsoDate): IsoDate[] {
  const out: IsoDate[] = [];
  const span = daysBetween(from, to);
  for (let i = 0; i <= span; i += 1) out.push(addDays(from, i));
  return out;
}

/** Minutes past midnight → "07:30", used by every plan timeline in the product. */
export function formatClock(minutesFromMidnight: number): string {
  const total = ((Math.round(minutesFromMidnight) % 1440) + 1440) % 1440;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * Display formatting.
 *
 * Every number a member sees passes through here, so a load, a duration or a
 * price is formatted identically on the dashboard, in the player and in an
 * email. Unit conversion happens at this boundary and nowhere else.
 */

export type UnitSystem = 'metric' | 'imperial';

export function formatLoad(grams: number, system: UnitSystem = 'metric'): string {
  if (grams <= 0) return 'Bodyweight';
  if (system === 'imperial') return `${trim(grams / 453.59237, 1)} lb`;
  return `${trim(grams / 1000, 1)} kg`;
}

export function formatVolume(grams: number, system: UnitSystem = 'metric'): string {
  const value = system === 'imperial' ? grams / 453.59237 : grams / 1000;
  if (value >= 1000) return `${trim(value / 1000, 1)}${system === 'imperial' ? 'k lb' : 't'}`;
  return `${formatNumber(value)} ${system === 'imperial' ? 'lb' : 'kg'}`;
}

export function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

export function formatSeconds(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function formatDuration(seconds: number): string {
  return formatMinutes(Math.round(seconds / 60));
}

export function formatCents(cents: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
}

/**
 * Number and date formatting without `Intl`.
 *
 * `Intl` output is not identical across runtimes: Node and Chromium disagree
 * about the `en-GB` abbreviation for September ("Sept" against "Sep"), which
 * makes any server-rendered date a hydration mismatch for one month of the
 * year. Explicit tables are longer and are the same string everywhere.
 */

const WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const WEEKDAYS_LONG = [
  'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday',
] as const;
const MONTHS_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const;
const MONTHS_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;

/** Thousands separators only — no locale-dependent digits or grouping rules. */
export function formatNumber(value: number): string {
  const rounded = Math.round(value);
  const sign = rounded < 0 ? '-' : '';
  return sign + String(Math.abs(rounded)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export function formatSleep(minutes: number | null | undefined): string {
  if (!minutes) return '—';
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;
}

export function formatDateLabel(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return iso;
  return `${WEEKDAYS_SHORT[date.getUTCDay()]}, ${date.getUTCDate()} ${MONTHS_SHORT[date.getUTCMonth()]}`;
}

export function formatLongDate(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return iso;
  return `${WEEKDAYS_LONG[date.getUTCDay()]}, ${date.getUTCDate()} ${MONTHS_LONG[date.getUTCMonth()]}`;
}

export function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return `${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}`;
}

/** "Fri, 4 Sep, 18:30" — the one-line form used for bookings and calls. */
export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return `${formatDateLabel(date.toISOString().slice(0, 10))}, ${formatTime(iso)}`;
}

export function relativeTime(iso: string, now = new Date()): string {
  const diffMs = now.getTime() - new Date(iso).getTime();
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return formatDateLabel(iso.slice(0, 10));
}

export function formatRating(tenths: number): string {
  return (tenths / 10).toFixed(1);
}

export function initials(firstName: string, lastName: string): string {
  return `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase();
}

function trim(value: number, decimals: number): string {
  return value.toFixed(decimals).replace(/\.0+$/, '');
}

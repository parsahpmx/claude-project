/**
 * Formatting without `Intl`.
 *
 * Node and the browser can disagree on locale data — the month abbreviation for
 * September differs between them under en-GB — and a server/client disagreement
 * inside a React tree is a hydration error, not a cosmetic one. These are
 * deterministic everywhere.
 */

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

export function formatNumber(value: number): string {
  const rounded = Math.round(value);
  const sign = rounded < 0 ? '-' : '';
  return sign + String(Math.abs(rounded)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export function formatDistance(metres: number, units: 'metric' | 'imperial' = 'metric'): string {
  if (units === 'imperial') {
    const miles = metres / 1609.344;
    return miles < 10 ? `${miles.toFixed(2)} mi` : `${miles.toFixed(1)} mi`;
  }
  if (metres < 1000) return `${Math.round(metres)} m`;
  const km = metres / 1000;
  return km < 10 ? `${km.toFixed(2)} km` : `${km.toFixed(1)} km`;
}

export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

/** Pace as m:ss per km or mile. */
export function formatPace(
  secondsPerKm: number | null,
  units: 'metric' | 'imperial' = 'metric',
): string {
  if (secondsPerKm === null) return '—';
  const perUnit = units === 'imperial' ? secondsPerKm * 1.609344 : secondsPerKm;
  const m = Math.floor(perUnit / 60);
  const s = Math.round(perUnit % 60);
  const suffix = units === 'imperial' ? '/mi' : '/km';
  return `${m}:${String(s).padStart(2, '0')}${suffix}`;
}

export function formatElevation(metres: number, units: 'metric' | 'imperial' = 'metric'): string {
  if (units === 'imperial') return `${formatNumber(metres * 3.28084)} ft`;
  return `${formatNumber(metres)} m`;
}

/** "Sat 6 Sep" — no locale lookup, no year unless it is not this one. */
export function formatDate(iso: string, today = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const base = `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
  return d.getUTCFullYear() === today.getUTCFullYear() ? base : `${base} ${d.getUTCFullYear()}`;
}

export function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

export function formatLoadG(grams: number, units: 'metric' | 'imperial' = 'metric'): string {
  if (units === 'imperial') return `${(grams / 453.592).toFixed(1)} lb`;
  const kg = grams / 1000;
  return Number.isInteger(kg) ? `${kg} kg` : `${kg.toFixed(1)} kg`;
}

export const SPORT_LABEL: Record<string, string> = {
  run: 'Run',
  walk: 'Walk',
  hike: 'Hike',
  ride: 'Ride',
  strength: 'Strength',
  functional: 'Functional',
  mobility: 'Mobility',
};

export const SPORT_GLYPH: Record<string, string> = {
  run: '▶',
  walk: '◦',
  hike: '△',
  ride: '◍',
  strength: '▤',
  functional: '◈',
  mobility: '◐',
};

/** ISO date (YYYY-MM-DD) arithmetic without a date library. */
export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return isoDate(d);
}

/** Monday-based start of week, which is how training weeks are counted. */
export function startOfWeek(iso: string): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  const day = (d.getUTCDay() + 6) % 7;
  return addDays(iso, -day);
}

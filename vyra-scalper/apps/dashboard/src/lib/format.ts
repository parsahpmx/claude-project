/** Display helpers. Formatting only — no figure is computed here. */

/**
 * Money, with the sign kept.
 *
 * Never rounded to whole units: the difference between a gross and a net result is often
 * the cents, and that difference is the point of the whole platform.
 */
export function money(value: number | null | undefined, currency = "USD"): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function pct(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `${(value * 100).toFixed(digits)}%`;
}

export function num(value: unknown, digits = 2): string {
  if (typeof value === "number") {
    return Number.isInteger(value) ? String(value) : value.toFixed(digits);
  }
  if (value === null || value === undefined) return "—";
  return String(value);
}

export function timestamp(value: string | null | undefined): string {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  // UTC everywhere. The engine's internal clock is UTC nanoseconds, and a console that
  // renders local time invites an operator to compare two clocks that disagree.
  return `${parsed.toISOString().replace("T", " ").slice(0, 19)}Z`;
}

export function duration(seconds: number): string {
  if (seconds < 60) return `${seconds.toFixed(0)}s`;
  if (seconds < 3600) return `${(seconds / 60).toFixed(0)}m`;
  if (seconds < 86400) return `${(seconds / 3600).toFixed(1)}h`;
  return `${(seconds / 86400).toFixed(1)}d`;
}

/** Column labels from snake_case keys, so a new engine field renders readably. */
export function label(key: string): string {
  return key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

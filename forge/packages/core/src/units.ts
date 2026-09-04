/**
 * Unit and number handling.
 *
 * Loads are stored as integer grams, never floats: 2.5 kg plate arithmetic
 * accumulates visible error in float kilograms over a twelve-week block, and a
 * member comparing "102.49999kg" against last week's PR loses trust in every
 * other number on the screen. Display converts at the edge.
 */

export const GRAMS_PER_KG = 1000;
export const GRAMS_PER_LB = 453.59237;

export function kgToGrams(kg: number): number {
  return Math.round(kg * GRAMS_PER_KG);
}

export function gramsToKg(grams: number): number {
  return grams / GRAMS_PER_KG;
}

export function lbToGrams(lb: number): number {
  return Math.round(lb * GRAMS_PER_LB);
}

export function gramsToLb(grams: number): number {
  return grams / GRAMS_PER_LB;
}

/** Round a load to the smallest plate jump the member can actually make. */
export function roundToPlate(grams: number, incrementGrams = 2500): number {
  if (incrementGrams <= 0) return grams;
  return Math.round(grams / incrementGrams) * incrementGrams;
}

export function formatLoad(grams: number, system: 'metric' | 'imperial' = 'metric'): string {
  if (system === 'imperial') {
    const lb = gramsToLb(grams);
    return `${trimNumber(lb, 1)} lb`;
  }
  return `${trimNumber(gramsToKg(grams), 1)} kg`;
}

export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/** Drop trailing zeros so 100.0 reads as "100" but 102.5 keeps its half. */
export function trimNumber(value: number, decimals: number): string {
  const fixed = value.toFixed(decimals);
  return fixed.replace(/\.?0+$/, '');
}

export function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, value));
}

/** Map a value from one range to another, clamped at both ends. */
export function scale(
  value: number,
  fromLow: number,
  fromHigh: number,
  toLow: number,
  toHigh: number,
): number {
  if (fromHigh === fromLow) return toLow;
  const t = clamp((value - fromLow) / (fromHigh - fromLow), 0, 1);
  return toLow + t * (toHigh - toLow);
}

export function sum(values: readonly number[]): number {
  let total = 0;
  for (const v of values) total += v;
  return total;
}

export function average(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return sum(values) / values.length;
}

export function percent(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return clamp(Math.round((part / whole) * 100), 0, 100);
}

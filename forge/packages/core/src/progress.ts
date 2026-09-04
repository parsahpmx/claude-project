import { addDays, daysBetween, eachDay, type IsoDate } from './dates.js';
import type { MuscleGroup } from './types.js';
import { average, clamp, percent, sum } from './units.js';

/**
 * Progress analytics.
 *
 * The Progress page answers "am I making progress?", which means every series
 * here must be honest about gaps. A member who missed three weeks should see
 * three weeks of nothing, not an interpolated line that flatters them.
 */

export interface WorkoutRecord {
  date: IsoDate;
  durationMinutes: number;
  volumeGrams: number;
  calories: number;
  averageHeartRate?: number;
  kind: string;
  muscleGroups: MuscleGroup[];
}

export interface ProgressSummary {
  totalWorkouts: number;
  trainingHours: number;
  totalVolumeGrams: number;
  totalCalories: number;
  currentStreakDays: number;
  longestStreakDays: number;
  weeklyAverage: number;
}

export function summariseProgress(records: readonly WorkoutRecord[], today: IsoDate): ProgressSummary {
  const dates = [...new Set(records.map((r) => r.date))].sort();
  const streaks = computeStreaks(dates, today);
  const first = dates[0];
  const weeksElapsed = first ? Math.max(1, daysBetween(first, today) / 7) : 1;

  return {
    totalWorkouts: records.length,
    trainingHours: Math.round((sum(records.map((r) => r.durationMinutes)) / 60) * 10) / 10,
    totalVolumeGrams: sum(records.map((r) => r.volumeGrams)),
    totalCalories: sum(records.map((r) => r.calories)),
    currentStreakDays: streaks.current,
    longestStreakDays: streaks.longest,
    weeklyAverage: Math.round((records.length / weeksElapsed) * 10) / 10,
  };
}

/**
 * Streaks count *weeks with at least one session*, expressed in days, and allow
 * a single rest day gap. Punishing a member for taking Sunday off would make
 * the streak a worse metric than no metric.
 */
export function computeStreaks(
  sortedDates: readonly IsoDate[],
  today: IsoDate,
): { current: number; longest: number } {
  if (sortedDates.length === 0) return { current: 0, longest: 0 };

  let longest = 1;
  let run = 1;
  for (let i = 1; i < sortedDates.length; i += 1) {
    const gap = daysBetween(sortedDates[i - 1]!, sortedDates[i]!);
    if (gap <= 2) {
      run += gap;
      longest = Math.max(longest, run);
    } else {
      run = 1;
    }
  }

  const last = sortedDates[sortedDates.length - 1]!;
  const sinceLast = daysBetween(last, today);
  if (sinceLast > 2) return { current: 0, longest };

  let current = 1;
  for (let i = sortedDates.length - 1; i > 0; i -= 1) {
    const gap = daysBetween(sortedDates[i - 1]!, sortedDates[i]!);
    if (gap > 2) break;
    current += gap;
  }
  return { current: current + sinceLast, longest: Math.max(longest, current) };
}

export interface SeriesPoint {
  date: IsoDate;
  value: number;
}

/** Weekly totals, with empty weeks preserved as zeroes. */
export function weeklyVolume(records: readonly WorkoutRecord[], from: IsoDate, to: IsoDate): SeriesPoint[] {
  const buckets = new Map<IsoDate, number>();
  for (let cursor = from; daysBetween(cursor, to) >= 0; cursor = addDays(cursor, 7)) {
    buckets.set(cursor, 0);
  }
  for (const record of records) {
    const offset = daysBetween(from, record.date);
    if (offset < 0) continue;
    const bucket = addDays(from, Math.floor(offset / 7) * 7);
    if (buckets.has(bucket)) buckets.set(bucket, (buckets.get(bucket) ?? 0) + record.volumeGrams);
  }
  return [...buckets.entries()].map(([date, value]) => ({ date, value }));
}

export interface HeatmapCell {
  date: IsoDate;
  count: number;
  /** 0–4, for the five-step colour ramp. Never colour alone conveys the value. */
  intensity: number;
}

export function consistencyHeatmap(
  records: readonly WorkoutRecord[],
  from: IsoDate,
  to: IsoDate,
): HeatmapCell[] {
  const counts = new Map<IsoDate, number>();
  for (const record of records) counts.set(record.date, (counts.get(record.date) ?? 0) + 1);

  return eachDay(from, to).map((date) => {
    const count = counts.get(date) ?? 0;
    return { date, count, intensity: count === 0 ? 0 : clamp(count + 1, 1, 4) };
  });
}

export interface MuscleDistribution {
  group: MuscleGroup;
  sessions: number;
  share: number;
}

export function muscleDistribution(records: readonly WorkoutRecord[]): MuscleDistribution[] {
  const counts = new Map<MuscleGroup, number>();
  for (const record of records) {
    for (const group of record.muscleGroups) counts.set(group, (counts.get(group) ?? 0) + 1);
  }
  const total = sum([...counts.values()]);
  return [...counts.entries()]
    .map(([group, sessions]) => ({ group, sessions, share: percent(sessions, total) }))
    .sort((a, b) => b.sessions - a.sessions);
}

export interface StrengthPoint {
  date: IsoDate;
  estimatedOneRepMax: number;
}

export interface StrengthTrend {
  exerciseId: string;
  points: StrengthPoint[];
  startGrams: number;
  currentGrams: number;
  changeGrams: number;
  changePercent: number;
}

export function strengthTrend(exerciseId: string, points: readonly StrengthPoint[]): StrengthTrend | null {
  if (points.length === 0) return null;
  const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date));
  const start = sorted[0]!.estimatedOneRepMax;
  const current = sorted[sorted.length - 1]!.estimatedOneRepMax;
  return {
    exerciseId,
    points: sorted,
    startGrams: start,
    currentGrams: current,
    changeGrams: current - start,
    changePercent: start > 0 ? Math.round(((current - start) / start) * 1000) / 10 : 0,
  };
}

/**
 * Adherence as the member would compute it: sessions completed over sessions
 * scheduled, capped at 100 so a keen week does not paper over a missed one.
 */
export function adherence(completed: number, scheduled: number): number {
  return percent(completed, scheduled);
}

export interface BodyMeasurement {
  date: IsoDate;
  weightKg?: number;
  bodyFatPercent?: number;
  waistCm?: number;
  chestCm?: number;
  hipsCm?: number;
  armCm?: number;
  thighCm?: number;
}

/**
 * Bodyweight moves 1–2 kg a day on water alone, so the chart shows a seven-day
 * moving average alongside the raw points. Showing only raw points makes a
 * member think a good week failed.
 */
export function movingAverage(points: readonly SeriesPoint[], window = 7): SeriesPoint[] {
  return points.map((point, index) => {
    const slice = points.slice(Math.max(0, index - window + 1), index + 1);
    return { date: point.date, value: Math.round(average(slice.map((p) => p.value)) * 100) / 100 };
  });
}

/** VO2max estimate from resting heart rate (Uth-Sørensen). Clearly an estimate. */
export function estimateVo2Max(restingHeartRate: number, maxHeartRate: number): number | null {
  if (restingHeartRate <= 0 || maxHeartRate <= restingHeartRate) return null;
  return Math.round((15.3 * (maxHeartRate / restingHeartRate)) * 10) / 10;
}

/** Age-predicted maximum heart rate (Tanaka). Used only for training zones. */
export function estimateMaxHeartRate(ageYears: number): number {
  return Math.round(208 - 0.7 * clamp(ageYears, 10, 100));
}

export const HEART_RATE_ZONES = [
  { zone: 1, name: 'Recovery', lower: 0.5, upper: 0.6 },
  { zone: 2, name: 'Aerobic', lower: 0.6, upper: 0.7 },
  { zone: 3, name: 'Tempo', lower: 0.7, upper: 0.8 },
  { zone: 4, name: 'Threshold', lower: 0.8, upper: 0.9 },
  { zone: 5, name: 'VO2 Max', lower: 0.9, upper: 1.0 },
] as const;

export function heartRateZone(bpm: number, maxHeartRate: number): { zone: number; name: string } {
  const ratio = bpm / Math.max(1, maxHeartRate);
  for (const zone of HEART_RATE_ZONES) {
    if (ratio < zone.upper) return { zone: zone.zone, name: zone.name };
  }
  return { zone: 5, name: 'VO2 Max' };
}

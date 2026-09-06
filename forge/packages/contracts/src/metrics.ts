/**
 * FORGE metrics.
 *
 * Deliberately original and deliberately explainable. Every one of these is
 * defined here in a few lines so the number a member sees can be traced to the
 * inputs that produced it, and so nothing borrows a competitor's proprietary
 * formula or name.
 */

/**
 * Training Load — session RPE times duration, in arbitrary but consistent units.
 * Foster's sRPE is public sports-science method, not anyone's product.
 */
export function sessionLoad(minutes: number, rpe: number): number {
  if (minutes <= 0 || rpe <= 0) return 0;
  return Math.round(minutes * rpe);
}

/**
 * Load Balance — the ratio of the last 7 days of load to the average week of
 * the last 28. Around 1.0 means this week looks like recent weeks. Well above
 * means a spike. Reported as null when there is not enough history to say
 * anything, rather than as a confident 0.
 */
export function loadBalance(dailyLoads: readonly number[]): number | null {
  if (dailyLoads.length < 14) return null;
  const recent = dailyLoads.slice(-7);
  const window = dailyLoads.slice(-28);
  const acute = recent.reduce((a, b) => a + b, 0);
  const chronic = (window.reduce((a, b) => a + b, 0) / window.length) * 7;
  if (chronic <= 0) return null;
  return Number((acute / chronic).toFixed(2));
}

export type LoadBand = 'detraining' | 'steady' | 'building' | 'spike';

export function loadBand(balance: number | null): LoadBand | null {
  if (balance === null) return null;
  if (balance < 0.8) return 'detraining';
  if (balance <= 1.1) return 'steady';
  if (balance <= 1.4) return 'building';
  return 'spike';
}

/**
 * Consistency — the share of planned sessions actually completed over a window.
 * Counts only days that have already happened, so a plan is never marked down
 * for sessions that are still in the future.
 */
export function consistency(
  days: readonly { status: string; date: string }[],
  today: string,
): number | null {
  const elapsed = days.filter((d) => d.date <= today && d.status !== 'rest');
  if (elapsed.length === 0) return null;
  const done = elapsed.filter((d) => d.status === 'completed').length;
  return Math.round((done / elapsed.length) * 100);
}

/**
 * Effort — a 1–10 read on a single session from heart rate, when heart rate is
 * present. Returns null without it rather than inventing a number from pace,
 * which would mean something different for every athlete.
 */
export function effortScore(avgHr: number | null, maxHr: number | null): number | null {
  if (!avgHr || !maxHr || maxHr <= 60) return null;
  const ratio = avgHr / maxHr;
  return Math.max(1, Math.min(10, Math.round(ratio * 12.5)));
}

/** Epley, capped: beyond about 12 reps the estimate stops meaning much. */
export function estimateOneRepMax(loadG: number, reps: number): number | null {
  if (loadG <= 0 || reps <= 0 || reps > 12) return null;
  return Math.round(loadG * (1 + reps / 30));
}

export function pacePerKm(distanceM: number, movingS: number): number | null {
  if (distanceM < 100 || movingS <= 0) return null;
  return Math.round(movingS / (distanceM / 1000));
}

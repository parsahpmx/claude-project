import { average, clamp, scale, sum } from './units.js';

/**
 * Readiness and training load.
 *
 * The number on the member's dashboard has to be defensible. It is a weighted
 * blend of four inputs a wearable can actually supply, each mapped onto a
 * 0–100 sub-score against the member's own baseline rather than a population
 * norm — a resting heart rate of 58 is excellent for one member and a warning
 * sign for another. Where an input is missing we drop it and renormalise the
 * weights instead of substituting a default, because inventing a sleep score
 * the member never recorded is how a product loses their trust permanently.
 */

export interface ReadinessInputs {
  /** Minutes of sleep last night. */
  sleepMinutes?: number;
  /** Overnight average HRV in milliseconds. */
  hrvMs?: number;
  /** Resting heart rate in beats per minute. */
  restingHeartRate?: number;
  /** Self-reported soreness, 1 (fresh) to 5 (wrecked). */
  soreness?: number;
  /** Self-reported stress, 1 (calm) to 5 (overloaded). */
  stress?: number;
}

export interface ReadinessBaseline {
  sleepMinutes: number;
  hrvMs: number;
  restingHeartRate: number;
}

export const DEFAULT_BASELINE: ReadinessBaseline = {
  sleepMinutes: 450,
  hrvMs: 62,
  restingHeartRate: 58,
};

export interface ReadinessComponent {
  key: 'sleep' | 'hrv' | 'restingHeartRate' | 'soreness' | 'stress';
  label: string;
  score: number;
  weight: number;
  detail: string;
}

export interface ReadinessResult {
  /** 0–100, or null when no input at all was supplied. */
  score: number | null;
  band: 'primed' | 'ready' | 'moderate' | 'compromised' | 'unknown';
  headline: string;
  guidance: string;
  components: ReadinessComponent[];
}

const WEIGHTS = {
  sleep: 0.3,
  hrv: 0.3,
  restingHeartRate: 0.15,
  soreness: 0.15,
  stress: 0.1,
} as const;

export function computeReadiness(
  inputs: ReadinessInputs,
  baseline: ReadinessBaseline = DEFAULT_BASELINE,
): ReadinessResult {
  const components: ReadinessComponent[] = [];

  if (typeof inputs.sleepMinutes === 'number') {
    // Full marks at baseline; below 60% of baseline the score floors out.
    const ratio = inputs.sleepMinutes / Math.max(1, baseline.sleepMinutes);
    const score = clamp(scale(ratio, 0.6, 1.05, 20, 100), 0, 100);
    components.push({
      key: 'sleep',
      label: 'Sleep',
      score,
      weight: WEIGHTS.sleep,
      detail: `${Math.floor(inputs.sleepMinutes / 60)}h ${String(inputs.sleepMinutes % 60).padStart(2, '0')}m against a ${Math.round(baseline.sleepMinutes / 60)}h baseline`,
    });
  }

  if (typeof inputs.hrvMs === 'number') {
    const ratio = inputs.hrvMs / Math.max(1, baseline.hrvMs);
    const score = clamp(scale(ratio, 0.7, 1.15, 15, 100), 0, 100);
    components.push({
      key: 'hrv',
      label: 'HRV',
      score,
      weight: WEIGHTS.hrv,
      detail: `${Math.round(inputs.hrvMs)} ms against a ${Math.round(baseline.hrvMs)} ms baseline`,
    });
  }

  if (typeof inputs.restingHeartRate === 'number') {
    // Inverted: a rise above baseline is the negative signal.
    const delta = inputs.restingHeartRate - baseline.restingHeartRate;
    const score = clamp(scale(delta, 8, -4, 20, 100), 0, 100);
    components.push({
      key: 'restingHeartRate',
      label: 'Resting HR',
      score,
      weight: WEIGHTS.restingHeartRate,
      detail: `${Math.round(inputs.restingHeartRate)} bpm, ${delta >= 0 ? '+' : ''}${Math.round(delta)} vs baseline`,
    });
  }

  if (typeof inputs.soreness === 'number') {
    const score = clamp(scale(inputs.soreness, 5, 1, 10, 100), 0, 100);
    components.push({
      key: 'soreness',
      label: 'Soreness',
      score,
      weight: WEIGHTS.soreness,
      detail: `Reported ${inputs.soreness} of 5`,
    });
  }

  if (typeof inputs.stress === 'number') {
    const score = clamp(scale(inputs.stress, 5, 1, 10, 100), 0, 100);
    components.push({
      key: 'stress',
      label: 'Stress',
      score,
      weight: WEIGHTS.stress,
      detail: `Reported ${inputs.stress} of 5`,
    });
  }

  if (components.length === 0) {
    return {
      score: null,
      band: 'unknown',
      headline: 'No readiness data yet',
      guidance: 'Connect a wearable or log how you slept to see readiness here.',
      components,
    };
  }

  const totalWeight = sum(components.map((c) => c.weight));
  const score = Math.round(sum(components.map((c) => c.score * c.weight)) / totalWeight);
  return { score, ...bandFor(score), components };
}

function bandFor(score: number): Pick<ReadinessResult, 'band' | 'headline' | 'guidance'> {
  if (score >= 85) {
    return {
      band: 'primed',
      headline: 'Primed',
      guidance: 'Green light for your heaviest work. Take the top of the prescribed range today.',
    };
  }
  if (score >= 70) {
    return {
      band: 'ready',
      headline: 'Ready',
      guidance: 'Run the session as written. Nothing needs adjusting.',
    };
  }
  if (score >= 50) {
    return {
      band: 'moderate',
      headline: 'Moderate',
      guidance: 'Hold the session but cap top sets at RPE 7 and skip the optional finisher.',
    };
  }
  return {
    band: 'compromised',
    headline: 'Compromised',
    guidance: 'Swap to mobility or an easy aerobic session. Pushing today costs you the rest of the week.',
  };
}

/**
 * Acute:chronic workload ratio — seven-day load over a 28-day rolling average.
 *
 * Used to flag when a member has ramped faster than they have adapted. This is
 * a training-organisation signal, not a medical one, and the copy that renders
 * it must never imply otherwise.
 */
export interface LoadAssessment {
  acute: number;
  chronic: number;
  ratio: number;
  zone: 'detraining' | 'optimal' | 'stretched' | 'spike' | 'insufficient-data';
  message: string;
}

export function assessTrainingLoad(dailyLoads: readonly number[]): LoadAssessment {
  if (dailyLoads.length < 14) {
    return {
      acute: sum(dailyLoads.slice(-7)),
      chronic: 0,
      ratio: 0,
      zone: 'insufficient-data',
      message: 'Two weeks of training history unlocks load tracking.',
    };
  }

  const acute = sum(dailyLoads.slice(-7));
  const chronicWindow = dailyLoads.slice(-28);
  const chronic = (sum(chronicWindow) / chronicWindow.length) * 7;
  const ratio = chronic > 0 ? acute / chronic : 0;

  if (ratio < 0.8) {
    return { acute, chronic, ratio, zone: 'detraining', message: 'Load has dropped off. A lighter week is fine — two in a row costs adaptation.' };
  }
  if (ratio <= 1.3) {
    return { acute, chronic, ratio, zone: 'optimal', message: 'Load is tracking where progressive overload wants it.' };
  }
  if (ratio <= 1.5) {
    return { acute, chronic, ratio, zone: 'stretched', message: 'You have ramped quickly. Keep next week flat rather than adding volume.' };
  }
  return { acute, chronic, ratio, zone: 'spike', message: 'Sharp load spike. Your plan will pull back volume to let adaptation catch up.' };
}

/** Session load in arbitrary units: RPE × minutes, the standard sRPE method. */
export function sessionLoad(minutes: number, rpe: number): number {
  return Math.round(clamp(minutes, 0, 300) * clamp(rpe, 1, 10));
}

/** A rolling baseline that adapts to the member rather than a population norm. */
export function updateBaseline(
  baseline: ReadinessBaseline,
  observation: Partial<ReadinessBaseline>,
  smoothing = 0.1,
): ReadinessBaseline {
  const blend = (current: number, next: number | undefined): number =>
    typeof next === 'number' ? current * (1 - smoothing) + next * smoothing : current;
  return {
    sleepMinutes: blend(baseline.sleepMinutes, observation.sleepMinutes),
    hrvMs: blend(baseline.hrvMs, observation.hrvMs),
    restingHeartRate: blend(baseline.restingHeartRate, observation.restingHeartRate),
  };
}

/** Recovery score shown on the Recovery page: readiness plus adherence to protocols. */
export function computeRecoveryScore(
  readinessScore: number | null,
  completedRecoverySessions: number,
  targetRecoverySessions: number,
  sleepConsistency: number,
): number {
  const adherence = targetRecoverySessions > 0
    ? clamp((completedRecoverySessions / targetRecoverySessions) * 100, 0, 100)
    : 100;
  const parts = [readinessScore ?? 60, adherence, clamp(sleepConsistency, 0, 100)];
  return Math.round(average(parts));
}

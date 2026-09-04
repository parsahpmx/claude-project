import type { ExperienceLevel, ProgressionType } from './types.js';
import { clamp, roundToPlate } from './units.js';

/**
 * Progression and autoregulation.
 *
 * Two rules govern everything here. Progression is driven by what the member
 * actually logged, never by what the plan hoped for — a missed rep target must
 * pull the next session down, or the plan drifts away from the human running
 * it. And no single session can move a working load by more than 10%, because
 * one mis-typed set log should never produce a plan that injures somebody.
 */

export interface SetLog {
  reps: number;
  /** Load in grams. Bodyweight movements log 0. */
  loadGrams: number;
  rpe?: number;
  completed: boolean;
}

export interface ExercisePrescription {
  sets: number;
  /** Target rep count, or the bottom of a rep range for double progression. */
  reps: number;
  repsTop?: number;
  loadGrams: number;
  rpe?: number;
  restSeconds: number;
  tempo?: string;
  /**
   * The phase intensity multiplier already applied to `loadGrams`.
   *
   * A Foundation week is deliberately prescribed at 85% of the member's true
   * working load. That bias belongs in the session, not in the number we carry
   * forward — storing the biased figure back as the working load compounds it,
   * and a twelve-week block would end lighter than it started. Recording it
   * here lets `workingLoadFrom` divide it out again.
   */
  intensityBias?: number;
}

export interface ProgressionDecision {
  next: ExercisePrescription;
  /** Percentage change in prescribed load, for display and for tests. */
  loadDeltaPercent: number;
  action: 'increase-load' | 'increase-reps' | 'hold' | 'deload';
  reason: string;
}

/** Never move a working load more than this in one step. */
const MAX_STEP = 0.1;

const LEVEL_INCREMENT: Record<ExperienceLevel, number> = {
  beginner: 0.05,
  intermediate: 0.025,
  advanced: 0.015,
};

/**
 * Decide the next prescription from the last session's logged sets.
 */
export function progressExercise(
  previous: ExercisePrescription,
  logs: readonly SetLog[],
  options: { type: ProgressionType; level: ExperienceLevel; plateGrams?: number },
): ProgressionDecision {
  const plate = options.plateGrams ?? 2500;
  const completed = logs.filter((l) => l.completed);

  if (completed.length === 0) {
    return {
      next: previous,
      loadDeltaPercent: 0,
      action: 'hold',
      reason: 'Nothing logged for this exercise, so the prescription is unchanged.',
    };
  }

  const hitAllSets = completed.length >= previous.sets;
  const hitAllReps = completed.every((l) => l.reps >= previous.reps);
  const rpes = completed.map((l) => l.rpe).filter((r): r is number => typeof r === 'number');
  const meanRpe = rpes.length > 0 ? rpes.reduce((a, b) => a + b, 0) / rpes.length : undefined;

  // A hard session at the top of the range means the load is right; back off
  // before the member grinds themselves into a stall.
  if (meanRpe !== undefined && meanRpe >= 9.5) {
    const next = withLoad(previous, previous.loadGrams * 0.9, plate);
    return {
      next,
      loadDeltaPercent: deltaPercent(previous.loadGrams, next.loadGrams),
      action: 'deload',
      reason: `Average RPE ${meanRpe.toFixed(1)} — that was a grind. Dropping 10% to rebuild bar speed.`,
    };
  }

  if (!hitAllSets || !hitAllReps) {
    if (missedBadly(previous, completed)) {
      const next = withLoad(previous, previous.loadGrams * 0.93, plate);
      return {
        next,
        loadDeltaPercent: deltaPercent(previous.loadGrams, next.loadGrams),
        action: 'deload',
        reason: 'Reps fell well short of target. Resetting the load so the next block builds from a clean base.',
      };
    }
    return {
      next: previous,
      loadDeltaPercent: 0,
      action: 'hold',
      reason: 'Close, but not every rep landed. Repeating this load to own it before adding weight.',
    };
  }

  switch (options.type) {
    case 'double-progression': {
      const top = previous.repsTop ?? previous.reps + 2;
      const everySetAtTop = completed.every((l) => l.reps >= top);
      if (!everySetAtTop) {
        return {
          next: { ...previous, reps: Math.min(top, previous.reps + 1) },
          loadDeltaPercent: 0,
          action: 'increase-reps',
          reason: `All sets completed. Adding a rep before adding load — target ${Math.min(top, previous.reps + 1)} of ${top}.`,
        };
      }
      const next = withLoad(previous, previous.loadGrams * (1 + LEVEL_INCREMENT[options.level]), plate);
      return {
        next: { ...next, reps: previous.repsTop ? previous.reps : previous.reps, repsTop: top },
        loadDeltaPercent: deltaPercent(previous.loadGrams, next.loadGrams),
        action: 'increase-load',
        reason: `Top of the rep range on every set. Load goes up and reps reset to ${previous.reps}.`,
      };
    }

    case 'linear-load': {
      const step = meanRpe !== undefined && meanRpe <= 7 ? LEVEL_INCREMENT[options.level] * 1.5 : LEVEL_INCREMENT[options.level];
      const next = withLoad(previous, previous.loadGrams * (1 + step), plate);
      return {
        next,
        loadDeltaPercent: deltaPercent(previous.loadGrams, next.loadGrams),
        action: 'increase-load',
        reason: meanRpe !== undefined && meanRpe <= 7
          ? `RPE ${meanRpe.toFixed(1)} — that had more in the tank, so this is a double step.`
          : 'Session complete as written. Standard load increase.',
      };
    }

    case 'volume-accumulation': {
      if (previous.sets < 5) {
        return {
          next: { ...previous, sets: previous.sets + 1 },
          loadDeltaPercent: 0,
          action: 'increase-reps',
          reason: `Adding a set — ${previous.sets + 1} total. Volume before intensity in this block.`,
        };
      }
      const next = withLoad(previous, previous.loadGrams * (1 + LEVEL_INCREMENT[options.level]), plate);
      return {
        next: { ...next, sets: 3 },
        loadDeltaPercent: deltaPercent(previous.loadGrams, next.loadGrams),
        action: 'increase-load',
        reason: 'Volume target reached. Load steps up and sets reset to 3.',
      };
    }

    case 'rpe-autoregulated': {
      const target = previous.rpe ?? 8;
      if (meanRpe === undefined) {
        return { next: previous, loadDeltaPercent: 0, action: 'hold', reason: 'Log RPE to let the plan autoregulate this lift.' };
      }
      const gap = target - meanRpe;
      const adjust = clamp(gap * 0.03, -MAX_STEP, MAX_STEP);
      const next = withLoad(previous, previous.loadGrams * (1 + adjust), plate);
      return {
        next,
        loadDeltaPercent: deltaPercent(previous.loadGrams, next.loadGrams),
        action: adjust > 0.005 ? 'increase-load' : adjust < -0.005 ? 'deload' : 'hold',
        reason: `Target RPE ${target}, you logged ${meanRpe.toFixed(1)}. Adjusting load to land on target next time.`,
      };
    }

    case 'time-under-tension': {
      return {
        next: { ...previous, tempo: nextTempo(previous.tempo) },
        loadDeltaPercent: 0,
        action: 'increase-reps',
        reason: 'Holding the load and slowing the tempo — control is the progression here.',
      };
    }

    case 'distance-progression': {
      return {
        next: { ...previous, reps: Math.round(previous.reps * 1.1) },
        loadDeltaPercent: 0,
        action: 'increase-reps',
        reason: 'Distance steps up 10%, staying inside the safe weekly ramp.',
      };
    }

    default:
      return { next: previous, loadDeltaPercent: 0, action: 'hold', reason: 'No progression rule applies.' };
  }
}

function missedBadly(previous: ExercisePrescription, logs: readonly SetLog[]): boolean {
  const target = previous.sets * previous.reps;
  const achieved = logs.reduce((total, l) => total + l.reps, 0);
  return target > 0 && achieved < target * 0.75;
}

function withLoad(previous: ExercisePrescription, rawGrams: number, plate: number): ExercisePrescription {
  const bounded = clamp(
    rawGrams,
    previous.loadGrams * (1 - MAX_STEP),
    previous.loadGrams * (1 + MAX_STEP),
  );
  return { ...previous, loadGrams: roundToPlate(Math.max(0, bounded), plate) };
}

function deltaPercent(from: number, to: number): number {
  if (from <= 0) return 0;
  return Math.round(((to - from) / from) * 1000) / 10;
}

function nextTempo(tempo: string | undefined): string {
  const parsed = (tempo ?? '3010').split('').map(Number);
  const eccentric = clamp((parsed[0] ?? 3) + 1, 2, 6);
  return `${eccentric}${parsed[1] ?? 0}${parsed[2] ?? 1}${parsed[3] ?? 0}`;
}

/**
 * Estimated one-rep max, Epley formula, capped at 12 reps.
 *
 * Beyond about 12 reps the estimate becomes a measure of endurance rather than
 * strength, so we refuse rather than print a confident wrong number.
 */
export function estimateOneRepMax(loadGrams: number, reps: number): number | null {
  if (reps < 1 || reps > 12 || loadGrams <= 0) return null;
  if (reps === 1) return loadGrams;
  return Math.round(loadGrams * (1 + reps / 30));
}

/** Total tonnage for a session: the number the Progress page charts. */
export function totalVolume(logs: readonly SetLog[]): number {
  return logs.reduce((total, l) => (l.completed ? total + l.reps * l.loadGrams : total), 0);
}

export interface PersonalRecord {
  exerciseId: string;
  kind: 'load' | 'reps' | 'estimated-1rm' | 'volume';
  value: number;
  previousValue: number;
  reps: number;
}

/**
 * Detect PRs against a member's history.
 *
 * Only completed sets count. A set the member abandoned halfway is not a
 * lifetime best, and celebrating one would make every other badge meaningless.
 */
export function detectPersonalRecords(
  exerciseId: string,
  logs: readonly SetLog[],
  history: { bestLoadGrams: number; bestEstimatedOneRepMax: number },
): PersonalRecord[] {
  const records: PersonalRecord[] = [];
  const completed = logs.filter((l) => l.completed && l.loadGrams > 0);
  if (completed.length === 0) return records;

  const heaviest = completed.reduce((best, l) => (l.loadGrams > best.loadGrams ? l : best), completed[0]!);
  if (heaviest.loadGrams > history.bestLoadGrams) {
    records.push({
      exerciseId,
      kind: 'load',
      value: heaviest.loadGrams,
      previousValue: history.bestLoadGrams,
      reps: heaviest.reps,
    });
  }

  let bestEstimate = 0;
  let bestEstimateReps = 0;
  for (const log of completed) {
    const estimate = estimateOneRepMax(log.loadGrams, log.reps);
    if (estimate !== null && estimate > bestEstimate) {
      bestEstimate = estimate;
      bestEstimateReps = log.reps;
    }
  }
  if (bestEstimate > history.bestEstimatedOneRepMax) {
    records.push({
      exerciseId,
      kind: 'estimated-1rm',
      value: bestEstimate,
      previousValue: history.bestEstimatedOneRepMax,
      reps: bestEstimateReps,
    });
  }

  return records;
}

/**
 * The bias-free working load to store after a session.
 *
 * `progressExercise` returns the next prescription in the same phase context,
 * so its load still carries that phase's intensity bias. Persisting it as-is
 * multiplies the bias in again on the next build. This removes it, which is
 * what makes a working load comparable across phases and across blocks.
 */
export function workingLoadFrom(
  next: ExercisePrescription,
  prescribed: ExercisePrescription,
  plateGrams = 2500,
): number {
  const bias = prescribed.intensityBias ?? 1;
  if (bias <= 0 || next.loadGrams <= 0) return next.loadGrams;
  return roundToPlate(next.loadGrams / bias, plateGrams);
}

export const DIFFICULTY_FEEDBACK = ['too-easy', 'perfect', 'too-hard'] as const;
export type DifficultyFeedback = (typeof DIFFICULTY_FEEDBACK)[number];

/**
 * Apply the post-workout "how difficult was that?" answer to the next session.
 *
 * Kept deliberately small — ±5% — because it stacks on top of the per-exercise
 * progression above and two aggressive adjustments in the same direction is
 * how a plan runs away from a member.
 */
export function applyDifficultyFeedback(
  prescriptions: readonly ExercisePrescription[],
  feedback: DifficultyFeedback,
  plateGrams = 2500,
): ExercisePrescription[] {
  const factor = feedback === 'too-easy' ? 1.05 : feedback === 'too-hard' ? 0.95 : 1;
  if (factor === 1) return [...prescriptions];
  return prescriptions.map((p) => ({
    ...p,
    loadGrams: roundToPlate(p.loadGrams * factor, plateGrams),
  }));
}

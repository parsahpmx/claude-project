import { describe, expect, it } from 'vitest';
import {
  ASSESSMENT_STEPS,
  buildPerformanceProfile,
  isCompleteAnswerSheet,
  recommendTier,
} from './assessment.js';
import { buildDailyTimeline, buildPhases, buildRoadmap, buildSession, phaseForWeek, selectSessions } from './planning.js';
import { findProgram, filterPrograms, rankPrograms, PROGRAMS } from './programs.js';
import { canPerform, EXERCISE_LIBRARY, expandEquipment, findExercise, substituteExercise } from './exercises.js';
import {
  applyDifficultyFeedback,
  detectPersonalRecords,
  estimateOneRepMax,
  progressExercise,
  totalVolume,
  workingLoadFrom,
  type ExercisePrescription,
} from './progression.js';
import { assessTrainingLoad, computeReadiness, sessionLoad, updateBaseline } from './readiness.js';
import {
  ABSOLUTE_CALORIE_FLOOR,
  buildShoppingList,
  computeMacroTargets,
  macroProgress,
  recipeMatchesDiet,
  splitMealTargets,
} from './nutrition.js';
import { computeStreaks, consistencyHeatmap, movingAverage, strengthTrend, summariseProgress } from './progress.js';
import { coachCapacity, matchCoaches, scoreCheckIn } from './coaching.js';
import { buildLeaderboard, challengeProgress, CHALLENGES, findChallenge } from './challenges.js';
import { effectiveFeatures, entitlementsFor, findPlan, hasEntitlement, planPricing, resolvePromo, summariseCheckout } from './pricing.js';
import { answer, classifyIntent, MEDICAL_DISCLAIMER } from './ai-coach.js';
import { addDays, daysBetween, formatClock, startOfWeek } from './dates.js';
import { createIdFactory, slugify } from './ids.js';
import { gramsToKg, kgToGrams, roundToPlate, scale } from './units.js';
import type { AssessmentAnswers } from './types.js';

const ANSWERS: AssessmentAnswers = {
  primaryGoal: 'build-muscle',
  secondaryGoals: ['improve-strength'],
  ageRange: '25-34',
  experience: 'intermediate',
  daysPerWeek: 5,
  sessionMinutes: 60,
  location: 'gym',
  equipment: ['barbell', 'dumbbells', 'bench', 'rack'],
  diet: 'high-protein',
  coaching: 'ai-assisted',
  heightCm: 180,
  weightKg: 82,
  sexAtBirth: 'male',
};

describe('units and dates', () => {
  it('round-trips kilograms through integer grams', () => {
    expect(gramsToKg(kgToGrams(102.5))).toBe(102.5);
  });

  it('rounds loads to the nearest achievable plate jump', () => {
    expect(roundToPlate(101_200, 2500)).toBe(100_000);
    expect(roundToPlate(103_800, 2500)).toBe(105_000);
  });

  it('clamps scaled values at both ends of the input range', () => {
    expect(scale(-5, 0, 10, 0, 100)).toBe(0);
    expect(scale(50, 0, 10, 0, 100)).toBe(100);
  });

  it('starts training weeks on Monday regardless of the day given', () => {
    expect(startOfWeek('2026-09-04')).toBe('2026-08-31'); // Friday -> Monday
    expect(startOfWeek('2026-08-31')).toBe('2026-08-31');
    expect(startOfWeek('2026-09-06')).toBe('2026-08-31'); // Sunday -> that Monday
  });

  it('measures day spans and formats clock times', () => {
    expect(daysBetween('2026-01-01', '2026-01-31')).toBe(30);
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
    expect(formatClock(7 * 60 + 30)).toBe('07:30');
    expect(formatClock(21 * 60 + 30)).toBe('21:30');
  });

  it('generates deterministic, prefixed ids', () => {
    const a = createIdFactory(42);
    const b = createIdFactory(42);
    expect(a('workout')).toBe(b('workout'));
    expect(a('workout')).toMatch(/^wkt_[0-9a-z]{14}$/);
    expect(slugify('Women’s Strength — Phase 01')).toBe('women-s-strength-phase-01');
  });
});

describe('assessment', () => {
  it('asks exactly ten questions', () => {
    expect(ASSESSMENT_STEPS).toHaveLength(10);
    expect(ASSESSMENT_STEPS.map((s) => s.index)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('builds a profile that matches the answers given', () => {
    const profile = buildPerformanceProfile(ANSWERS);
    expect(profile.trainingLevel).toBe('intermediate');
    expect(profile.suggestedFrequency).toBe(5);
    expect(profile.recommendedProgramSlug).toBe('muscle-builder');
    expect(profile.trainingFocus).toBe('Hypertrophy + Strength');
    expect(profile.rationale.length).toBeGreaterThan(0);
  });

  it('caps a beginner asking for six days at four, and says why', () => {
    const profile = buildPerformanceProfile({ ...ANSWERS, experience: 'beginner', daysPerWeek: 6 });
    expect(profile.suggestedFrequency).toBe(4);
    expect(profile.rationale.join(' ')).toContain('Capped at 4');
  });

  it('never recommends a barbell programme to someone without a barbell', () => {
    const profile = buildPerformanceProfile({ ...ANSWERS, equipment: ['bodyweight', 'resistance-bands'] });
    const program = findProgram(profile.recommendedProgramSlug);
    expect(program).toBeDefined();
    expect(program!.equipment).not.toContain('barbell');
  });

  it('raises recovery priority with age and frequency', () => {
    const older = buildPerformanceProfile({ ...ANSWERS, ageRange: '55-64', daysPerWeek: 5 });
    expect(older.recoveryPriority).toBe('high');
    const young = buildPerformanceProfile({ ...ANSWERS, ageRange: '18-24', daysPerWeek: 3, experience: 'advanced' });
    expect(young.recoveryPriority).toBe('low');
  });

  it('maps coaching preference onto the tier shown first', () => {
    expect(recommendTier('human-coach')).toBe('forge-coach');
    expect(recommendTier('ai-assisted')).toBe('forge-pro');
    expect(recommendTier('self-guided')).toBe('forge');
  });

  it('rejects an incomplete answer sheet', () => {
    expect(isCompleteAnswerSheet({ primaryGoal: 'build-muscle' })).toBe(false);
    expect(isCompleteAnswerSheet(ANSWERS)).toBe(true);
  });
});

describe('exercise library', () => {
  it('treats a full gym as owning every individual item', () => {
    const owned = expandEquipment(['full-gym']);
    expect(owned.has('barbell')).toBe(true);
    expect(owned.has('cable-machine')).toBe(true);
    expect(owned.has('bodyweight')).toBe(true);
  });

  it('never programmes a movement the member lacks equipment for', () => {
    const owned = ['bodyweight', 'resistance-bands'] as const;
    for (const exercise of EXERCISE_LIBRARY) {
      if (canPerform(exercise, owned)) {
        expect(exercise.requires.every((r) => r === 'bodyweight' || r === 'resistance-bands')).toBe(true);
      }
    }
  });

  it('substitutes within the same movement pattern', () => {
    const replacement = substituteExercise('barbell-back-squat', ['dumbbells']);
    expect(replacement).not.toBeNull();
    expect(replacement!.pattern).toBe('squat');
    expect(canPerform(replacement!, ['dumbbells'])).toBe(true);
  });

  it('returns null rather than a wrong-pattern guess', () => {
    expect(substituteExercise('lat-pulldown', [])).not.toBeNull(); // bodyweight pull exists
    expect(substituteExercise('not-a-real-exercise', ['full-gym'])).toBeNull();
  });

  it('declares substitutes that actually exist in the library', () => {
    for (const exercise of EXERCISE_LIBRARY) {
      for (const id of exercise.substitutes) {
        expect(findExercise(id), `${exercise.id} -> ${id}`).toBeDefined();
      }
    }
  });
});

describe('programmes', () => {
  it('publishes a unique slug per programme', () => {
    expect(new Set(PROGRAMS.map((p) => p.slug)).size).toBe(PROGRAMS.length);
  });

  it('filters out programmes the member cannot equip', () => {
    const results = filterPrograms({ equipment: ['bodyweight'] });
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((p) => p.equipment.every((e) => e === 'bodyweight'))).toBe(true);
  });

  it('ranks the goal-matched programme first', () => {
    const ranked = rankPrograms({
      goal: 'improve-endurance',
      difficulty: 'beginner',
      equipment: ['bodyweight'],
      daysPerWeek: 4,
    });
    expect(ranked[0]?.slug).toBe('5k-builder');
  });

  it('only ranks programmes the member can actually run', () => {
    const ranked = rankPrograms({
      goal: 'build-muscle',
      difficulty: 'beginner',
      equipment: ['bodyweight'],
      daysPerWeek: 3,
    });
    expect(ranked.every((p) => p.equipment.every((e) => e === 'bodyweight'))).toBe(true);
  });
});

describe('roadmap and sessions', () => {
  const profile = buildPerformanceProfile(ANSWERS);
  const program = findProgram(profile.recommendedProgramSlug)!;
  const roadmap = buildRoadmap(
    {
      program,
      goal: ANSWERS.primaryGoal,
      level: profile.trainingLevel,
      sessionsPerWeek: profile.suggestedFrequency,
      sessionMinutes: profile.sessionMinutes,
      startDate: '2026-09-07',
      coached: true,
      nutritionGoal: profile.nutritionGoal,
      recoveryPriority: profile.recoveryPriority,
    },
    profile.phaseEmphasis,
  );

  it('covers every week of the programme with three phases', () => {
    expect(roadmap.weeks).toHaveLength(program.weeks);
    expect(roadmap.phases.map((p) => p.key)).toEqual(['foundation', 'build', 'perform']);
    const covered = roadmap.phases.flatMap((p) => {
      const weeks: number[] = [];
      for (let w = p.weekStart; w <= p.weekEnd; w += 1) weeks.push(w);
      return weeks;
    });
    expect(covered).toEqual(Array.from({ length: program.weeks }, (_, i) => i + 1));
  });

  it('gives every week seven consecutive days starting Monday', () => {
    for (const week of roadmap.weeks) {
      expect(week.days).toHaveLength(7);
      expect(week.startDate).toBe(startOfWeek(week.startDate));
      expect(daysBetween(week.startDate, week.endDate)).toBe(6);
    }
  });

  it('is deterministic — identical input produces an identical plan', () => {
    const again = buildRoadmap(
      {
        program, goal: ANSWERS.primaryGoal, level: profile.trainingLevel,
        sessionsPerWeek: profile.suggestedFrequency, sessionMinutes: profile.sessionMinutes,
        startDate: '2026-09-07', coached: true, nutritionGoal: profile.nutritionGoal,
        recoveryPriority: profile.recoveryPriority,
      },
      profile.phaseEmphasis,
    );
    expect(JSON.stringify(again)).toBe(JSON.stringify(roadmap));
  });

  it('deloads on the last week of a four-week-or-longer phase', () => {
    const foundation = roadmap.weeks.filter((w) => w.phase === 'foundation');
    expect(foundation[foundation.length - 1]?.deload).toBe(true);
    expect(foundation[0]?.deload).toBe(false);
  });

  it('marks baseline, mid-block and final milestones', () => {
    expect(roadmap.weeks[0]?.milestone).toContain('Baseline');
    expect(roadmap.weeks[roadmap.weeks.length - 1]?.milestone).toContain('Final assessment');
  });

  it('scales phases for a shorter programme', () => {
    const phases = buildPhases(8, { foundation: 'a', build: 'b', perform: 'c' });
    expect(phases[0]?.weekEnd).toBe(3);
    expect(phases[2]?.weekEnd).toBe(8);
    expect(phaseForWeek(phases, 8).key).toBe('perform');
  });

  it('drops conditioning before strength when availability is tight', () => {
    const trimmed = selectSessions(program, 2, 'low');
    expect(trimmed.filter((s) => s.kind === 'strength').length).toBeGreaterThanOrEqual(2);
  });

  it('builds a session only from movements the member can perform', () => {
    const week = roadmap.weeks[4]!;
    const day = week.days.find((d) => d.sessionTemplate !== null)!;
    const session = buildSession({
      session: day.sessionTemplate!,
      equipment: ['dumbbells', 'bench'],
      level: 'intermediate',
      phase: roadmap.phases[1]!,
      deload: false,
      minutes: 45,
      bodyweightKg: 82,
    });
    expect(session.exercises.length).toBeGreaterThan(0);
    for (const exercise of session.exercises) {
      expect(canPerform(findExercise(exercise.exerciseId)!, ['dumbbells', 'bench'])).toBe(true);
    }
  });

  it('fits the session inside the time the member gave', () => {
    const day = roadmap.weeks[0]!.days.find((d) => d.sessionTemplate !== null)!;
    const short = buildSession({
      session: day.sessionTemplate!, equipment: ['full-gym'], level: 'intermediate',
      phase: roadmap.phases[0]!, deload: false, minutes: 25, bodyweightKg: 82,
    });
    const long = buildSession({
      session: day.sessionTemplate!, equipment: ['full-gym'], level: 'intermediate',
      phase: roadmap.phases[0]!, deload: false, minutes: 60, bodyweightKg: 82,
    });
    expect(short.exercises.length).toBeLessThanOrEqual(long.exercises.length);
    expect(short.exercises.length).toBeGreaterThan(0);
  });

  it('anchors the daily timeline to the training session', () => {
    const timeline = buildDailyTimeline({
      trainingMinutesFromMidnight: 17 * 60 + 30,
      hasMobility: true,
      coachCheckInMinutes: 18 * 60,
    });
    const times = timeline.map((t) => t.time);
    expect(times).toContain('07:30');
    expect(times).toContain('17:30');
    expect(times).toContain('19:00'); // recovery meal, 90 minutes after training
    expect(timeline.map((t) => t.minutesFromMidnight)).toEqual(
      [...timeline.map((t) => t.minutesFromMidnight)].sort((a, b) => a - b),
    );
  });
});

describe('progression', () => {
  const base: ExercisePrescription = {
    sets: 4, reps: 8, repsTop: 10, loadGrams: 100_000, rpe: 8, restSeconds: 180,
  };

  it('adds reps before load under double progression', () => {
    const decision = progressExercise(
      base,
      Array.from({ length: 4 }, () => ({ reps: 8, loadGrams: 100_000, rpe: 7, completed: true })),
      { type: 'double-progression', level: 'intermediate' },
    );
    expect(decision.action).toBe('increase-reps');
    expect(decision.next.loadGrams).toBe(100_000);
  });

  it('adds load once every set reaches the top of the range', () => {
    const decision = progressExercise(
      base,
      Array.from({ length: 4 }, () => ({ reps: 10, loadGrams: 100_000, rpe: 7, completed: true })),
      { type: 'double-progression', level: 'intermediate' },
    );
    expect(decision.action).toBe('increase-load');
    expect(decision.next.loadGrams).toBeGreaterThan(100_000);
  });

  it('holds the load when the member is close but short', () => {
    const decision = progressExercise(
      base,
      [
        { reps: 8, loadGrams: 100_000, completed: true },
        { reps: 8, loadGrams: 100_000, completed: true },
        { reps: 7, loadGrams: 100_000, completed: true },
        { reps: 7, loadGrams: 100_000, completed: true },
      ],
      { type: 'linear-load', level: 'intermediate' },
    );
    expect(decision.action).toBe('hold');
    expect(decision.next.loadGrams).toBe(100_000);
  });

  it('deloads after a grinding session', () => {
    const decision = progressExercise(
      base,
      Array.from({ length: 4 }, () => ({ reps: 8, loadGrams: 100_000, rpe: 10, completed: true })),
      { type: 'linear-load', level: 'intermediate' },
    );
    expect(decision.action).toBe('deload');
    expect(decision.next.loadGrams).toBeLessThan(100_000);
  });

  it('never moves a load more than ten percent in one step', () => {
    const types = ['linear-load', 'double-progression', 'volume-accumulation', 'rpe-autoregulated'] as const;
    for (const type of types) {
      for (const rpe of [4, 6, 8, 10]) {
        const decision = progressExercise(
          base,
          Array.from({ length: 5 }, () => ({ reps: 12, loadGrams: 100_000, rpe, completed: true })),
          { type, level: 'beginner' },
        );
        expect(Math.abs(decision.loadDeltaPercent), `${type} @ RPE ${rpe}`).toBeLessThanOrEqual(10);
      }
    }
  });

  it('holds the prescription when nothing was logged', () => {
    const decision = progressExercise(base, [], { type: 'linear-load', level: 'advanced' });
    expect(decision.action).toBe('hold');
    expect(decision.next).toEqual(base);
  });

  it('refuses a one-rep-max estimate beyond twelve reps', () => {
    expect(estimateOneRepMax(100_000, 1)).toBe(100_000);
    expect(estimateOneRepMax(100_000, 5)).toBe(116_667);
    expect(estimateOneRepMax(100_000, 13)).toBeNull();
    expect(estimateOneRepMax(0, 5)).toBeNull();
  });

  it('counts only completed sets towards volume', () => {
    expect(
      totalVolume([
        { reps: 10, loadGrams: 50_000, completed: true },
        { reps: 10, loadGrams: 50_000, completed: false },
      ]),
    ).toBe(500_000);
  });

  it('never awards a personal record for an abandoned set', () => {
    const records = detectPersonalRecords(
      'barbell-back-squat',
      [{ reps: 5, loadGrams: 200_000, completed: false }],
      { bestLoadGrams: 100_000, bestEstimatedOneRepMax: 120_000 },
    );
    expect(records).toHaveLength(0);
  });

  it('detects a load personal record', () => {
    const records = detectPersonalRecords(
      'barbell-back-squat',
      [{ reps: 3, loadGrams: 120_000, completed: true }],
      { bestLoadGrams: 110_000, bestEstimatedOneRepMax: 125_000 },
    );
    expect(records.some((r) => r.kind === 'load')).toBe(true);
  });

  it('divides the phase bias back out of the stored working load', () => {
    // A Foundation week prescribes 85% of the true working load. If that
    // biased number is stored back, the next build biases it again.
    const trueWorkingLoad = 100_000;
    const prescribed: ExercisePrescription = {
      ...base, loadGrams: trueWorkingLoad * 0.85, intensityBias: 0.85,
    };
    const logs = Array.from({ length: prescribed.sets }, () => ({
      reps: prescribed.reps, loadGrams: prescribed.loadGrams, rpe: 7, completed: true,
    }));
    const held = progressExercise(prescribed, logs, {
      type: 'double-progression', level: 'intermediate',
    });
    // Reps go up before load does, so the load is unchanged — and unbiased it
    // must be exactly the working load we started from.
    expect(held.action).toBe('increase-reps');
    expect(workingLoadFrom(held.next, prescribed)).toBe(trueWorkingLoad);
  });

  it('never lets a successfully completed block drive the working load down', () => {
    // The bug this guards: folding the phase bias back into the stored load
    // compounds it, and twelve weeks of hitting every rep ends lighter than
    // it started.
    const level = 'intermediate' as const;
    let workingLoad = 100_000;

    for (const bias of [0.85, 0.85, 0.85, 0.85, 0.95, 0.95, 0.95, 0.95, 1.05, 1.05, 1.05, 1.05]) {
      for (let session = 0; session < 5; session += 1) {
        const prescribed: ExercisePrescription = {
          sets: 4, reps: 6, repsTop: 8, rpe: 7, restSeconds: 180,
          loadGrams: roundToPlate(workingLoad * bias, 2500),
          intensityBias: bias,
        };
        const logs = Array.from({ length: prescribed.sets }, () => ({
          reps: prescribed.repsTop!, loadGrams: prescribed.loadGrams, rpe: 7, completed: true,
        }));
        const decision = progressExercise(prescribed, logs, { type: 'double-progression', level });
        workingLoad = workingLoadFrom(decision.next, prescribed);
      }
    }

    expect(workingLoad).toBeGreaterThan(100_000);
  });

  it('applies post-workout difficulty feedback within five percent', () => {
    const easier = applyDifficultyFeedback([base], 'too-hard');
    const harder = applyDifficultyFeedback([base], 'too-easy');
    expect(easier[0]!.loadGrams).toBe(95_000);
    expect(harder[0]!.loadGrams).toBe(105_000);
    expect(applyDifficultyFeedback([base], 'perfect')[0]!.loadGrams).toBe(100_000);
  });
});

describe('readiness', () => {
  it('returns null rather than inventing a score with no inputs', () => {
    const result = computeReadiness({});
    expect(result.score).toBeNull();
    expect(result.band).toBe('unknown');
  });

  it('scores a well-recovered morning high', () => {
    const result = computeReadiness({ sleepMinutes: 480, hrvMs: 72, restingHeartRate: 54, soreness: 1, stress: 1 });
    expect(result.score!).toBeGreaterThanOrEqual(85);
    expect(result.band).toBe('primed');
  });

  it('scores a bad night low and tells the member to back off', () => {
    const result = computeReadiness({ sleepMinutes: 280, hrvMs: 38, restingHeartRate: 68, soreness: 5, stress: 5 });
    expect(result.score!).toBeLessThan(50);
    expect(result.band).toBe('compromised');
    expect(result.guidance).toMatch(/mobility|easy/i);
  });

  it('renormalises weights when only some inputs are present', () => {
    const sleepOnly = computeReadiness({ sleepMinutes: 450 });
    expect(sleepOnly.components).toHaveLength(1);
    expect(sleepOnly.score).toBeGreaterThan(90);
  });

  it('flags an acute load spike', () => {
    const steady = Array.from({ length: 28 }, () => 100);
    expect(assessTrainingLoad(steady).zone).toBe('optimal');
    const spiked = [...Array.from({ length: 21 }, () => 50), ...Array.from({ length: 7 }, () => 300)];
    expect(assessTrainingLoad(spiked).zone).toBe('spike');
    expect(assessTrainingLoad([1, 2, 3]).zone).toBe('insufficient-data');
  });

  it('computes session load as RPE times minutes', () => {
    expect(sessionLoad(45, 8)).toBe(360);
  });

  it('moves the baseline gradually rather than jumping to the latest reading', () => {
    const next = updateBaseline({ sleepMinutes: 450, hrvMs: 60, restingHeartRate: 58 }, { hrvMs: 100 });
    expect(next.hrvMs).toBeCloseTo(64, 5);
    expect(next.sleepMinutes).toBe(450);
  });
});

describe('nutrition', () => {
  it('computes macros that add back up to the calorie target', () => {
    const targets = computeMacroTargets({
      weightKg: 82, heightCm: 180, ageRange: '25-34', sexAtBirth: 'male',
      goal: 'build-muscle', trainingDaysPerWeek: 5, diet: 'high-protein',
    });
    const fromMacros = targets.proteinGrams * 4 + targets.carbGrams * 4 + targets.fatGrams * 9;
    expect(Math.abs(fromMacros - targets.calories)).toBeLessThanOrEqual(25);
    expect(targets.proteinGrams).toBeGreaterThan(150);
  });

  it('never prescribes below the calorie floor, however aggressive the goal', () => {
    const targets = computeMacroTargets({
      weightKg: 48, heightCm: 152, ageRange: '55-64', sexAtBirth: 'female',
      goal: 'lose-body-fat', trainingDaysPerWeek: 2, diet: 'balanced',
    });
    expect(targets.calories).toBeGreaterThanOrEqual(ABSOLUTE_CALORIE_FLOOR);
  });

  it('puts a cut below and a bulk above maintenance', () => {
    const shared = { weightKg: 75, heightCm: 175, ageRange: '25-34', sexAtBirth: 'female', trainingDaysPerWeek: 4, diet: 'balanced' } as const;
    const cut = computeMacroTargets({ ...shared, goal: 'lose-body-fat' });
    const bulk = computeMacroTargets({ ...shared, goal: 'build-muscle' });
    expect(cut.calories).toBeLessThan(bulk.calories);
  });

  it('splits the day into four meals that sum to the daily target', () => {
    const targets = computeMacroTargets({
      weightKg: 82, heightCm: 180, ageRange: '25-34', sexAtBirth: 'male',
      goal: 'build-muscle', trainingDaysPerWeek: 5, diet: 'balanced',
    });
    const meals = splitMealTargets(targets);
    expect(meals).toHaveLength(4);
    const total = meals.reduce((sum, m) => sum + m.calories, 0);
    expect(Math.abs(total - targets.calories)).toBeLessThanOrEqual(4);
  });

  it('merges shopping list lines only when the unit matches', () => {
    const list = buildShoppingList(
      [
        { servings: 2, ingredients: [{ name: 'Chicken breast', quantity: 300, unit: 'g', section: 'protein' }] },
        { servings: 2, ingredients: [{ name: 'Chicken breast', quantity: 200, unit: 'g', section: 'protein' }] },
        { servings: 1, ingredients: [{ name: 'Chicken breast', quantity: 2, unit: 'fillet', section: 'protein' }] },
      ],
      2,
    );
    const grams = list.find((i) => i.unit === 'g');
    expect(grams?.quantity).toBe(500);
    expect(grams?.recipeCount).toBe(2);
    expect(list.find((i) => i.unit === 'fillet')?.quantity).toBe(4);
  });

  it('sorts the shopping list by aisle', () => {
    const list = buildShoppingList([
      {
        servings: 1,
        ingredients: [
          { name: 'Oats', quantity: 80, unit: 'g', section: 'pantry' },
          { name: 'Spinach', quantity: 100, unit: 'g', section: 'produce' },
        ],
      },
    ]);
    expect(list.map((i) => i.section)).toEqual(['produce', 'pantry']);
  });

  it('reports macro progress and flags going meaningfully over', () => {
    expect(macroProgress(170, 170).percent).toBe(100);
    expect(macroProgress(200, 170).over).toBe(true);
    expect(macroProgress(175, 170).over).toBe(false);
  });

  it('respects diet preferences when filtering recipes', () => {
    expect(recipeMatchesDiet(['vegan'], 'vegetarian')).toBe(true);
    expect(recipeMatchesDiet(['vegetarian'], 'vegan')).toBe(false);
    expect(recipeMatchesDiet(['high-protein'], 'balanced')).toBe(true);
  });
});

describe('progress analytics', () => {
  const records = [
    { date: '2026-09-01', durationMinutes: 45, volumeGrams: 12_000_000, calories: 420, kind: 'strength', muscleGroups: ['chest' as const] },
    { date: '2026-09-03', durationMinutes: 50, volumeGrams: 14_000_000, calories: 460, kind: 'strength', muscleGroups: ['back' as const] },
    { date: '2026-09-05', durationMinutes: 30, volumeGrams: 0, calories: 300, kind: 'conditioning', muscleGroups: ['quads' as const] },
  ];

  it('summarises totals and the weekly average', () => {
    const summary = summariseProgress(records, '2026-09-06');
    expect(summary.totalWorkouts).toBe(3);
    expect(summary.trainingHours).toBeCloseTo(2.1, 1);
    expect(summary.currentStreakDays).toBeGreaterThan(0);
  });

  it('allows one rest day inside a streak but breaks on three', () => {
    expect(computeStreaks(['2026-09-01', '2026-09-03', '2026-09-05'], '2026-09-05').current).toBe(5);
    expect(computeStreaks(['2026-09-01', '2026-09-06'], '2026-09-06').current).toBe(1);
    expect(computeStreaks(['2026-09-01'], '2026-09-10').current).toBe(0);
  });

  it('keeps missed days visible in the heatmap', () => {
    const cells = consistencyHeatmap(records, '2026-09-01', '2026-09-07');
    expect(cells).toHaveLength(7);
    expect(cells.filter((c) => c.count === 0)).toHaveLength(4);
    expect(cells.every((c) => c.intensity >= 0 && c.intensity <= 4)).toBe(true);
  });

  it('smooths bodyweight without inventing points', () => {
    const raw = [
      { date: '2026-09-01', value: 82 }, { date: '2026-09-02', value: 83 }, { date: '2026-09-03', value: 81 },
    ];
    const smoothed = movingAverage(raw, 3);
    expect(smoothed).toHaveLength(3);
    expect(smoothed[2]!.value).toBeCloseTo(82, 1);
  });

  it('reports strength change as an absolute and a percentage', () => {
    const trend = strengthTrend('barbell-back-squat', [
      { date: '2026-06-01', estimatedOneRepMax: 100_000 },
      { date: '2026-09-01', estimatedOneRepMax: 112_000 },
    ])!;
    expect(trend.changeGrams).toBe(12_000);
    expect(trend.changePercent).toBe(12);
  });
});

describe('coaching', () => {
  const coaches = [
    { slug: 'maya-roberts', specialties: ['strength' as const, 'hypertrophy' as const], languages: ['English'], yearsExperience: 8, rating: 4.9, clientCount: 428, availableSlotsThisWeek: 3, monthlyPriceCents: 14900 },
    { slug: 'amara-diallo', specialties: ['endurance' as const], languages: ['English', 'French'], yearsExperience: 11, rating: 4.8, clientCount: 260, availableSlotsThisWeek: 0, monthlyPriceCents: 17900 },
  ];

  it('ranks the coach whose specialty matches the goal first, with reasons', () => {
    const matches = matchCoaches(coaches, { goal: 'build-muscle' });
    expect(matches[0]?.slug).toBe('maya-roberts');
    expect(matches[0]?.reasons.join(' ')).toContain('Hypertrophy');
  });

  it('applies availability, price and language as hard filters', () => {
    expect(matchCoaches(coaches, { goal: 'improve-endurance', needsAvailabilityThisWeek: true })).toHaveLength(1);
    expect(matchCoaches(coaches, { goal: 'build-muscle', maxMonthlyPriceCents: 15_000 })).toHaveLength(1);
    expect(matchCoaches(coaches, { goal: 'improve-endurance', language: 'French' })[0]?.slug).toBe('amara-diallo');
  });

  it('scores a strong check-in high and a hard one low', () => {
    const strong = scoreCheckIn({ energy: 5, sleepQuality: 5, stress: 1, nutritionAdherence: 5, trainingAdherence: 5 });
    expect(strong.band).toBe('thriving');
    const hard = scoreCheckIn({ energy: 2, sleepQuality: 1, stress: 5, nutritionAdherence: 2, trainingAdherence: 1 });
    expect(hard.band).toBe('at-risk');
    expect(hard.flags).toContain('poor-sleep');
  });

  it('puts a reported pain note at the top of the coach prompts', () => {
    const result = scoreCheckIn({
      energy: 4, sleepQuality: 4, stress: 2, nutritionAdherence: 4, trainingAdherence: 4,
      painNotes: 'Left knee aches on the way down',
    });
    expect(result.flags).toContain('pain-reported');
    expect(result.coachPrompts[0]).toContain('pain note');
  });

  it('reports coach capacity honestly', () => {
    expect(coachCapacity({ activeClients: 39, pendingCheckIns: 2, unreadMessages: 1, upcomingCalls: 3 }).status).toBe('at-capacity');
    expect(coachCapacity({ activeClients: 12, pendingCheckIns: 0, unreadMessages: 0, upcomingCalls: 0 }).status).toBe('available');
  });
});

describe('challenges', () => {
  it('has no challenge that measures weight lost', () => {
    for (const challenge of CHALLENGES) {
      expect(challenge.metric).not.toMatch(/weight|fat|bmi/);
    }
  });

  it('shares a rank between tied members and skips the next', () => {
    const definition = findChallenge('30-day-consistency')!;
    const board = buildLeaderboard(definition, [
      { userId: 'a', displayName: 'Alex', value: 18, visible: true },
      { userId: 'b', displayName: 'Bea', value: 18, visible: true },
      { userId: 'c', displayName: 'Cam', value: 12, visible: true },
    ]);
    expect(board.map((r) => r.rank)).toEqual([1, 1, 3]);
  });

  it('excludes members who opted out of the public board', () => {
    const definition = findChallenge('100k-steps-week')!;
    const board = buildLeaderboard(definition, [
      { userId: 'a', displayName: 'Alex', value: 90_000, visible: true },
      { userId: 'b', displayName: 'Bea', value: 95_000, visible: false },
    ]);
    expect(board).toHaveLength(1);
    expect(board[0]?.userId).toBe('a');
  });

  it('reports the daily rate needed to finish on time', () => {
    const definition = findChallenge('100k-steps-week')!;
    const progress = challengeProgress(definition, 40_000, 4);
    expect(progress.daysRemaining).toBe(3);
    expect(progress.requiredDailyRate).toBe(20_000);
    expect(progress.onTrack).toBe(false);
  });
});

describe('pricing', () => {
  it('derives yearly price from monthly and the stated discount', () => {
    const plan = findPlan('forge')!;
    const pricing = planPricing(plan);
    expect(pricing.monthlyCents).toBe(2900);
    expect(pricing.yearlySavingPercent).toBe(20);
    expect(pricing.yearlyCents + pricing.yearlySavingCents).toBe(2900 * 12);
  });

  it('inherits features and entitlements up the tiers', () => {
    expect(effectiveFeatures('forge-coach').length).toBeGreaterThan(effectiveFeatures('forge').length);
    expect(hasEntitlement('forge-coach', 'training')).toBe(true);
    expect(hasEntitlement('forge', 'human-coach')).toBe(false);
    expect(entitlementsFor('forge-pro')).toContain('wearables');
  });

  it('states the recurring-billing disclosure with the real charge date', () => {
    const summary = summariseCheckout({ tier: 'forge-pro', interval: 'monthly', todayIso: '2026-09-04' })!;
    expect(summary.firstChargeDate).toBe('2026-09-11');
    expect(summary.disclosure).toContain('7-day free trial');
    expect(summary.disclosure).toContain('$49');
  });

  it('applies a promo code to the total', () => {
    expect(resolvePromo('forge20')).toBe(20);
    expect(resolvePromo('nope')).toBe(0);
    const summary = summariseCheckout({ tier: 'forge', interval: 'monthly', promoPercentOff: 20, todayIso: '2026-09-04' })!;
    expect(summary.totalCents).toBe(2320);
  });
});

describe('FORGE AI', () => {
  const context = {
    firstName: 'Alex',
    unitSystem: 'metric' as const,
    todaySessionTitle: 'Upper Body Strength',
    todaySessionMinutes: 45,
    todaySessionKind: 'strength',
    readiness: computeReadiness({ sleepMinutes: 400, hrvMs: 48, restingHeartRate: 64, soreness: 4, stress: 3 }),
    macros: computeMacroTargets({
      weightKg: 82, heightCm: 180, ageRange: '25-34', sexAtBirth: 'male',
      goal: 'build-muscle', trainingDaysPerWeek: 5, diet: 'high-protein',
    }),
    equipment: ['dumbbells', 'bench'] as const as ('dumbbells' | 'bench')[],
    weeklyCompleted: 3,
    weeklyTarget: 5,
    currentStreakDays: 18,
    programName: 'Muscle Builder',
    weekNumber: 5,
    totalWeeks: 12,
    hasHumanCoach: true,
  };

  it('routes every injury or medical phrasing to a professional', () => {
    for (const question of [
      'My knee hurts when I squat',
      'I think I tore something',
      'Can I train with a sprained ankle?',
      'What medication helps with soreness?',
      'Is this safe while pregnant?',
    ]) {
      const result = answer(question, context);
      expect(classifyIntent(question), question).toBe('medical');
      expect(result.disclaimer).toBe(MEDICAL_DISCLAIMER);
      expect(result.body.join(' ')).not.toMatch(/you should train|it is fine/i);
    }
  });

  it('answers what to train today from the plan and readiness', () => {
    const result = answer('What should I train today?', context);
    expect(result.intent).toBe('what-should-i-train');
    expect(result.headline).toBe('Upper Body Strength');
    expect(result.sources).toContain('Readiness score');
    expect(result.body.join(' ')).toContain('3 of 5 sessions');
  });

  it('substitutes only into equipment the member owns', () => {
    const result = answer('Can I replace barbell back squat?', context);
    expect(result.intent).toBe('substitute-exercise');
    expect(result.headline).toMatch(/Swap Barbell Back Squat for/);
    expect(result.headline).not.toMatch(/Barbell Front Squat/);
  });

  it('explains a readiness drop by naming the weakest input', () => {
    const result = answer('Why did my recovery score fall?', context);
    expect(result.intent).toBe('why-recovery-fell');
    expect(result.body.join(' ')).toMatch(/soreness|hrv|sleep|resting hr/i);
  });

  it('rebuilds a session to the minutes asked for', () => {
    const result = answer("Adjust today's workout to 30 minutes", context);
    expect(result.intent).toBe('shorten-workout');
    expect(result.headline).toContain('30 minutes');
    expect(result.actions.some((a) => a.action === 'shorten:30')).toBe(true);
  });

  it('gives concrete post-training nutrition from the member’s own targets', () => {
    const result = answer('What should I eat after training?', context);
    expect(result.intent).toBe('post-training-nutrition');
    expect(result.body.join(' ')).toContain(`${context.macros.proteinGrams}g protein`);
  });

  it('says it does not know rather than guessing', () => {
    const result = answer('Who won the league last night?', context);
    expect(result.intent).toBe('unknown');
    expect(result.body.join(' ')).toMatch(/not sure|your plan/i);
  });

  it('never invents a readiness number it was not given', () => {
    const result = answer('Why did my recovery score fall?', { ...context, readiness: null });
    expect(result.body.join(' ')).toMatch(/do not have|connect/i);
    expect(result.body.join(' ')).not.toMatch(/\b\d{2}\b out of 100/);
  });
});

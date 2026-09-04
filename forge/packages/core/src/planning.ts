import { addDays, formatClock, startOfWeek, type IsoDate } from './dates.js';
import {
  availableExercises,
  findExercise,
  type Exercise,
  type MovementPattern,
} from './exercises.js';
import type { Program, ProgramSession } from './programs.js';
import type { ExercisePrescription } from './progression.js';
import type {
  Equipment,
  ExperienceLevel,
  Goal,
  PhaseKey,
  SessionKind,
} from './types.js';
import { clamp, percent, roundToPlate } from './units.js';

/**
 * Plan construction — the twelve-week roadmap and the sessions inside it.
 *
 * Generation is deterministic given (programme, profile, start date). Two
 * members with identical inputs get identical plans, a member reloading the
 * page sees the same plan twice, and a coach reviewing a plan sees exactly
 * what their client saw. Randomised programme generation looks impressive in a
 * demo and is impossible to support.
 */

export interface Phase {
  key: PhaseKey;
  order: number;
  name: string;
  weekStart: number;
  weekEnd: number;
  focus: string[];
  intensityBias: number;
  volumeBias: number;
}

export interface PlanWeek {
  weekNumber: number;
  phase: PhaseKey;
  startDate: IsoDate;
  endDate: IsoDate;
  /** True on the fourth week of each phase — volume drops, intensity holds. */
  deload: boolean;
  sessionCount: number;
  nutritionGoal: string;
  recoveryTarget: string;
  coachCheckIn: boolean;
  milestone: string | null;
  days: PlanDay[];
}

export interface PlanDay {
  date: IsoDate;
  dayOfWeek: number;
  kind: SessionKind;
  title: string;
  focus: string;
  minutes: number;
  patterns: MovementPattern[];
  /** Null on rest days. */
  sessionTemplate: ProgramSession | null;
}

export interface Roadmap {
  programSlug: string;
  programName: string;
  goal: Goal;
  startDate: IsoDate;
  totalWeeks: number;
  phases: Phase[];
  weeks: PlanWeek[];
}

export interface RoadmapInput {
  program: Program;
  goal: Goal;
  level: ExperienceLevel;
  sessionsPerWeek: number;
  sessionMinutes: number;
  startDate: IsoDate;
  coached: boolean;
  nutritionGoal: string;
  recoveryPriority: 'low' | 'medium' | 'high';
}

/**
 * Phase boundaries scale with programme length, so an eight-week 5K build and
 * a sixteen-week marathon build both get three coherent phases rather than
 * "weeks 1–4" hard-coded against a twelve-week assumption.
 */
export function buildPhases(totalWeeks: number, focus: Record<PhaseKey, string>): Phase[] {
  const first = Math.max(1, Math.round(totalWeeks / 3));
  const second = Math.max(first + 1, Math.round((totalWeeks * 2) / 3));
  return [
    {
      key: 'foundation',
      order: 1,
      name: 'Foundation',
      weekStart: 1,
      weekEnd: first,
      focus: splitFocus(focus.foundation),
      intensityBias: 0.85,
      volumeBias: 0.9,
    },
    {
      key: 'build',
      order: 2,
      name: 'Build',
      weekStart: first + 1,
      weekEnd: second,
      focus: splitFocus(focus.build),
      intensityBias: 0.95,
      volumeBias: 1.1,
    },
    {
      key: 'perform',
      order: 3,
      name: 'Perform',
      weekStart: second + 1,
      weekEnd: totalWeeks,
      focus: splitFocus(focus.perform),
      intensityBias: 1.05,
      volumeBias: 0.95,
    },
  ];
}

function splitFocus(text: string): string[] {
  return text
    .split(/,| and /)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1));
}

export function phaseForWeek(phases: readonly Phase[], weekNumber: number): Phase {
  for (const phase of phases) {
    if (weekNumber >= phase.weekStart && weekNumber <= phase.weekEnd) return phase;
  }
  return phases[phases.length - 1] ?? phases[0]!;
}

export function buildRoadmap(input: RoadmapInput, phaseFocus: Record<PhaseKey, string>): Roadmap {
  const totalWeeks = input.program.weeks;
  const phases = buildPhases(totalWeeks, phaseFocus);
  const monday = startOfWeek(input.startDate);

  const template = selectSessions(input.program, input.sessionsPerWeek, input.recoveryPriority);

  const weeks: PlanWeek[] = [];
  for (let weekNumber = 1; weekNumber <= totalWeeks; weekNumber += 1) {
    const phase = phaseForWeek(phases, weekNumber);
    const weekStart = addDays(monday, (weekNumber - 1) * 7);
    const positionInPhase = weekNumber - phase.weekStart + 1;
    const phaseLength = phase.weekEnd - phase.weekStart + 1;
    const deload = phaseLength >= 4 && positionInPhase === phaseLength;

    weeks.push({
      weekNumber,
      phase: phase.key,
      startDate: weekStart,
      endDate: addDays(weekStart, 6),
      deload,
      sessionCount: template.filter((s) => s.kind !== 'recovery' || input.recoveryPriority !== 'low').length,
      nutritionGoal: weekNutritionGoal(input.nutritionGoal, phase.key, deload),
      recoveryTarget: weekRecoveryTarget(input.recoveryPriority, deload),
      coachCheckIn: input.coached && weekNumber % 1 === 0,
      milestone: milestoneFor(weekNumber, totalWeeks, phase.key, input.goal),
      days: buildDays(weekStart, template, input, deload),
    });
  }

  return {
    programSlug: input.program.slug,
    programName: input.program.name,
    goal: input.goal,
    startDate: monday,
    totalWeeks,
    phases,
    weeks,
  };
}

/**
 * Fit a programme's template to the sessions the member actually committed to.
 *
 * Trimming drops conditioning and recovery before it drops strength, because
 * the main lifts are what the programme's promise rests on.
 */
export function selectSessions(
  program: Program,
  sessionsPerWeek: number,
  recoveryPriority: 'low' | 'medium' | 'high',
): ProgramSession[] {
  const target = clamp(sessionsPerWeek, 1, 7);
  const trainingSessions = program.template.filter((s) => s.kind !== 'mobility' && s.kind !== 'recovery');
  const softSessions = program.template.filter((s) => s.kind === 'mobility' || s.kind === 'recovery');

  const priority: Record<ProgramSession['kind'], number> = {
    strength: 0,
    running: 1,
    conditioning: 2,
    mobility: 3,
    recovery: 4,
  };

  const kept = [...trainingSessions]
    .sort((a, b) => priority[a.kind] - priority[b.kind] || a.day - b.day)
    .slice(0, target)
    .sort((a, b) => a.day - b.day);

  // A member with a high recovery priority always gets their mobility day back,
  // even if it pushes them one session over their stated availability — it is
  // 20 minutes and it is the reason the other four sessions keep working.
  const includeSoft = recoveryPriority !== 'low' || kept.length < target;
  const soft = includeSoft ? softSessions.slice(0, recoveryPriority === 'high' ? 2 : 1) : [];

  return [...kept, ...soft].sort((a, b) => a.day - b.day);
}

function buildDays(
  weekStart: IsoDate,
  template: readonly ProgramSession[],
  input: RoadmapInput,
  deload: boolean,
): PlanDay[] {
  const byDay = new Map(template.map((s) => [s.day, s]));
  const days: PlanDay[] = [];

  for (let offset = 0; offset < 7; offset += 1) {
    const dayNumber = offset + 1;
    const session = byDay.get(dayNumber);
    const date = addDays(weekStart, offset);

    if (!session) {
      days.push({
        date,
        dayOfWeek: dayNumber,
        kind: 'rest',
        title: 'Rest',
        focus: 'Recovery day',
        minutes: 0,
        patterns: [],
        sessionTemplate: null,
      });
      continue;
    }

    const minutes = Math.min(
      session.minutes,
      Math.max(15, deload ? Math.round(input.sessionMinutes * 0.8) : input.sessionMinutes),
    );

    days.push({
      date,
      dayOfWeek: dayNumber,
      kind: session.kind,
      title: session.name,
      focus: session.focus,
      minutes,
      patterns: session.patterns as MovementPattern[],
      sessionTemplate: session,
    });
  }

  return days;
}

function weekNutritionGoal(base: string, phase: PhaseKey, deload: boolean): string {
  if (deload) return `${base} — calories held, carbs trimmed slightly`;
  if (phase === 'foundation') return `${base} — establish protein and hydration targets`;
  if (phase === 'build') return `${base} — carbohydrate around training sessions`;
  return `${base} — fuel the heaviest sessions of the block`;
}

function weekRecoveryTarget(priority: 'low' | 'medium' | 'high', deload: boolean): string {
  if (deload) return 'Two mobility sessions and an early night before every training day';
  if (priority === 'high') return 'Two mobility sessions, 7.5h sleep target';
  if (priority === 'medium') return 'One mobility session, 7h sleep target';
  return 'Mobility on demand, 7h sleep target';
}

function milestoneFor(week: number, total: number, phase: PhaseKey, goal: Goal): string | null {
  if (week === 1) return 'Baseline testing — record your starting numbers';
  if (week === total) return 'Final assessment and progress report';
  if (week === Math.round(total / 2)) return 'Mid-block benchmark — retest the main lifts';
  if (phase === 'perform' && week === total - 2) {
    return goal === 'improve-endurance' ? 'Time trial' : 'Personal record attempt';
  }
  return null;
}

// --------------------------------------------------------------------------
// Session building
// --------------------------------------------------------------------------

export interface SessionExercise {
  order: number;
  exerciseId: string;
  name: string;
  cue: string;
  pattern: MovementPattern;
  timed: boolean;
  prescription: ExercisePrescription;
  /** Alternatives the member can swap to in the player, already equipment-checked. */
  substitutes: { id: string; name: string }[];
}

export interface BuiltSession {
  title: string;
  kind: SessionKind;
  focus: string;
  minutes: number;
  exercises: SessionExercise[];
  warmup: string[];
  cooldown: string[];
  coachNote: string;
}

export interface SessionBuildInput {
  session: ProgramSession;
  equipment: Equipment[];
  level: ExperienceLevel;
  phase: Phase;
  deload: boolean;
  minutes: number;
  /** Known working loads by exercise id, in grams. Absent means "estimate". */
  knownLoads?: Record<string, number>;
  bodyweightKg?: number;
}

/** Sets and reps per phase, by whether the movement anchors the session. */
const SET_SCHEME: Record<PhaseKey, { compound: [number, number, number]; accessory: [number, number, number] }> = {
  // [sets, reps, repsTop]
  foundation: { compound: [3, 8, 10], accessory: [3, 12, 15] },
  build: { compound: [4, 6, 8], accessory: [3, 10, 12] },
  perform: { compound: [5, 3, 5], accessory: [3, 8, 10] },
};

const REST_SECONDS: Record<'compound' | 'accessory', number> = { compound: 180, accessory: 75 };

export function buildSession(input: SessionBuildInput): BuiltSession {
  const pool = availableExercises(input.equipment);
  const chosen: Exercise[] = [];
  const used = new Set<string>();

  for (const pattern of input.session.patterns as MovementPattern[]) {
    const match = pickForPattern(pool, pattern, input.level, used);
    if (match) {
      chosen.push(match);
      used.add(match.id);
    }
  }

  // Time budget: roughly six minutes per compound, four per accessory. If the
  // member gave us 30 minutes we cut accessories rather than shorten every set.
  const budget = input.minutes;
  const trimmed: Exercise[] = [];
  let spent = 0;
  for (const exercise of chosen) {
    const cost = exercise.compound ? 8 : 5;
    if (spent + cost > budget - 8 && trimmed.length > 0) break;
    trimmed.push(exercise);
    spent += cost;
  }

  const exercises: SessionExercise[] = trimmed.map((exercise, index) => ({
    order: index + 1,
    exerciseId: exercise.id,
    name: exercise.name,
    cue: exercise.cue,
    pattern: exercise.pattern,
    timed: exercise.timed === true,
    prescription: prescriptionFor(exercise, input),
    substitutes: exercise.substitutes
      .map((id) => findExercise(id))
      .filter((e): e is Exercise => e !== undefined && pool.some((p) => p.id === e.id))
      .map((e) => ({ id: e.id, name: e.name })),
  }));

  return {
    title: input.session.name,
    kind: input.session.kind,
    focus: input.session.focus,
    minutes: input.minutes,
    exercises,
    warmup: warmupFor(input.session.kind),
    cooldown: ['Five minutes easy walking', 'Two minutes of nasal breathing to down-regulate'],
    coachNote: coachNoteFor(input.phase.key, input.deload),
  };
}

function pickForPattern(
  pool: readonly Exercise[],
  pattern: MovementPattern,
  level: ExperienceLevel,
  used: ReadonlySet<string>,
): Exercise | undefined {
  const levelRank = { beginner: 0, intermediate: 1, advanced: 2 } as const;
  const candidates = pool
    .filter((e) => e.pattern === pattern && !used.has(e.id) && levelRank[e.level] <= levelRank[level])
    .sort((a, b) => {
      // Prefer the most advanced movement the member can handle, and compounds
      // before isolation — that is what makes the session worth their hour.
      if (a.compound !== b.compound) return a.compound ? -1 : 1;
      return levelRank[b.level] - levelRank[a.level];
    });
  return candidates[0] ?? pool.find((e) => e.pattern === pattern && !used.has(e.id));
}

function prescriptionFor(exercise: Exercise, input: SessionBuildInput): ExercisePrescription {
  const scheme = SET_SCHEME[input.phase.key][exercise.compound ? 'compound' : 'accessory'];
  const [sets, reps, repsTop] = scheme;
  const known = input.knownLoads?.[exercise.id];
  const estimated = known ?? estimateStartingLoad(exercise, input.level, input.bodyweightKg ?? 75);

  const load = roundToPlate(estimated * input.phase.intensityBias, exercise.plateGrams || 1000);
  const setCount = input.deload ? Math.max(2, sets - 1) : sets;

  return {
    sets: setCount,
    reps,
    repsTop,
    loadGrams: exercise.plateGrams === 0 ? 0 : load,
    rpe: input.phase.key === 'perform' ? 8 : 7,
    restSeconds: exercise.compound ? REST_SECONDS.compound : REST_SECONDS.accessory,
    tempo: exercise.compound ? '3010' : '2011',
    // Carried through so the session's phase bias can be divided back out
    // before the result is stored as the member's working load.
    intensityBias: input.phase.intensityBias,
  };
}

/**
 * A first-session load estimate, expressed as a fraction of bodyweight.
 *
 * These are deliberately conservative. A member who finds week one too easy
 * loses nothing — progression catches up within two sessions. A member who
 * finds week one too heavy is injured or gone.
 */
const BODYWEIGHT_FRACTION: Partial<Record<MovementPattern, number>> = {
  squat: 0.6,
  hinge: 0.75,
  'horizontal-push': 0.45,
  'vertical-push': 0.3,
  'horizontal-pull': 0.4,
  'vertical-pull': 0.35,
  lunge: 0.25,
  carry: 0.3,
};

export function estimateStartingLoad(
  exercise: Exercise,
  level: ExperienceLevel,
  bodyweightKg: number,
): number {
  if (exercise.plateGrams === 0) return 0;
  const fraction = BODYWEIGHT_FRACTION[exercise.pattern] ?? 0.2;
  const levelFactor = { beginner: 0.55, intermediate: 0.8, advanced: 1 }[level];
  const isolationFactor = exercise.compound ? 1 : 0.35;
  const grams = bodyweightKg * 1000 * fraction * levelFactor * isolationFactor;
  return roundToPlate(grams, exercise.plateGrams);
}

function warmupFor(kind: ProgramSession['kind']): string[] {
  switch (kind) {
    case 'running':
      return ['Five minutes easy jogging', 'Leg swings and ankle mobilisation', 'Four 20-second strides'];
    case 'conditioning':
      return ['Three minutes easy on your chosen machine', 'World’s greatest stretch, five each side', 'One easy round of the circuit'];
    case 'mobility':
    case 'recovery':
      return ['Two minutes of nasal breathing', 'Cat-cow, ten slow reps'];
    default:
      return ['Five minutes general warm-up', 'Cat-cow and hip openers', 'Two ramp-up sets on the first movement'];
  }
}

function coachNoteFor(phase: PhaseKey, deload: boolean): string {
  if (deload) {
    return 'Deload week. The load stays honest but the volume comes down — this is where the last three weeks turn into adaptation.';
  }
  switch (phase) {
    case 'foundation':
      return 'Technique is the priority. Leave two reps in reserve on every set and film your top set once this week.';
    case 'build':
      return 'This is the accumulation block. Chase the top of the rep range before you chase the next plate.';
    default:
      return 'Heaviest block of the plan. Full rest between top sets — the rest period is part of the prescription.';
  }
}

// --------------------------------------------------------------------------
// Daily timeline
// --------------------------------------------------------------------------

export interface TimelineEntry {
  time: string;
  minutesFromMidnight: number;
  label: string;
  kind: 'mobility' | 'meal' | 'training' | 'recovery' | 'check-in' | 'steps';
}

/**
 * The horizontal timeline on the home dashboard.
 *
 * Anchored to the training session, so a member who trains at 06:00 does not
 * get a plan that tells them to eat their recovery meal at 19:00.
 */
export function buildDailyTimeline(options: {
  trainingMinutesFromMidnight: number | null;
  hasMobility: boolean;
  coachCheckInMinutes?: number | null;
}): TimelineEntry[] {
  const entries: TimelineEntry[] = [];
  const push = (minutesFromMidnight: number, label: string, kind: TimelineEntry['kind']) => {
    entries.push({ minutesFromMidnight, time: formatClock(minutesFromMidnight), label, kind });
  };

  if (options.hasMobility) push(7 * 60 + 30, 'Morning mobility', 'mobility');
  push(12 * 60 + 30, 'Lunch', 'meal');

  const training = options.trainingMinutesFromMidnight;
  if (training !== null) {
    push(training, 'Training session', 'training');
    push(training + 90, 'Recovery meal', 'meal');
  } else {
    push(19 * 60, 'Dinner', 'meal');
  }

  if (typeof options.coachCheckInMinutes === 'number') {
    push(options.coachCheckInMinutes, 'Coach check-in', 'check-in');
  }

  push(21 * 60 + 30, 'Breathwork', 'recovery');

  return entries.sort((a, b) => a.minutesFromMidnight - b.minutesFromMidnight);
}

/** Roadmap completion, used by the progress ring on My Plan. */
export function roadmapProgress(
  roadmap: Roadmap,
  completedSessionCount: number,
): { percent: number; completedWeeks: number; totalSessions: number } {
  const totalSessions = roadmap.weeks.reduce(
    (total, week) => total + week.days.filter((d) => d.kind !== 'rest').length,
    0,
  );
  const completedWeeks = roadmap.weeks.filter((week) => {
    const sessions = week.days.filter((d) => d.kind !== 'rest').length;
    return sessions > 0 && completedSessionCount >= sessionsBefore(roadmap, week.weekNumber) + sessions;
  }).length;

  return { percent: percent(completedSessionCount, totalSessions), completedWeeks, totalSessions };
}

function sessionsBefore(roadmap: Roadmap, weekNumber: number): number {
  return roadmap.weeks
    .filter((w) => w.weekNumber < weekNumber)
    .reduce((total, week) => total + week.days.filter((d) => d.kind !== 'rest').length, 0);
}

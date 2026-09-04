import {
  AGE_RANGES,
  DIET_LABELS,
  DIET_PREFERENCES,
  EQUIPMENT,
  EQUIPMENT_LABELS,
  EXPERIENCE_LABELS,
  EXPERIENCE_LEVELS,
  GOAL_LABELS,
  GOALS,
  TRAINING_LOCATIONS,
  type AssessmentAnswers,
  type CoachingPreference,
  type Equipment,
  type ExperienceLevel,
  type Goal,
  type PhaseKey,
  type ProgressionType,
  type TrainingLocation,
} from './types.js';
import { clamp } from './units.js';

/**
 * The assessment is the product's front door: ten questions that turn a
 * stranger into a plan. It is deliberately declarative data rather than ten
 * hand-built screens, so the web onboarding, the mobile onboarding and the
 * coach's intake form all render the same questions from one definition and
 * can never drift apart.
 */

export interface AssessmentOption {
  value: string;
  label: string;
  description?: string;
}

export interface AssessmentStep {
  id: keyof AssessmentAnswers | 'summary';
  index: number;
  eyebrow: string;
  question: string;
  helper: string;
  kind: 'single' | 'multi' | 'number';
  options: AssessmentOption[];
  /** Multi-select steps may be satisfied with nothing chosen (secondary goals). */
  optional: boolean;
  min?: number;
  max?: number;
}

const GOAL_BLURBS: Record<Goal, string> = {
  'build-muscle': 'Hypertrophy volume with progressive overload.',
  'lose-body-fat': 'Strength retention with a conditioning engine.',
  'improve-strength': 'Heavy compounds, low fatigue, long rest.',
  'improve-endurance': 'Aerobic base with structured intervals.',
  'build-healthy-habits': 'Short, repeatable sessions that stack up.',
  'improve-mobility': 'Range of motion, control and joint health.',
  'train-for-competition': 'Peaking blocks around a fixed date.',
};

const LOCATION_LABELS: Record<TrainingLocation, string> = {
  home: 'Home',
  gym: 'Gym',
  both: 'Both',
  outside: 'Outside',
};

const LOCATION_BLURBS: Record<TrainingLocation, string> = {
  home: 'Minimal kit, maximum efficiency.',
  gym: 'Full equipment, barbell-led programming.',
  both: 'Sessions adapt to wherever you are that day.',
  outside: 'Running, loaded carries and bodyweight strength.',
};

const goalOptions: AssessmentOption[] = GOALS.map((g) => ({
  value: g,
  label: GOAL_LABELS[g],
  description: GOAL_BLURBS[g],
}));

export const ASSESSMENT_STEPS: AssessmentStep[] = [
  {
    id: 'primaryGoal',
    index: 1,
    eyebrow: 'Direction',
    question: "What's your main goal?",
    helper: 'Everything else in your plan is built backwards from this one answer.',
    kind: 'single',
    options: goalOptions,
    optional: false,
  },
  {
    id: 'secondaryGoals',
    index: 2,
    eyebrow: 'Balance',
    question: 'Anything else you want to hold onto?',
    helper: 'Secondary goals shape your accessory work without diluting the main focus.',
    kind: 'multi',
    options: goalOptions,
    optional: true,
  },
  {
    id: 'ageRange',
    index: 3,
    eyebrow: 'Context',
    question: 'Which age range are you in?',
    helper: 'This tunes recovery allowance and warm-up length, nothing else.',
    kind: 'single',
    options: AGE_RANGES.map((r) => ({ value: r, label: r })),
    optional: false,
  },
  {
    id: 'experience',
    index: 4,
    eyebrow: 'Starting point',
    question: 'How much structured training have you done?',
    helper: 'Be honest here — starting one level low costs you two weeks, one level high costs you a month.',
    kind: 'single',
    options: [
      { value: 'beginner', label: 'Beginner', description: 'New to structured training, or returning after a long break.' },
      { value: 'intermediate', label: 'Intermediate', description: 'Six months or more of consistent, programmed training.' },
      { value: 'advanced', label: 'Advanced', description: 'Years of training with a working knowledge of periodisation.' },
    ],
    optional: false,
  },
  {
    id: 'daysPerWeek',
    index: 5,
    eyebrow: 'Availability',
    question: 'How many days a week can you train?',
    helper: 'Pick the number you can hit on a bad week, not a perfect one.',
    kind: 'single',
    options: [2, 3, 4, 5, 6].map((n) => ({
      value: String(n),
      label: `${n} days`,
      description: n <= 3 ? 'Full-body sessions, high value per session.' : 'Split sessions with focused volume.',
    })),
    optional: false,
  },
  {
    id: 'sessionMinutes',
    index: 6,
    eyebrow: 'Time',
    question: 'How long is a realistic session?',
    helper: 'Shorter sessions lose accessories first, never the main lift.',
    kind: 'single',
    options: [20, 30, 45, 60, 75].map((n) => ({
      value: String(n),
      label: `${n} minutes`,
    })),
    optional: false,
  },
  {
    id: 'location',
    index: 7,
    eyebrow: 'Environment',
    question: 'Where do you train?',
    helper: 'We only program movements you can actually perform where you are.',
    kind: 'single',
    options: TRAINING_LOCATIONS.map((l) => ({
      value: l,
      label: LOCATION_LABELS[l],
      description: LOCATION_BLURBS[l],
    })),
    optional: false,
  },
  {
    id: 'equipment',
    index: 8,
    eyebrow: 'Setup',
    question: 'What equipment do you have?',
    helper: 'Select everything available. Your plan never asks for a bar you do not own.',
    kind: 'multi',
    options: EQUIPMENT.map((e) => ({ value: e, label: EQUIPMENT_LABELS[e] })),
    optional: false,
  },
  {
    id: 'diet',
    index: 9,
    eyebrow: 'Fuel',
    question: 'How do you prefer to eat?',
    helper: 'Recipes, meal plans and your shopping list all respect this.',
    kind: 'single',
    options: DIET_PREFERENCES.map((d) => ({ value: d, label: DIET_LABELS[d] })),
    optional: false,
  },
  {
    id: 'coaching',
    index: 10,
    eyebrow: 'Support',
    question: 'How much support do you want?',
    helper: 'You can change this at any time — including adding a human coach later.',
    kind: 'single',
    options: [
      { value: 'self-guided', label: 'Self-guided', description: 'Give me the plan and get out of the way.' },
      { value: 'ai-assisted', label: 'FORGE AI', description: 'A 24/7 assistant that adapts sessions around my week.' },
      { value: 'human-coach', label: 'Human coach', description: 'A certified coach, weekly check-ins and form review.' },
    ],
    optional: false,
  },
];

export const ASSESSMENT_STEP_COUNT = ASSESSMENT_STEPS.length;

/** The screen a member sees at the end of the assessment. */
export interface PerformanceProfile {
  trainingLevel: ExperienceLevel;
  /** Sessions per week the plan will actually schedule. */
  suggestedFrequency: number;
  sessionMinutes: number;
  trainingFocus: string;
  recoveryPriority: 'low' | 'medium' | 'high';
  nutritionGoal: string;
  recommendedProgramSlug: string;
  recommendedProgramName: string;
  /** 0–100. Not a fitness score — a measure of how much structure the plan needs. */
  readinessForVolume: number;
  phaseEmphasis: Record<PhaseKey, string>;
  progressionType: ProgressionType;
  primaryStyles: string[];
  rationale: string[];
}

const GOAL_FOCUS: Record<Goal, string> = {
  'build-muscle': 'Hypertrophy + Strength',
  'lose-body-fat': 'Strength + Conditioning',
  'improve-strength': 'Maximal Strength',
  'improve-endurance': 'Aerobic Development',
  'build-healthy-habits': 'Consistency + Movement Quality',
  'improve-mobility': 'Mobility + Control',
  'train-for-competition': 'Peak Performance',
};

const GOAL_NUTRITION: Record<Goal, string> = {
  'build-muscle': 'Lean Muscle',
  'lose-body-fat': 'Sustainable Fat Loss',
  'improve-strength': 'Performance Maintenance',
  'improve-endurance': 'Endurance Fuelling',
  'build-healthy-habits': 'Balanced Habits',
  'improve-mobility': 'Balanced Habits',
  'train-for-competition': 'Performance Fuelling',
};

const GOAL_STYLES: Record<Goal, string[]> = {
  'build-muscle': ['strength', 'functional'],
  'lose-body-fat': ['strength', 'hiit', 'cardio'],
  'improve-strength': ['strength'],
  'improve-endurance': ['running', 'cardio'],
  'build-healthy-habits': ['functional', 'mobility', 'cardio'],
  'improve-mobility': ['mobility', 'yoga', 'pilates'],
  'train-for-competition': ['strength', 'hybrid', 'hiit'],
};

const GOAL_PROGRESSION: Record<Goal, ProgressionType> = {
  'build-muscle': 'double-progression',
  'lose-body-fat': 'volume-accumulation',
  'improve-strength': 'linear-load',
  'improve-endurance': 'distance-progression',
  'build-healthy-habits': 'volume-accumulation',
  'improve-mobility': 'time-under-tension',
  'train-for-competition': 'rpe-autoregulated',
};

/**
 * Programme recommendation. A lookup keyed on goal, narrowed by experience and
 * equipment, because a beginner with a pair of dumbbells being handed a
 * five-day barbell split is the single fastest way to lose them in week two.
 */
const GOAL_PROGRAMS: Record<Goal, { slug: string; name: string }> = {
  'build-muscle': { slug: 'muscle-builder', name: 'Muscle Builder' },
  'lose-body-fat': { slug: 'fat-loss-engine', name: 'Fat Loss Engine' },
  'improve-strength': { slug: 'strength-foundation', name: 'Strength Foundation' },
  'improve-endurance': { slug: '5k-builder', name: '5K Builder' },
  'build-healthy-habits': { slug: 'beginner-foundation', name: 'Beginner Foundation' },
  'improve-mobility': { slug: 'mobility-reset', name: 'Mobility Reset' },
  'train-for-competition': { slug: 'athletic-performance', name: 'Athletic Performance' },
};

const BARBELL_REQUIRED = new Set(['muscle-builder', 'strength-foundation', 'athletic-performance']);

function hasBarbellSetup(equipment: readonly Equipment[]): boolean {
  return equipment.includes('barbell') || equipment.includes('full-gym');
}

const AGE_RECOVERY_LOAD: Record<string, number> = {
  '18-24': 0,
  '25-34': 0,
  '35-44': 1,
  '45-54': 1,
  '55-64': 2,
  '65+': 2,
};

/**
 * Turn ten answers into a performance profile.
 *
 * Pure and total: any well-formed answer sheet produces a profile, because the
 * onboarding funnel must never dead-end a member who is one click from paying.
 */
export function buildPerformanceProfile(answers: AssessmentAnswers): PerformanceProfile {
  const rationale: string[] = [];

  const requestedDays = clamp(Math.round(answers.daysPerWeek), 1, 7);
  const experienceCap: Record<ExperienceLevel, number> = {
    beginner: 4,
    intermediate: 5,
    advanced: 6,
  };
  const frequency = Math.min(requestedDays, experienceCap[answers.experience]);
  if (frequency < requestedDays) {
    rationale.push(
      `Capped at ${frequency} sessions a week — at ${EXPERIENCE_LABELS[answers.experience].toLowerCase()} level, recovery is the limiter before availability is.`,
    );
  } else {
    rationale.push(`${frequency} sessions a week, matching the availability you gave us.`);
  }

  const ageLoad = AGE_RECOVERY_LOAD[answers.ageRange] ?? 1;
  const recoveryScore = ageLoad + (frequency >= 5 ? 1 : 0) + (answers.experience === 'beginner' ? 1 : 0);
  const recoveryPriority: PerformanceProfile['recoveryPriority'] =
    recoveryScore >= 3 ? 'high' : recoveryScore >= 1 ? 'medium' : 'low';
  if (recoveryPriority === 'high') {
    rationale.push('Recovery is scheduled as work, not as an afterthought — two dedicated sessions a week.');
  }

  // Programme selection, with an equipment reality check.
  let program = GOAL_PROGRAMS[answers.primaryGoal];
  if (BARBELL_REQUIRED.has(program.slug) && !hasBarbellSetup(answers.equipment)) {
    program =
      answers.primaryGoal === 'build-muscle'
        ? { slug: 'bodyweight-strength', name: 'Bodyweight Strength' }
        : { slug: 'functional-fitness', name: 'Functional Fitness' };
    rationale.push('Swapped to a barbell-free build — every session works with the equipment you listed.');
  }
  if (answers.experience === 'beginner' && program.slug !== 'beginner-foundation' && answers.primaryGoal !== 'improve-mobility') {
    rationale.push('Weeks 1–2 run a movement-quality on-ramp before the main block opens.');
  }

  const volumeBase = { beginner: 45, intermediate: 65, advanced: 80 }[answers.experience];
  const readinessForVolume = clamp(
    volumeBase + (frequency - 3) * 5 + (answers.sessionMinutes >= 45 ? 5 : -5) - ageLoad * 4,
    20,
    98,
  );

  const styles = new Set(GOAL_STYLES[answers.primaryGoal]);
  for (const secondary of answers.secondaryGoals) {
    const first = GOAL_STYLES[secondary][0];
    if (first) styles.add(first);
  }
  if (recoveryPriority !== 'low') styles.add('mobility');

  return {
    trainingLevel: answers.experience,
    suggestedFrequency: frequency,
    sessionMinutes: answers.sessionMinutes,
    trainingFocus: GOAL_FOCUS[answers.primaryGoal],
    recoveryPriority,
    nutritionGoal: GOAL_NUTRITION[answers.primaryGoal],
    recommendedProgramSlug: program.slug,
    recommendedProgramName: program.name,
    readinessForVolume,
    phaseEmphasis: phaseEmphasisFor(answers.primaryGoal),
    progressionType: GOAL_PROGRESSION[answers.primaryGoal],
    primaryStyles: [...styles],
    rationale,
  };
}

function phaseEmphasisFor(goal: Goal): Record<PhaseKey, string> {
  switch (goal) {
    case 'improve-endurance':
      return {
        foundation: 'Aerobic base and running economy',
        build: 'Threshold work and weekly long run',
        perform: 'Race-pace intervals and a time trial',
      };
    case 'improve-mobility':
      return {
        foundation: 'Joint range and breathing mechanics',
        build: 'Loaded end-range control',
        perform: 'Full-range strength and retesting',
      };
    case 'lose-body-fat':
      return {
        foundation: 'Movement quality and step consistency',
        build: 'Density work with strength retained',
        perform: 'Conditioning benchmarks and lean mass hold',
      };
    default:
      return {
        foundation: 'Movement quality, technique and baseline strength',
        build: 'Progressive overload and volume increase',
        perform: 'Peak strength and performance benchmarks',
      };
  }
}

/** Which plan tier this member should be shown first on the pricing page. */
export function recommendTier(coaching: CoachingPreference): 'forge' | 'forge-pro' | 'forge-coach' {
  if (coaching === 'human-coach') return 'forge-coach';
  if (coaching === 'ai-assisted') return 'forge-pro';
  return 'forge';
}

export function isCompleteAnswerSheet(value: Partial<AssessmentAnswers>): value is AssessmentAnswers {
  return (
    typeof value.primaryGoal === 'string' &&
    GOALS.includes(value.primaryGoal) &&
    Array.isArray(value.secondaryGoals) &&
    typeof value.ageRange === 'string' &&
    typeof value.experience === 'string' &&
    EXPERIENCE_LEVELS.includes(value.experience) &&
    typeof value.daysPerWeek === 'number' &&
    typeof value.sessionMinutes === 'number' &&
    typeof value.location === 'string' &&
    Array.isArray(value.equipment) &&
    value.equipment.length > 0 &&
    typeof value.diet === 'string' &&
    typeof value.coaching === 'string'
  );
}

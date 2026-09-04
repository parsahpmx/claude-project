/**
 * FORGE domain vocabulary.
 *
 * Every value here is a closed union rather than a free string. The five
 * questions the product exists to answer — what should I do today, why, am I
 * progressing, what next, who can help — are only answerable if goal, level,
 * equipment and modality mean exactly one thing across training, nutrition,
 * recovery and coaching. A stray "Strength " with a trailing space silently
 * unpersonalises a member's plan, so the compiler owns that invariant.
 */

export const GOALS = [
  'build-muscle',
  'lose-body-fat',
  'improve-strength',
  'improve-endurance',
  'build-healthy-habits',
  'improve-mobility',
  'train-for-competition',
] as const;
export type Goal = (typeof GOALS)[number];

export const GOAL_LABELS: Record<Goal, string> = {
  'build-muscle': 'Build Muscle',
  'lose-body-fat': 'Lose Body Fat',
  'improve-strength': 'Improve Strength',
  'improve-endurance': 'Improve Endurance',
  'build-healthy-habits': 'Build Healthy Habits',
  'improve-mobility': 'Improve Mobility',
  'train-for-competition': 'Train for Competition',
};

export const EXPERIENCE_LEVELS = ['beginner', 'intermediate', 'advanced'] as const;
export type ExperienceLevel = (typeof EXPERIENCE_LEVELS)[number];

export const EXPERIENCE_LABELS: Record<ExperienceLevel, string> = {
  beginner: 'Beginner',
  intermediate: 'Intermediate',
  advanced: 'Advanced',
};

export const TRAINING_LOCATIONS = ['home', 'gym', 'both', 'outside'] as const;
export type TrainingLocation = (typeof TRAINING_LOCATIONS)[number];

export const EQUIPMENT = [
  'bodyweight',
  'dumbbells',
  'barbell',
  'bench',
  'rack',
  'kettlebell',
  'resistance-bands',
  'cable-machine',
  'full-gym',
  'cardio-equipment',
] as const;
export type Equipment = (typeof EQUIPMENT)[number];

export const EQUIPMENT_LABELS: Record<Equipment, string> = {
  bodyweight: 'Bodyweight',
  dumbbells: 'Dumbbells',
  barbell: 'Barbell',
  bench: 'Bench',
  rack: 'Rack',
  kettlebell: 'Kettlebell',
  'resistance-bands': 'Resistance Bands',
  'cable-machine': 'Cable Machine',
  'full-gym': 'Full Gym',
  'cardio-equipment': 'Cardio Equipment',
};

export const TRAINING_STYLES = [
  'strength',
  'hiit',
  'running',
  'pilates',
  'yoga',
  'boxing',
  'mobility',
  'functional',
  'hybrid',
  'cardio',
  'recovery',
] as const;
export type TrainingStyle = (typeof TRAINING_STYLES)[number];

export const TRAINING_STYLE_LABELS: Record<TrainingStyle, string> = {
  strength: 'Strength',
  hiit: 'HIIT',
  running: 'Running',
  pilates: 'Pilates',
  yoga: 'Yoga',
  boxing: 'Boxing',
  mobility: 'Mobility',
  functional: 'Functional',
  hybrid: 'Hybrid',
  cardio: 'Cardio',
  recovery: 'Recovery',
};

export const BODY_FOCUS = [
  'full-body',
  'upper-body',
  'lower-body',
  'push',
  'pull',
  'core',
  'posterior-chain',
  'arms',
  'glutes',
] as const;
export type BodyFocus = (typeof BODY_FOCUS)[number];

export const MUSCLE_GROUPS = [
  'chest',
  'back',
  'shoulders',
  'quads',
  'hamstrings',
  'glutes',
  'arms',
  'core',
  'calves',
] as const;
export type MuscleGroup = (typeof MUSCLE_GROUPS)[number];

export const DIET_PREFERENCES = [
  'balanced',
  'high-protein',
  'vegetarian',
  'vegan',
  'pescatarian',
  'gluten-free',
  'dairy-free',
] as const;
export type DietPreference = (typeof DIET_PREFERENCES)[number];

export const DIET_LABELS: Record<DietPreference, string> = {
  balanced: 'Balanced',
  'high-protein': 'High Protein',
  vegetarian: 'Vegetarian',
  vegan: 'Vegan',
  pescatarian: 'Pescatarian',
  'gluten-free': 'Gluten-Free',
  'dairy-free': 'Dairy-Free',
};

export const COACHING_PREFERENCES = ['self-guided', 'ai-assisted', 'human-coach'] as const;
export type CoachingPreference = (typeof COACHING_PREFERENCES)[number];

export const WORKOUT_FORMATS = ['coached', 'self-guided'] as const;
export type WorkoutFormat = (typeof WORKOUT_FORMATS)[number];

export const AGE_RANGES = ['18-24', '25-34', '35-44', '45-54', '55-64', '65+'] as const;
export type AgeRange = (typeof AGE_RANGES)[number];

export const SEX_AT_BIRTH = ['female', 'male', 'prefer-not-to-say'] as const;
/** Used only where physiology genuinely changes the maths (BMR estimation). */
export type SexAtBirth = (typeof SEX_AT_BIRTH)[number];

export const PLAN_TIERS = ['forge', 'forge-pro', 'forge-coach'] as const;
export type PlanTier = (typeof PLAN_TIERS)[number];

export const SESSION_KINDS = [
  'strength',
  'conditioning',
  'running',
  'mobility',
  'recovery',
  'rest',
] as const;
export type SessionKind = (typeof SESSION_KINDS)[number];

export const PHASE_KEYS = ['foundation', 'build', 'perform'] as const;
export type PhaseKey = (typeof PHASE_KEYS)[number];

export const PROGRESSION_TYPES = [
  'linear-load',
  'double-progression',
  'volume-accumulation',
  'rpe-autoregulated',
  'time-under-tension',
  'distance-progression',
] as const;
export type ProgressionType = (typeof PROGRESSION_TYPES)[number];

export const PROGRESSION_LABELS: Record<ProgressionType, string> = {
  'linear-load': 'Linear load',
  'double-progression': 'Double progression',
  'volume-accumulation': 'Volume accumulation',
  'rpe-autoregulated': 'RPE autoregulated',
  'time-under-tension': 'Time under tension',
  'distance-progression': 'Distance progression',
};

export const UNIT_SYSTEMS = ['metric', 'imperial'] as const;
export type UnitSystem = (typeof UNIT_SYSTEMS)[number];

export type Difficulty = ExperienceLevel;

/** A member's answer sheet from the assessment, and the input to everything else. */
export interface AssessmentAnswers {
  primaryGoal: Goal;
  secondaryGoals: Goal[];
  ageRange: AgeRange;
  experience: ExperienceLevel;
  daysPerWeek: number;
  sessionMinutes: number;
  location: TrainingLocation;
  equipment: Equipment[];
  diet: DietPreference;
  coaching: CoachingPreference;
  /** Optional body metrics; nutrition falls back to population defaults without them. */
  heightCm?: number;
  weightKg?: number;
  sexAtBirth?: SexAtBirth;
}

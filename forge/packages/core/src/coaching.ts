import { clamp, percent } from './units.js';
import type { Goal } from './types.js';

/**
 * Coaching marketplace and the 1-to-1 relationship.
 *
 * Matching is transparent by design: every coach card shows why it ranked
 * where it did. A black-box match score in a marketplace where members spend
 * $149 a month is a support burden and a trust problem.
 */

export const COACH_SPECIALTIES = [
  'strength',
  'hypertrophy',
  'fat-loss',
  'endurance',
  'mobility',
  'nutrition',
  'return-to-training',
  'pre-post-natal',
  'sport-performance',
] as const;
export type CoachSpecialty = (typeof COACH_SPECIALTIES)[number];

export const COACH_SPECIALTY_LABELS: Record<CoachSpecialty, string> = {
  strength: 'Strength',
  hypertrophy: 'Hypertrophy',
  'fat-loss': 'Fat Loss',
  endurance: 'Endurance',
  mobility: 'Mobility',
  nutrition: 'Nutrition',
  'return-to-training': 'Return to Training',
  'pre-post-natal': 'Pre & Post-Natal',
  'sport-performance': 'Sport Performance',
};

export interface CoachProfileInput {
  slug: string;
  specialties: CoachSpecialty[];
  languages: string[];
  yearsExperience: number;
  rating: number;
  clientCount: number;
  availableSlotsThisWeek: number;
  monthlyPriceCents: number;
}

export interface CoachMatchPreferences {
  goal: Goal;
  language?: string;
  maxMonthlyPriceCents?: number;
  minRating?: number;
  needsAvailabilityThisWeek?: boolean;
  preferredSpecialties?: CoachSpecialty[];
}

export interface CoachMatch {
  slug: string;
  score: number;
  reasons: string[];
}

const GOAL_SPECIALTY: Record<Goal, CoachSpecialty[]> = {
  'build-muscle': ['hypertrophy', 'strength'],
  'lose-body-fat': ['fat-loss', 'nutrition'],
  'improve-strength': ['strength', 'sport-performance'],
  'improve-endurance': ['endurance'],
  'build-healthy-habits': ['return-to-training', 'nutrition'],
  'improve-mobility': ['mobility'],
  'train-for-competition': ['sport-performance', 'strength'],
};

export function matchCoaches(
  coaches: readonly CoachProfileInput[],
  preferences: CoachMatchPreferences,
): CoachMatch[] {
  const wanted = new Set<CoachSpecialty>([
    ...GOAL_SPECIALTY[preferences.goal],
    ...(preferences.preferredSpecialties ?? []),
  ]);

  return coaches
    .filter((coach) => {
      if (preferences.maxMonthlyPriceCents && coach.monthlyPriceCents > preferences.maxMonthlyPriceCents) return false;
      if (preferences.minRating && coach.rating < preferences.minRating) return false;
      if (preferences.needsAvailabilityThisWeek && coach.availableSlotsThisWeek <= 0) return false;
      if (preferences.language && !coach.languages.includes(preferences.language)) return false;
      return true;
    })
    .map((coach) => {
      const reasons: string[] = [];
      let score = 0;

      const overlap = coach.specialties.filter((s) => wanted.has(s));
      if (overlap.length > 0) {
        score += overlap.length * 22;
        reasons.push(`Specialises in ${overlap.map((s) => COACH_SPECIALTY_LABELS[s]).join(' and ')}`);
      }

      const experience = clamp(coach.yearsExperience, 0, 20);
      score += experience * 1.5;
      if (experience >= 8) reasons.push(`${coach.yearsExperience} years coaching experience`);

      score += (coach.rating - 4.0) * 30;
      if (coach.rating >= 4.8) reasons.push(`Rated ${coach.rating.toFixed(1)} by ${coach.clientCount} clients`);

      if (coach.availableSlotsThisWeek > 0) {
        score += 12;
        reasons.push(`${coach.availableSlotsThisWeek} slots open this week`);
      }

      if (preferences.language && coach.languages.includes(preferences.language)) {
        reasons.push(`Coaches in ${preferences.language}`);
      }

      return { slug: coach.slug, score: Math.round(score), reasons };
    })
    .sort((a, b) => b.score - a.score);
}

// --------------------------------------------------------------------------
// Weekly check-in
// --------------------------------------------------------------------------

export interface CheckInSubmission {
  /** All 1–5 scales, 5 being best except where noted. */
  energy: number;
  sleepQuality: number;
  /** 5 = most stressed. Inverted when scored. */
  stress: number;
  nutritionAdherence: number;
  trainingAdherence: number;
  weightKg?: number;
  painNotes?: string;
  questionsForCoach?: string;
  progressPhotoCount?: number;
}

export interface CheckInScore {
  overall: number;
  band: 'thriving' | 'on-track' | 'strained' | 'at-risk';
  headline: string;
  /** What the coach should open the conversation with. */
  coachPrompts: string[];
  flags: string[];
}

export function scoreCheckIn(submission: CheckInSubmission): CheckInScore {
  const normalise = (value: number) => clamp((value - 1) / 4, 0, 1) * 100;
  const stressScore = normalise(6 - clamp(submission.stress, 1, 5));

  const overall = Math.round(
    normalise(submission.energy) * 0.2 +
      normalise(submission.sleepQuality) * 0.2 +
      stressScore * 0.15 +
      normalise(submission.nutritionAdherence) * 0.2 +
      normalise(submission.trainingAdherence) * 0.25,
  );

  const flags: string[] = [];
  const coachPrompts: string[] = [];

  if (submission.painNotes && submission.painNotes.trim().length > 0) {
    flags.push('pain-reported');
    coachPrompts.push('Open with the pain note before anything else, and refer on if it is not clearly training soreness.');
  }
  if (submission.trainingAdherence <= 2) {
    flags.push('low-training-adherence');
    coachPrompts.push('Two or fewer sessions landed. Ask what got in the way before adjusting the plan.');
  }
  if (submission.sleepQuality <= 2) {
    flags.push('poor-sleep');
    coachPrompts.push('Sleep is the limiter this week — pull session volume back rather than pushing through.');
  }
  if (submission.stress >= 4) {
    flags.push('high-stress');
    coachPrompts.push('High stress reported. Consider swapping one hard session for aerobic work.');
  }
  if (submission.nutritionAdherence <= 2) {
    flags.push('low-nutrition-adherence');
    coachPrompts.push('Nutrition slipped. Pick one habit to rebuild rather than resetting the whole plan.');
  }
  if (submission.questionsForCoach && submission.questionsForCoach.trim().length > 0) {
    coachPrompts.push('They asked you a direct question — answer it first.');
  }

  const band: CheckInScore['band'] =
    overall >= 80 ? 'thriving' : overall >= 60 ? 'on-track' : overall >= 40 ? 'strained' : 'at-risk';

  const headline = {
    thriving: 'Strong week across the board.',
    'on-track': 'Solid week with one or two things to tidy up.',
    strained: 'A hard week. Adjust before it becomes a pattern.',
    'at-risk': 'This week did not work. Reset expectations together.',
  }[band];

  return { overall, band, headline, coachPrompts, flags };
}

export interface CoachWorkload {
  activeClients: number;
  pendingCheckIns: number;
  unreadMessages: number;
  upcomingCalls: number;
}

/** Capacity signal on the coach dashboard: coaches with too many clients coach none of them well. */
export function coachCapacity(workload: CoachWorkload, clientCap = 40): {
  utilisation: number;
  status: 'available' | 'busy' | 'at-capacity';
  message: string;
} {
  const utilisation = percent(workload.activeClients, clientCap);
  if (utilisation >= 95) {
    return { utilisation, status: 'at-capacity', message: 'At capacity. New enquiries are being waitlisted.' };
  }
  if (utilisation >= 75) {
    return { utilisation, status: 'busy', message: 'Nearly full. Consider closing new enquiries this month.' };
  }
  return { utilisation, status: 'available', message: 'Taking new clients.' };
}

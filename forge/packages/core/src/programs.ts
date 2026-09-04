import type {
  Difficulty,
  Equipment,
  Goal,
  ProgressionType,
  TrainingLocation,
  TrainingStyle,
} from './types.js';
import { expandEquipment } from './exercises.js';

/**
 * The programme catalogue.
 *
 * A programme is an editorial object — a promise about the next twelve weeks —
 * so it carries the claims the marketing site makes (outcomes, who it is for,
 * what it needs) in the same record the app schedules from. One source, so the
 * card on the homepage cannot promise something the plan never delivers.
 */

export interface ProgramSession {
  day: number;
  name: string;
  kind: 'strength' | 'conditioning' | 'running' | 'mobility' | 'recovery';
  focus: string;
  minutes: number;
  /** Movement patterns this session must cover, in order. */
  patterns: string[];
}

export interface Program {
  slug: string;
  name: string;
  tagline: string;
  summary: string;
  weeks: number;
  difficulty: Difficulty;
  sessionsPerWeek: number;
  sessionMinutes: number;
  location: TrainingLocation;
  styles: TrainingStyle[];
  goals: Goal[];
  equipment: Equipment[];
  progression: ProgressionType;
  coachSlug: string;
  rating: number;
  reviewCount: number;
  memberCount: number;
  /** Ordered outcomes shown on the programme page. Written as ranges, never guarantees. */
  outcomes: string[];
  whoItIsFor: string[];
  template: ProgramSession[];
  accentImage: string;
}

const S = (
  day: number,
  name: string,
  kind: ProgramSession['kind'],
  focus: string,
  minutes: number,
  patterns: string[],
): ProgramSession => ({ day, name, kind, focus, minutes, patterns });

export const PROGRAMS: Program[] = [
  {
    slug: 'muscle-builder',
    name: 'Muscle Builder',
    tagline: 'Progressive hypertrophy system.',
    summary:
      'Five sessions a week across an upper/lower split, built around double progression on the main lifts and enough accessory volume to actually change how you look. Volume climbs for three weeks then backs off, every block.',
    weeks: 12,
    difficulty: 'intermediate',
    sessionsPerWeek: 5,
    sessionMinutes: 60,
    location: 'gym',
    styles: ['strength', 'functional'],
    goals: ['build-muscle', 'improve-strength'],
    equipment: ['barbell', 'dumbbells', 'bench', 'rack'],
    progression: 'double-progression',
    coachSlug: 'maya-roberts',
    rating: 4.9,
    reviewCount: 2841,
    memberCount: 18420,
    outcomes: [
      'Add measurable load to your main lifts across all four movement patterns',
      'Accumulate 12–18 weekly working sets per major muscle group',
      'Establish a repeatable five-day training week you can sustain',
    ],
    whoItIsFor: [
      'You have six months or more of consistent gym training',
      'You have access to a barbell, rack, bench and dumbbells',
      'You can commit to five sessions most weeks',
    ],
    template: [
      S(1, 'Upper Body Strength', 'strength', 'Push emphasis', 60, ['horizontal-push', 'horizontal-pull', 'vertical-push', 'core']),
      S(2, 'Lower Body Strength', 'strength', 'Squat emphasis', 60, ['squat', 'lunge', 'hinge', 'core']),
      S(3, 'Conditioning & Core', 'conditioning', 'Aerobic base', 35, ['conditioning', 'core']),
      S(4, 'Upper Body Volume', 'strength', 'Pull emphasis', 60, ['vertical-pull', 'horizontal-push', 'horizontal-pull', 'core']),
      S(5, 'Lower Body Volume', 'strength', 'Hinge emphasis', 60, ['hinge', 'lunge', 'squat', 'core']),
      S(6, 'Mobility Reset', 'mobility', 'Full body', 20, ['mobility']),
    ],
    accentImage: 'muscle-builder',
  },
  {
    slug: 'strength-foundation',
    name: 'Strength Foundation',
    tagline: 'Get strong at the four lifts that matter.',
    summary:
      'A linear strength block on squat, bench, deadlift and press. Low fatigue, long rest, tight technique standards. The most reliable twelve weeks of progress most people will ever run.',
    weeks: 12,
    difficulty: 'beginner',
    sessionsPerWeek: 3,
    sessionMinutes: 55,
    location: 'gym',
    styles: ['strength'],
    goals: ['improve-strength', 'build-muscle'],
    equipment: ['barbell', 'rack', 'bench'],
    progression: 'linear-load',
    coachSlug: 'daniel-okafor',
    rating: 4.9,
    reviewCount: 3560,
    memberCount: 24110,
    outcomes: [
      'A working squat, bench, deadlift and press with coached technique standards',
      'A tested one-rep max estimate on all four lifts at week 12',
      'A three-day week that leaves room for the rest of your life',
    ],
    whoItIsFor: [
      'You are new to barbell training, or returning after a break',
      'You want strength first and everything else as a consequence',
      'You have three days a week and access to a rack',
    ],
    template: [
      S(1, 'Squat & Press', 'strength', 'Squat focus', 55, ['squat', 'vertical-push', 'horizontal-pull', 'core']),
      S(3, 'Deadlift & Bench', 'strength', 'Hinge focus', 55, ['hinge', 'horizontal-push', 'vertical-pull', 'core']),
      S(5, 'Squat & Accessories', 'strength', 'Volume', 55, ['squat', 'horizontal-push', 'horizontal-pull', 'core']),
      S(7, 'Mobility Reset', 'mobility', 'Full body', 20, ['mobility']),
    ],
    accentImage: 'strength-foundation',
  },
  {
    slug: 'fat-loss-engine',
    name: 'Fat Loss Engine',
    tagline: 'Keep the strength. Change the composition.',
    summary:
      'Strength work protects lean mass while density conditioning and a daily step target do the rest. Nutrition runs a moderate deficit — never below your resting requirement — because losing muscle is not the goal.',
    weeks: 12,
    difficulty: 'intermediate',
    sessionsPerWeek: 4,
    sessionMinutes: 45,
    location: 'both',
    styles: ['strength', 'hiit', 'cardio'],
    goals: ['lose-body-fat', 'improve-endurance'],
    equipment: ['dumbbells', 'kettlebell', 'bodyweight'],
    progression: 'volume-accumulation',
    coachSlug: 'sofia-lindqvist',
    rating: 4.8,
    reviewCount: 4102,
    memberCount: 31200,
    outcomes: [
      'Hold or improve your strength numbers through a calorie deficit',
      'Build a conditioning base you can measure at weeks 1, 6 and 12',
      'A daily step and protein target that survives a busy week',
    ],
    whoItIsFor: [
      'You want composition change without losing hard-earned strength',
      'You can train four days a week, at home or in a gym',
      'You would rather have a sustainable deficit than a fast one',
    ],
    template: [
      S(1, 'Full Body Strength', 'strength', 'Push/pull', 45, ['squat', 'horizontal-push', 'horizontal-pull', 'core']),
      S(2, 'Conditioning Circuit', 'conditioning', 'Density', 35, ['conditioning', 'core']),
      S(4, 'Full Body Strength', 'strength', 'Hinge/pull', 45, ['hinge', 'vertical-pull', 'vertical-push', 'core']),
      S(6, 'Long Aerobic', 'conditioning', 'Zone 2', 45, ['conditioning']),
      S(7, 'Mobility Reset', 'mobility', 'Full body', 20, ['mobility']),
    ],
    accentImage: 'fat-loss-engine',
  },
  {
    slug: 'hybrid-athlete',
    name: 'Hybrid Athlete',
    tagline: 'Strong and conditioned, without compromise.',
    summary:
      'Concurrent training done properly: strength and endurance on separate days, sequenced so neither blunts the other. For people who refuse to choose between a heavy squat and a fast 10K.',
    weeks: 12,
    difficulty: 'advanced',
    sessionsPerWeek: 5,
    sessionMinutes: 55,
    location: 'both',
    styles: ['hybrid', 'strength', 'running'],
    goals: ['train-for-competition', 'improve-strength', 'improve-endurance'],
    equipment: ['barbell', 'dumbbells', 'rack', 'cardio-equipment'],
    progression: 'rpe-autoregulated',
    coachSlug: 'daniel-okafor',
    rating: 4.9,
    reviewCount: 1180,
    memberCount: 7640,
    outcomes: [
      'Maintain strength while adding weekly aerobic volume',
      'A tested 5K and a tested squat at the end of the same block',
      'An autoregulated week that flexes with your recovery',
    ],
    whoItIsFor: [
      'You already train consistently and want both qualities',
      'You have five days and access to weights plus somewhere to run',
      'You are comfortable rating effort with RPE',
    ],
    template: [
      S(1, 'Lower Strength', 'strength', 'Squat', 55, ['squat', 'hinge', 'core']),
      S(2, 'Interval Run', 'running', 'VO2', 40, ['conditioning']),
      S(3, 'Upper Strength', 'strength', 'Push/pull', 55, ['horizontal-push', 'vertical-pull', 'core']),
      S(5, 'Tempo Run', 'running', 'Threshold', 40, ['conditioning']),
      S(6, 'Full Body Power', 'strength', 'Hinge', 55, ['hinge', 'carry', 'core']),
      S(7, 'Mobility Reset', 'mobility', 'Full body', 20, ['mobility']),
    ],
    accentImage: 'hybrid-athlete',
  },
  {
    slug: '5k-builder',
    name: '5K Builder',
    tagline: 'From first kilometre to a time you are proud of.',
    summary:
      'An eight-week aerobic build with one interval session, one tempo session and one long easy run per week. Strength work stays in to keep you durable.',
    weeks: 8,
    difficulty: 'beginner',
    sessionsPerWeek: 4,
    sessionMinutes: 40,
    location: 'outside',
    styles: ['running', 'cardio', 'strength'],
    goals: ['improve-endurance', 'build-healthy-habits'],
    equipment: ['bodyweight'],
    progression: 'distance-progression',
    coachSlug: 'amara-diallo',
    rating: 4.8,
    reviewCount: 2260,
    memberCount: 15900,
    outcomes: [
      'Run 5K continuously with a repeatable pacing strategy',
      'A measured time trial at week 1 and week 8',
      'Running-specific strength work that reduces injury risk',
    ],
    whoItIsFor: [
      'You are new to structured running or coming back to it',
      'You have somewhere to run and four sessions a week',
      'You want a time to chase, not just kilometres to log',
    ],
    template: [
      S(1, 'Easy Run', 'running', 'Aerobic base', 30, ['conditioning']),
      S(3, 'Interval Session', 'running', 'Speed', 35, ['conditioning']),
      S(5, 'Runner Strength', 'strength', 'Durability', 35, ['lunge', 'hinge', 'core']),
      S(7, 'Long Easy Run', 'running', 'Endurance', 50, ['conditioning']),
    ],
    accentImage: '5k-builder',
  },
  {
    slug: 'marathon-performance',
    name: 'Marathon Performance',
    tagline: 'Sixteen weeks to the start line, ready.',
    summary:
      'A full marathon build with progressive long runs, threshold work, a three-week taper and strength maintenance throughout. Weekly volume never jumps more than ten percent.',
    weeks: 16,
    difficulty: 'advanced',
    sessionsPerWeek: 5,
    sessionMinutes: 60,
    location: 'outside',
    styles: ['running', 'cardio'],
    goals: ['improve-endurance', 'train-for-competition'],
    equipment: ['bodyweight'],
    progression: 'distance-progression',
    coachSlug: 'amara-diallo',
    rating: 4.9,
    reviewCount: 870,
    memberCount: 4380,
    outcomes: [
      'Progressive long runs peaking three weeks before race day',
      'Threshold and marathon-pace work at the right point in the block',
      'A taper that arrives on time rather than by accident',
    ],
    whoItIsFor: [
      'You can already run 20K comfortably',
      'You have a race date sixteen weeks out',
      'You can commit five days a week including a weekend long run',
    ],
    template: [
      S(1, 'Easy Run', 'running', 'Recovery pace', 45, ['conditioning']),
      S(2, 'Threshold Intervals', 'running', 'Lactate threshold', 55, ['conditioning']),
      S(4, 'Marathon Pace', 'running', 'Race specificity', 50, ['conditioning']),
      S(5, 'Strength Maintenance', 'strength', 'Durability', 35, ['hinge', 'lunge', 'core']),
      S(7, 'Long Run', 'running', 'Endurance', 110, ['conditioning']),
    ],
    accentImage: 'marathon-performance',
  },
  {
    slug: 'mobility-reset',
    name: 'Mobility Reset',
    tagline: 'Move the way you are supposed to.',
    summary:
      'Six weeks of daily 15-minute sessions targeting hips, thoracic spine, shoulders and ankles. Range you gain is loaded so you keep it.',
    weeks: 6,
    difficulty: 'beginner',
    sessionsPerWeek: 5,
    sessionMinutes: 15,
    location: 'home',
    styles: ['mobility', 'yoga', 'recovery'],
    goals: ['improve-mobility', 'build-healthy-habits'],
    equipment: ['bodyweight'],
    progression: 'time-under-tension',
    coachSlug: 'sofia-lindqvist',
    rating: 4.9,
    reviewCount: 3910,
    memberCount: 27300,
    outcomes: [
      'Measurable range gains at hip, ankle and shoulder, retested at week 6',
      'A 15-minute daily practice that fits before or after anything else',
      'Loaded end-range work so the range you gain actually stays',
    ],
    whoItIsFor: [
      'You sit for most of the day and feel it',
      'Your squat depth or overhead position is limiting your training',
      'You want fifteen minutes, not an hour',
    ],
    template: [
      S(1, 'Hip Opener', 'mobility', 'Hips', 15, ['mobility']),
      S(2, 'Thoracic & Shoulders', 'mobility', 'Upper body', 15, ['mobility']),
      S(3, 'Ankles & Calves', 'mobility', 'Lower leg', 15, ['mobility']),
      S(4, 'Full Body Flow', 'mobility', 'Integration', 20, ['mobility']),
      S(6, 'Breath & Down-Regulation', 'recovery', 'Nervous system', 15, ['mobility']),
    ],
    accentImage: 'mobility-reset',
  },
  {
    slug: 'bodyweight-strength',
    name: 'Bodyweight Strength',
    tagline: 'No equipment. No excuses. Real strength.',
    summary:
      'Calisthenic progressions from push-up to pistol squat, programmed with the same overload logic as a barbell block. Progress comes from leverage and tempo instead of load.',
    weeks: 10,
    difficulty: 'beginner',
    sessionsPerWeek: 4,
    sessionMinutes: 35,
    location: 'home',
    styles: ['functional', 'strength'],
    goals: ['build-muscle', 'build-healthy-habits', 'improve-strength'],
    equipment: ['bodyweight'],
    progression: 'time-under-tension',
    coachSlug: 'maya-roberts',
    rating: 4.7,
    reviewCount: 2050,
    memberCount: 19870,
    outcomes: [
      'Progress through named calisthenic milestones at each movement pattern',
      'Build a training habit that survives travel and a missing gym',
      'Control and range that transfer directly to loaded lifting later',
    ],
    whoItIsFor: [
      'You have no equipment and no intention of buying any yet',
      'You travel, or your schedule makes gym time unreliable',
      'You want strength that starts from where you are today',
    ],
    template: [
      S(1, 'Push Strength', 'strength', 'Upper push', 35, ['horizontal-push', 'vertical-push', 'core']),
      S(2, 'Leg Strength', 'strength', 'Lower body', 35, ['squat', 'lunge', 'core']),
      S(4, 'Pull Strength', 'strength', 'Upper pull', 35, ['vertical-pull', 'horizontal-pull', 'core']),
      S(6, 'Full Body Circuit', 'conditioning', 'Integration', 30, ['conditioning', 'core']),
    ],
    accentImage: 'bodyweight-strength',
  },
  {
    slug: 'womens-strength',
    name: "Women's Strength",
    tagline: 'Built for strength, not for shrinking.',
    summary:
      'A four-day lower-emphasis strength block with heavy hinge and squat work, structured upper-body pulling and progressions that assume you intend to get strong.',
    weeks: 12,
    difficulty: 'beginner',
    sessionsPerWeek: 4,
    sessionMinutes: 50,
    location: 'gym',
    styles: ['strength', 'functional'],
    goals: ['improve-strength', 'build-muscle'],
    equipment: ['barbell', 'dumbbells', 'bench', 'rack'],
    progression: 'double-progression',
    coachSlug: 'sofia-lindqvist',
    rating: 4.9,
    reviewCount: 3320,
    memberCount: 22740,
    outcomes: [
      'A first bodyweight deadlift, or a meaningful step towards it',
      'Structured upper-body pulling progressions towards a first pull-up',
      'Confidence in the free-weight area with technique standards to match',
    ],
    whoItIsFor: [
      'You are new to lifting or self-taught and want structure',
      'You want lower-body strength as the centre of the plan',
      'You have four days and access to a rack',
    ],
    template: [
      S(1, 'Lower Strength', 'strength', 'Squat', 50, ['squat', 'lunge', 'core']),
      S(2, 'Upper Strength', 'strength', 'Pull emphasis', 50, ['vertical-pull', 'horizontal-push', 'core']),
      S(4, 'Posterior Chain', 'strength', 'Hinge', 50, ['hinge', 'lunge', 'core']),
      S(6, 'Full Body & Conditioning', 'conditioning', 'Integration', 40, ['conditioning', 'carry', 'core']),
    ],
    accentImage: 'womens-strength',
  },
  {
    slug: 'beginner-foundation',
    name: 'Beginner Foundation',
    tagline: 'Start properly. Everything else gets easier.',
    summary:
      'Eight weeks of three full-body sessions, teaching one movement pattern at a time with video technique checkpoints. The goal is a habit and a base, in that order.',
    weeks: 8,
    difficulty: 'beginner',
    sessionsPerWeek: 3,
    sessionMinutes: 30,
    location: 'both',
    styles: ['functional', 'strength', 'mobility'],
    goals: ['build-healthy-habits', 'improve-mobility', 'lose-body-fat'],
    equipment: ['bodyweight', 'dumbbells'],
    progression: 'volume-accumulation',
    coachSlug: 'maya-roberts',
    rating: 4.8,
    reviewCount: 5610,
    memberCount: 41200,
    outcomes: [
      'Competence in six fundamental movement patterns',
      'Three sessions a week established as a habit, not a project',
      'A baseline you can measure everything else against',
    ],
    whoItIsFor: [
      'You are starting from scratch or restarting after years away',
      'You want to be taught, not just handed a workout list',
      'You have thirty minutes, three times a week',
    ],
    template: [
      S(1, 'Foundation A', 'strength', 'Squat & push', 30, ['squat', 'horizontal-push', 'core']),
      S(3, 'Foundation B', 'strength', 'Hinge & pull', 30, ['hinge', 'horizontal-pull', 'core']),
      S(5, 'Foundation C', 'strength', 'Full body', 30, ['lunge', 'vertical-push', 'core']),
      S(7, 'Mobility & Breath', 'mobility', 'Recovery', 15, ['mobility']),
    ],
    accentImage: 'beginner-foundation',
  },
  {
    slug: 'athletic-performance',
    name: 'Athletic Performance',
    tagline: 'Power, speed and the strength underneath both.',
    summary:
      'A twelve-week block built around jumps, throws and heavy compounds, sequenced power before strength before conditioning within every session.',
    weeks: 12,
    difficulty: 'advanced',
    sessionsPerWeek: 5,
    sessionMinutes: 60,
    location: 'gym',
    styles: ['strength', 'hiit', 'functional'],
    goals: ['train-for-competition', 'improve-strength'],
    equipment: ['barbell', 'dumbbells', 'rack', 'bench'],
    progression: 'rpe-autoregulated',
    coachSlug: 'daniel-okafor',
    rating: 4.9,
    reviewCount: 940,
    memberCount: 6120,
    outcomes: [
      'Tested vertical jump and sprint benchmarks at weeks 1, 6 and 12',
      'Heavy compound strength maintained through the whole block',
      'Session ordering that develops power rather than burying it',
    ],
    whoItIsFor: [
      'You compete in a sport, or train like you do',
      'You have a solid strength base already',
      'You can commit five days and rate effort honestly',
    ],
    template: [
      S(1, 'Power & Lower Strength', 'strength', 'Squat', 60, ['squat', 'hinge', 'core']),
      S(2, 'Upper Power & Strength', 'strength', 'Push/pull', 60, ['horizontal-push', 'vertical-pull', 'core']),
      S(3, 'Conditioning', 'conditioning', 'Repeat effort', 40, ['conditioning', 'carry']),
      S(5, 'Posterior Power', 'strength', 'Hinge', 60, ['hinge', 'lunge', 'core']),
      S(6, 'Speed & Core', 'conditioning', 'Sprint mechanics', 45, ['conditioning', 'core']),
      S(7, 'Mobility Reset', 'mobility', 'Full body', 20, ['mobility']),
    ],
    accentImage: 'athletic-performance',
  },
  {
    slug: 'functional-fitness',
    name: 'Functional Fitness',
    tagline: 'Strong, capable and hard to break.',
    summary:
      'Mixed-modal training with dumbbells and kettlebells: carries, hinges, presses and conditioning couplets. Built for people who want to be useful outside the gym.',
    weeks: 10,
    difficulty: 'intermediate',
    sessionsPerWeek: 4,
    sessionMinutes: 45,
    location: 'both',
    styles: ['functional', 'hiit', 'strength'],
    goals: ['build-healthy-habits', 'lose-body-fat', 'improve-strength'],
    equipment: ['dumbbells', 'kettlebell', 'bodyweight'],
    progression: 'volume-accumulation',
    coachSlug: 'amara-diallo',
    rating: 4.8,
    reviewCount: 1740,
    memberCount: 12980,
    outcomes: [
      'Balanced capacity across strength, carrying and conditioning',
      'A four-day week that runs at home or in a gym without changes',
      'Work capacity you can measure with repeatable benchmark sessions',
    ],
    whoItIsFor: [
      'You want general capability rather than one specialised number',
      'You have dumbbells or kettlebells and limited space',
      'You like varied sessions with a clear structure underneath',
    ],
    template: [
      S(1, 'Strength & Carry', 'strength', 'Full body', 45, ['squat', 'carry', 'horizontal-push', 'core']),
      S(2, 'Conditioning Couplets', 'conditioning', 'Mixed modal', 35, ['conditioning', 'core']),
      S(4, 'Hinge & Pull', 'strength', 'Posterior', 45, ['hinge', 'horizontal-pull', 'core']),
      S(6, 'Benchmark Session', 'conditioning', 'Work capacity', 40, ['conditioning', 'carry']),
    ],
    accentImage: 'functional-fitness',
  },
];

const PROGRAM_BY_SLUG = new Map(PROGRAMS.map((p) => [p.slug, p]));

export function findProgram(slug: string): Program | undefined {
  return PROGRAM_BY_SLUG.get(slug);
}

export interface ProgramFilter {
  goal?: Goal;
  difficulty?: Difficulty;
  style?: TrainingStyle;
  location?: TrainingLocation;
  maxSessionMinutes?: number;
  equipment?: Equipment[];
  search?: string;
}

export function filterPrograms(filter: ProgramFilter, programs: readonly Program[] = PROGRAMS): Program[] {
  const owned = filter.equipment ? expandEquipment(filter.equipment) : null;
  const search = filter.search?.trim().toLowerCase();

  return programs.filter((program) => {
    if (filter.goal && !program.goals.includes(filter.goal)) return false;
    if (filter.difficulty && program.difficulty !== filter.difficulty) return false;
    if (filter.style && !program.styles.includes(filter.style)) return false;
    if (filter.location && program.location !== 'both' && program.location !== filter.location) return false;
    if (filter.maxSessionMinutes && program.sessionMinutes > filter.maxSessionMinutes) return false;
    if (owned && !program.equipment.every((item) => owned.has(item))) return false;
    if (search) {
      const haystack = `${program.name} ${program.tagline} ${program.summary} ${program.styles.join(' ')}`.toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    return true;
  });
}

/**
 * Rank programmes for a member. Goal match dominates; equipment feasibility is
 * a hard gate rather than a penalty, because recommending a programme somebody
 * cannot run is worse than recommending nothing.
 */
export function rankPrograms(
  input: { goal: Goal; difficulty: Difficulty; equipment: Equipment[]; daysPerWeek: number },
  programs: readonly Program[] = PROGRAMS,
): Program[] {
  const owned = expandEquipment(input.equipment);
  const levelIndex = { beginner: 0, intermediate: 1, advanced: 2 } as const;

  return programs
    .filter((p) => p.equipment.every((item) => owned.has(item)))
    .map((program) => {
      let score = 0;
      if (program.goals[0] === input.goal) score += 50;
      else if (program.goals.includes(input.goal)) score += 30;
      score -= Math.abs(levelIndex[program.difficulty] - levelIndex[input.difficulty]) * 12;
      score -= Math.abs(program.sessionsPerWeek - input.daysPerWeek) * 6;
      score += (program.rating - 4.5) * 20;
      return { program, score };
    })
    .sort((a, b) => b.score - a.score || b.program.memberCount - a.program.memberCount)
    .map((entry) => entry.program);
}

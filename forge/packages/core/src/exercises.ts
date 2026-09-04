import type { BodyFocus, Equipment, ExperienceLevel, MuscleGroup } from './types.js';

/**
 * Movement library.
 *
 * Each entry declares the equipment it *requires* rather than the equipment it
 * could use. Session building filters on that set, which is what makes the
 * promise on the equipment page true: a member who owns dumbbells and a bench
 * is never shown a session they cannot run.
 */

export const MOVEMENT_PATTERNS = [
  'squat',
  'hinge',
  'horizontal-push',
  'vertical-push',
  'horizontal-pull',
  'vertical-pull',
  'lunge',
  'carry',
  'core',
  'conditioning',
  'mobility',
] as const;
export type MovementPattern = (typeof MOVEMENT_PATTERNS)[number];

export interface Exercise {
  id: string;
  name: string;
  pattern: MovementPattern;
  /** Every item must be available for this exercise to be programmed. */
  requires: Equipment[];
  primary: MuscleGroup[];
  secondary: MuscleGroup[];
  focus: BodyFocus[];
  level: ExperienceLevel;
  /** True for the big compounds that anchor a session and lead progression. */
  compound: boolean;
  /** Load increment appropriate to the movement, in grams. */
  plateGrams: number;
  cue: string;
  /** Ordered fallbacks, most similar first. */
  substitutes: string[];
  /** Seconds; used for conditioning and mobility work measured in time. */
  timed?: boolean;
}

const E = (e: Exercise): Exercise => e;

export const EXERCISE_LIBRARY: Exercise[] = [
  E({
    id: 'barbell-back-squat', name: 'Barbell Back Squat', pattern: 'squat',
    requires: ['barbell', 'rack'], primary: ['quads', 'glutes'], secondary: ['core', 'hamstrings'],
    focus: ['lower-body'], level: 'intermediate', compound: true, plateGrams: 2500,
    cue: 'Keep your brace strong before beginning the descent.',
    substitutes: ['goblet-squat', 'dumbbell-front-squat', 'bodyweight-squat'],
  }),
  E({
    id: 'barbell-front-squat', name: 'Barbell Front Squat', pattern: 'squat',
    requires: ['barbell', 'rack'], primary: ['quads'], secondary: ['core', 'glutes'],
    focus: ['lower-body'], level: 'advanced', compound: true, plateGrams: 2500,
    cue: 'Elbows high the whole way — the bar follows your elbows.',
    substitutes: ['goblet-squat', 'barbell-back-squat'],
  }),
  E({
    id: 'goblet-squat', name: 'Goblet Squat', pattern: 'squat',
    requires: ['dumbbells'], primary: ['quads', 'glutes'], secondary: ['core'],
    focus: ['lower-body'], level: 'beginner', compound: true, plateGrams: 2000,
    cue: 'Sit between your hips, chest tall, weight held close to your sternum.',
    substitutes: ['bodyweight-squat', 'kettlebell-goblet-squat'],
  }),
  E({
    id: 'kettlebell-goblet-squat', name: 'Kettlebell Goblet Squat', pattern: 'squat',
    requires: ['kettlebell'], primary: ['quads', 'glutes'], secondary: ['core'],
    focus: ['lower-body'], level: 'beginner', compound: true, plateGrams: 2000,
    cue: 'Drive your knees out as you descend and keep the bell tight to your chest.',
    substitutes: ['goblet-squat', 'bodyweight-squat'],
  }),
  E({
    id: 'bodyweight-squat', name: 'Bodyweight Squat', pattern: 'squat',
    requires: ['bodyweight'], primary: ['quads', 'glutes'], secondary: ['core'],
    focus: ['lower-body'], level: 'beginner', compound: true, plateGrams: 0,
    cue: 'Full depth with control beats a fast half rep every time.',
    substitutes: ['goblet-squat'],
  }),
  E({
    id: 'dumbbell-front-squat', name: 'Dumbbell Front Squat', pattern: 'squat',
    requires: ['dumbbells'], primary: ['quads'], secondary: ['core', 'shoulders'],
    focus: ['lower-body'], level: 'intermediate', compound: true, plateGrams: 2000,
    cue: 'Rest the bells on your shoulders and keep your ribcage stacked over your pelvis.',
    substitutes: ['goblet-squat', 'bodyweight-squat'],
  }),
  E({
    id: 'conventional-deadlift', name: 'Conventional Deadlift', pattern: 'hinge',
    requires: ['barbell'], primary: ['hamstrings', 'glutes', 'back'], secondary: ['core'],
    focus: ['posterior-chain', 'lower-body'], level: 'intermediate', compound: true, plateGrams: 2500,
    cue: 'Take the slack out of the bar before you pull. The lift starts tight.',
    substitutes: ['romanian-deadlift', 'dumbbell-romanian-deadlift', 'kettlebell-swing'],
  }),
  E({
    id: 'romanian-deadlift', name: 'Romanian Deadlift', pattern: 'hinge',
    requires: ['barbell'], primary: ['hamstrings', 'glutes'], secondary: ['back', 'core'],
    focus: ['posterior-chain'], level: 'intermediate', compound: true, plateGrams: 2500,
    cue: 'Push your hips back, not down. Stop where your hamstrings stop you.',
    substitutes: ['dumbbell-romanian-deadlift', 'kettlebell-swing'],
  }),
  E({
    id: 'dumbbell-romanian-deadlift', name: 'Dumbbell Romanian Deadlift', pattern: 'hinge',
    requires: ['dumbbells'], primary: ['hamstrings', 'glutes'], secondary: ['back'],
    focus: ['posterior-chain'], level: 'beginner', compound: true, plateGrams: 2000,
    cue: 'Bells stay in contact with your legs the whole way down.',
    substitutes: ['kettlebell-swing', 'glute-bridge'],
  }),
  E({
    id: 'kettlebell-swing', name: 'Kettlebell Swing', pattern: 'hinge',
    requires: ['kettlebell'], primary: ['glutes', 'hamstrings'], secondary: ['core', 'back'],
    focus: ['posterior-chain'], level: 'beginner', compound: true, plateGrams: 4000,
    cue: 'The bell is thrown by your hips, not lifted by your arms.',
    substitutes: ['glute-bridge', 'dumbbell-romanian-deadlift'],
  }),
  E({
    id: 'hip-thrust', name: 'Barbell Hip Thrust', pattern: 'hinge',
    requires: ['barbell', 'bench'], primary: ['glutes'], secondary: ['hamstrings', 'core'],
    focus: ['glutes', 'posterior-chain'], level: 'intermediate', compound: true, plateGrams: 2500,
    cue: 'Finish with your ribs down — squeeze the glutes, do not arch the lower back.',
    substitutes: ['glute-bridge', 'dumbbell-romanian-deadlift'],
  }),
  E({
    id: 'glute-bridge', name: 'Glute Bridge', pattern: 'hinge',
    requires: ['bodyweight'], primary: ['glutes'], secondary: ['hamstrings'],
    focus: ['glutes'], level: 'beginner', compound: false, plateGrams: 0,
    cue: 'Drive through your heels and pause for a full second at the top.',
    substitutes: ['hip-thrust'],
  }),
  E({
    id: 'barbell-bench-press', name: 'Barbell Bench Press', pattern: 'horizontal-push',
    requires: ['barbell', 'bench'], primary: ['chest'], secondary: ['shoulders', 'arms'],
    focus: ['upper-body', 'push'], level: 'intermediate', compound: true, plateGrams: 2500,
    cue: 'Shoulder blades pinned to the bench, feet driving into the floor.',
    substitutes: ['dumbbell-bench-press', 'push-up'],
  }),
  E({
    id: 'dumbbell-bench-press', name: 'Dumbbell Bench Press', pattern: 'horizontal-push',
    requires: ['dumbbells', 'bench'], primary: ['chest'], secondary: ['shoulders', 'arms'],
    focus: ['upper-body', 'push'], level: 'beginner', compound: true, plateGrams: 2000,
    cue: 'Lower until your elbows sit level with your torso, then press together.',
    substitutes: ['push-up', 'barbell-bench-press'],
  }),
  E({
    id: 'push-up', name: 'Push-Up', pattern: 'horizontal-push',
    requires: ['bodyweight'], primary: ['chest'], secondary: ['shoulders', 'arms', 'core'],
    focus: ['upper-body', 'push'], level: 'beginner', compound: true, plateGrams: 0,
    cue: 'One straight line from heels to head. Squeeze your glutes to hold it.',
    substitutes: ['dumbbell-bench-press'],
  }),
  E({
    id: 'overhead-press', name: 'Standing Overhead Press', pattern: 'vertical-push',
    requires: ['barbell'], primary: ['shoulders'], secondary: ['arms', 'core'],
    focus: ['upper-body', 'push'], level: 'intermediate', compound: true, plateGrams: 2500,
    cue: 'Squeeze your glutes before you press — the floor is where the strength comes from.',
    substitutes: ['dumbbell-shoulder-press', 'pike-push-up'],
  }),
  E({
    id: 'dumbbell-shoulder-press', name: 'Dumbbell Shoulder Press', pattern: 'vertical-push',
    requires: ['dumbbells'], primary: ['shoulders'], secondary: ['arms'],
    focus: ['upper-body', 'push'], level: 'beginner', compound: true, plateGrams: 2000,
    cue: 'Press slightly forward of your ears, finishing with biceps by your head.',
    substitutes: ['pike-push-up', 'overhead-press'],
  }),
  E({
    id: 'pike-push-up', name: 'Pike Push-Up', pattern: 'vertical-push',
    requires: ['bodyweight'], primary: ['shoulders'], secondary: ['arms', 'core'],
    focus: ['upper-body', 'push'], level: 'intermediate', compound: true, plateGrams: 0,
    cue: 'Hips high, crown of the head towards the floor between your hands.',
    substitutes: ['push-up'],
  }),
  E({
    id: 'barbell-row', name: 'Barbell Bent-Over Row', pattern: 'horizontal-pull',
    requires: ['barbell'], primary: ['back'], secondary: ['arms', 'core'],
    focus: ['upper-body', 'pull'], level: 'intermediate', compound: true, plateGrams: 2500,
    cue: 'Row to your lower ribs and control the bar all the way back down.',
    substitutes: ['dumbbell-row', 'inverted-row', 'band-row'],
  }),
  E({
    id: 'dumbbell-row', name: 'Single-Arm Dumbbell Row', pattern: 'horizontal-pull',
    requires: ['dumbbells'], primary: ['back'], secondary: ['arms'],
    focus: ['upper-body', 'pull'], level: 'beginner', compound: true, plateGrams: 2000,
    cue: 'Lead with the elbow and keep your shoulders square to the floor.',
    substitutes: ['band-row', 'inverted-row'],
  }),
  E({
    id: 'inverted-row', name: 'Inverted Row', pattern: 'horizontal-pull',
    requires: ['bodyweight'], primary: ['back'], secondary: ['arms', 'core'],
    focus: ['upper-body', 'pull'], level: 'beginner', compound: true, plateGrams: 0,
    cue: 'Body rigid, chest to the bar, no hips sagging at the top.',
    substitutes: ['band-row', 'dumbbell-row'],
  }),
  E({
    id: 'band-row', name: 'Resistance Band Row', pattern: 'horizontal-pull',
    requires: ['resistance-bands'], primary: ['back'], secondary: ['arms'],
    focus: ['upper-body', 'pull'], level: 'beginner', compound: false, plateGrams: 0,
    cue: 'Pull the band apart as you row to switch the mid-back on.',
    substitutes: ['inverted-row', 'dumbbell-row'],
  }),
  E({
    id: 'pull-up', name: 'Pull-Up', pattern: 'vertical-pull',
    requires: ['bodyweight'], primary: ['back'], secondary: ['arms', 'core'],
    focus: ['upper-body', 'pull'], level: 'intermediate', compound: true, plateGrams: 0,
    cue: 'Start from a dead hang and pull your chest towards the bar, not your chin over it.',
    substitutes: ['lat-pulldown', 'band-assisted-pull-up', 'inverted-row'],
  }),
  E({
    id: 'band-assisted-pull-up', name: 'Band-Assisted Pull-Up', pattern: 'vertical-pull',
    requires: ['resistance-bands'], primary: ['back'], secondary: ['arms'],
    focus: ['upper-body', 'pull'], level: 'beginner', compound: true, plateGrams: 0,
    cue: 'Use the least assistance that lets you finish every rep with control.',
    substitutes: ['inverted-row', 'lat-pulldown'],
  }),
  E({
    id: 'lat-pulldown', name: 'Lat Pulldown', pattern: 'vertical-pull',
    requires: ['cable-machine'], primary: ['back'], secondary: ['arms'],
    focus: ['upper-body', 'pull'], level: 'beginner', compound: true, plateGrams: 2500,
    cue: 'Drive your elbows down and back; the bar follows.',
    substitutes: ['pull-up', 'band-assisted-pull-up'],
  }),
  E({
    id: 'walking-lunge', name: 'Walking Lunge', pattern: 'lunge',
    requires: ['bodyweight'], primary: ['quads', 'glutes'], secondary: ['core', 'hamstrings'],
    focus: ['lower-body'], level: 'beginner', compound: true, plateGrams: 0,
    cue: 'Step long enough that your front shin stays close to vertical.',
    substitutes: ['dumbbell-lunge', 'split-squat'],
  }),
  E({
    id: 'dumbbell-lunge', name: 'Dumbbell Reverse Lunge', pattern: 'lunge',
    requires: ['dumbbells'], primary: ['quads', 'glutes'], secondary: ['core'],
    focus: ['lower-body'], level: 'beginner', compound: true, plateGrams: 2000,
    cue: 'Step back, not down. Your front foot never moves.',
    substitutes: ['walking-lunge', 'split-squat'],
  }),
  E({
    id: 'split-squat', name: 'Bulgarian Split Squat', pattern: 'lunge',
    requires: ['bench'], primary: ['quads', 'glutes'], secondary: ['core'],
    focus: ['lower-body'], level: 'intermediate', compound: true, plateGrams: 2000,
    cue: 'Front foot far enough forward that the back knee tracks straight down.',
    substitutes: ['walking-lunge', 'dumbbell-lunge'],
  }),
  E({
    id: 'farmers-carry', name: "Farmer's Carry", pattern: 'carry',
    requires: ['dumbbells'], primary: ['core', 'back'], secondary: ['arms'],
    focus: ['full-body', 'core'], level: 'beginner', compound: true, plateGrams: 2000,
    cue: 'Tall posture, shoulders down, breathe through the carry.', timed: true,
    substitutes: ['plank'],
  }),
  E({
    id: 'plank', name: 'Plank', pattern: 'core',
    requires: ['bodyweight'], primary: ['core'], secondary: ['shoulders'],
    focus: ['core'], level: 'beginner', compound: false, plateGrams: 0, timed: true,
    cue: 'Ribs down, glutes on. Quality beats duration.',
    substitutes: ['dead-bug', 'hollow-hold'],
  }),
  E({
    id: 'dead-bug', name: 'Dead Bug', pattern: 'core',
    requires: ['bodyweight'], primary: ['core'], secondary: [],
    focus: ['core'], level: 'beginner', compound: false, plateGrams: 0,
    cue: 'Lower back stays flat to the floor the entire set.',
    substitutes: ['plank', 'hollow-hold'],
  }),
  E({
    id: 'hollow-hold', name: 'Hollow Hold', pattern: 'core',
    requires: ['bodyweight'], primary: ['core'], secondary: [],
    focus: ['core'], level: 'intermediate', compound: false, plateGrams: 0, timed: true,
    cue: 'Press your lower back into the floor and hold the shape, not the clock.',
    substitutes: ['plank', 'dead-bug'],
  }),
  E({
    id: 'pallof-press', name: 'Pallof Press', pattern: 'core',
    requires: ['resistance-bands'], primary: ['core'], secondary: ['shoulders'],
    focus: ['core'], level: 'beginner', compound: false, plateGrams: 0,
    cue: 'Resist the rotation. The press is the easy part.',
    substitutes: ['dead-bug', 'plank'],
  }),
  E({
    id: 'rowing-intervals', name: 'Rowing Intervals', pattern: 'conditioning',
    requires: ['cardio-equipment'], primary: ['back', 'quads'], secondary: ['core'],
    focus: ['full-body'], level: 'beginner', compound: true, plateGrams: 0, timed: true,
    cue: 'Legs, then hips, then arms. Reverse it on the way back.',
    substitutes: ['assault-bike-intervals', 'burpee'],
  }),
  E({
    id: 'assault-bike-intervals', name: 'Air Bike Intervals', pattern: 'conditioning',
    requires: ['cardio-equipment'], primary: ['quads'], secondary: ['shoulders', 'core'],
    focus: ['full-body'], level: 'beginner', compound: true, plateGrams: 0, timed: true,
    cue: 'Set a pace you can hold for the whole interval, not just the first one.',
    substitutes: ['rowing-intervals', 'burpee'],
  }),
  E({
    id: 'burpee', name: 'Burpee', pattern: 'conditioning',
    requires: ['bodyweight'], primary: ['chest', 'quads'], secondary: ['core', 'shoulders'],
    focus: ['full-body'], level: 'beginner', compound: true, plateGrams: 0, timed: true,
    cue: 'Soft landing, full stand at the top. Pace it — this is a set, not a sprint.',
    substitutes: ['mountain-climber'],
  }),
  E({
    id: 'mountain-climber', name: 'Mountain Climber', pattern: 'conditioning',
    requires: ['bodyweight'], primary: ['core'], secondary: ['shoulders', 'quads'],
    focus: ['full-body', 'core'], level: 'beginner', compound: false, plateGrams: 0, timed: true,
    cue: 'Hips stay low and still — only the legs move.',
    substitutes: ['burpee'],
  }),
  E({
    id: 'easy-run', name: 'Easy Aerobic Run', pattern: 'conditioning',
    requires: ['bodyweight'], primary: ['quads', 'calves'], secondary: ['hamstrings', 'core'],
    focus: ['full-body'], level: 'beginner', compound: true, plateGrams: 0, timed: true,
    cue: 'Conversational pace. If you cannot talk, you are running the wrong session.',
    substitutes: ['rowing-intervals'],
  }),
  E({
    id: 'tempo-run', name: 'Tempo Run', pattern: 'conditioning',
    requires: ['bodyweight'], primary: ['quads', 'calves'], secondary: ['hamstrings'],
    focus: ['full-body'], level: 'intermediate', compound: true, plateGrams: 0, timed: true,
    cue: 'Comfortably hard — the pace you could hold for an hour if you had to.',
    substitutes: ['easy-run'],
  }),
  E({
    id: 'interval-run', name: 'Interval Run', pattern: 'conditioning',
    requires: ['bodyweight'], primary: ['quads', 'calves'], secondary: ['core'],
    focus: ['full-body'], level: 'intermediate', compound: true, plateGrams: 0, timed: true,
    cue: 'Even splits. The last rep should look like the first.',
    substitutes: ['tempo-run', 'rowing-intervals'],
  }),
  E({
    id: 'hip-flexor-stretch', name: '90/90 Hip Opener', pattern: 'mobility',
    requires: ['bodyweight'], primary: ['glutes'], secondary: ['core'],
    focus: ['lower-body'], level: 'beginner', compound: false, plateGrams: 0, timed: true,
    cue: 'Sit tall first, then rotate. Range comes from position, not force.',
    substitutes: ['couch-stretch', 'cat-cow'],
  }),
  E({
    id: 'couch-stretch', name: 'Couch Stretch', pattern: 'mobility',
    requires: ['bodyweight'], primary: ['quads'], secondary: ['core'],
    focus: ['lower-body'], level: 'beginner', compound: false, plateGrams: 0, timed: true,
    cue: 'Squeeze the glute of the back leg to protect your lower back.',
    substitutes: ['hip-flexor-stretch'],
  }),
  E({
    id: 'cat-cow', name: 'Cat-Cow', pattern: 'mobility',
    requires: ['bodyweight'], primary: ['core'], secondary: ['back'],
    focus: ['full-body'], level: 'beginner', compound: false, plateGrams: 0, timed: true,
    cue: 'Move one vertebra at a time and let your breath set the pace.',
    substitutes: ['thoracic-rotation'],
  }),
  E({
    id: 'thoracic-rotation', name: 'Thoracic Rotation', pattern: 'mobility',
    requires: ['bodyweight'], primary: ['back'], secondary: ['shoulders'],
    focus: ['upper-body'], level: 'beginner', compound: false, plateGrams: 0, timed: true,
    cue: 'Rotate from the ribcage. Your lower back stays quiet.',
    substitutes: ['cat-cow'],
  }),
  E({
    id: 'ankle-mobilisation', name: 'Ankle Mobilisation', pattern: 'mobility',
    requires: ['bodyweight'], primary: ['calves'], secondary: [],
    focus: ['lower-body'], level: 'beginner', compound: false, plateGrams: 0, timed: true,
    cue: 'Knee travels over the middle toe with the heel glued down.',
    substitutes: ['couch-stretch'],
  }),
  E({
    id: 'box-breathing', name: 'Box Breathing', pattern: 'mobility',
    requires: ['bodyweight'], primary: ['core'], secondary: [],
    focus: ['full-body'], level: 'beginner', compound: false, plateGrams: 0, timed: true,
    cue: 'Four in, four hold, four out, four hold. Nasal breathing throughout.',
    substitutes: ['cat-cow'],
  }),
  E({
    id: 'bicep-curl', name: 'Dumbbell Bicep Curl', pattern: 'horizontal-pull',
    requires: ['dumbbells'], primary: ['arms'], secondary: [],
    focus: ['arms'], level: 'beginner', compound: false, plateGrams: 1000,
    cue: 'Elbows pinned to your ribs — no swinging for the last two reps.',
    substitutes: ['band-row'],
  }),
  E({
    id: 'triceps-extension', name: 'Overhead Triceps Extension', pattern: 'vertical-push',
    requires: ['dumbbells'], primary: ['arms'], secondary: ['shoulders'],
    focus: ['arms'], level: 'beginner', compound: false, plateGrams: 1000,
    cue: 'Upper arms stay still; only the forearms move.',
    substitutes: ['push-up'],
  }),
  E({
    id: 'lateral-raise', name: 'Lateral Raise', pattern: 'vertical-push',
    requires: ['dumbbells'], primary: ['shoulders'], secondary: [],
    focus: ['upper-body'], level: 'beginner', compound: false, plateGrams: 1000,
    cue: 'Lead with your elbows and stop at shoulder height.',
    substitutes: ['dumbbell-shoulder-press'],
  }),
  E({
    id: 'calf-raise', name: 'Standing Calf Raise', pattern: 'lunge',
    requires: ['bodyweight'], primary: ['calves'], secondary: [],
    focus: ['lower-body'], level: 'beginner', compound: false, plateGrams: 0,
    cue: 'Full stretch at the bottom, full contraction at the top, no bouncing.',
    substitutes: ['walking-lunge'],
  }),
];

const BY_ID = new Map(EXERCISE_LIBRARY.map((e) => [e.id, e]));

export function findExercise(id: string): Exercise | undefined {
  return BY_ID.get(id);
}

/**
 * "Full gym" implies everything; a member who ticks it should not also have to
 * tick barbell, rack and bench for the plan to open up.
 */
export function expandEquipment(owned: readonly Equipment[]): Set<Equipment> {
  const set = new Set<Equipment>(owned);
  set.add('bodyweight');
  if (set.has('full-gym')) {
    for (const item of [
      'dumbbells', 'barbell', 'bench', 'rack', 'kettlebell',
      'resistance-bands', 'cable-machine', 'cardio-equipment',
    ] as const) {
      set.add(item);
    }
  }
  return set;
}

export function canPerform(exercise: Exercise, owned: readonly Equipment[]): boolean {
  const available = expandEquipment(owned);
  return exercise.requires.every((item) => available.has(item));
}

export function availableExercises(owned: readonly Equipment[]): Exercise[] {
  return EXERCISE_LIBRARY.filter((e) => canPerform(e, owned));
}

/**
 * Substitute an exercise the member cannot or does not want to do.
 *
 * Walks the declared substitutes in order, then falls back to any performable
 * exercise sharing the movement pattern. Returns null rather than a wrong-
 * pattern guess: an honest "no substitute available" beats swapping a squat
 * for a bicep curl.
 */
export function substituteExercise(
  exerciseId: string,
  owned: readonly Equipment[],
  exclude: readonly string[] = [],
): Exercise | null {
  const original = findExercise(exerciseId);
  if (!original) return null;
  const blocked = new Set([exerciseId, ...exclude]);

  for (const candidateId of original.substitutes) {
    const candidate = findExercise(candidateId);
    if (candidate && !blocked.has(candidate.id) && canPerform(candidate, owned)) return candidate;
  }

  const sameMovement = EXERCISE_LIBRARY.find(
    (e) => e.pattern === original.pattern && !blocked.has(e.id) && canPerform(e, owned),
  );
  return sameMovement ?? null;
}

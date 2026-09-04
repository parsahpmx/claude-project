import { formatLoad, formatMinutes } from './units.js';
import type { ReadinessResult } from './readiness.js';
import type { MacroTargets } from './nutrition.js';
import { substituteExercise, findExercise } from './exercises.js';
import type { Equipment, UnitSystem } from './types.js';

/**
 * FORGE AI — the 24/7 training assistant.
 *
 * This is a reasoning layer over the member's own data, not a chatbot with a
 * personality. Three rules hold it together:
 *
 *  1. It only answers from context it was actually given. If readiness is
 *     missing it says so rather than inventing a number, because a member who
 *     catches it making one up will never trust the next answer either.
 *  2. It never answers a medical or injury question. Those are routed to a
 *     qualified professional, every time, with no "but generally speaking".
 *  3. Its adjustments go through the same engines the plan uses. It cannot
 *     prescribe something the programme layer would refuse to.
 *
 * The intent classifier is deliberately explicit rather than a model call: it
 * runs offline, it is testable, and its failure mode is "I don't know" rather
 * than a confident wrong answer. `answer()` returns a structured response that
 * a language model can render more fluently when one is configured, without
 * being able to change the recommendation itself.
 */

export const AI_INTENTS = [
  'what-should-i-train',
  'substitute-exercise',
  'why-recovery-fell',
  'shorten-workout',
  'post-training-nutrition',
  'progress-check',
  'medical',
  'unknown',
] as const;
export type AiIntent = (typeof AI_INTENTS)[number];

export interface AiContext {
  firstName: string;
  unitSystem: UnitSystem;
  todaySessionTitle: string | null;
  todaySessionMinutes: number | null;
  todaySessionKind: string | null;
  readiness: ReadinessResult | null;
  macros: MacroTargets | null;
  equipment: Equipment[];
  weeklyCompleted: number;
  weeklyTarget: number;
  currentStreakDays: number;
  programName: string | null;
  weekNumber: number | null;
  totalWeeks: number | null;
  hasHumanCoach: boolean;
  lastSessionRpe?: number;
}

export interface AiAnswer {
  intent: AiIntent;
  headline: string;
  body: string[];
  /** Concrete actions the client renders as buttons. */
  actions: { label: string; action: string }[];
  /** Which parts of the member's data the answer drew on. Always shown. */
  sources: string[];
  disclaimer?: string;
}

export const MEDICAL_DISCLAIMER =
  'FORGE AI is a training assistant, not a medical professional. For pain, injury, or any medical question, speak to a qualified healthcare provider before continuing to train.';

export const SUGGESTED_QUESTIONS = [
  'What should I train today?',
  'Can I replace squats?',
  'Why did my recovery score fall?',
  "Adjust today's workout to 30 minutes.",
  'What should I eat after training?',
  'Am I actually making progress?',
];

/**
 * The medical gate is deliberately over-broad. A false positive costs a member
 * one redirect to their coach; a false negative is FORGE giving injury advice.
 * Stems cover inflections ("tear" does not match "tore", so both are listed).
 */
const MEDICAL_TERMS = [
  'injur', 'pain', 'hurt', 'physio', 'sprain', 'strain', 'fracture', 'broke',
  'tear', 'tore', 'torn', 'rupture', 'pulled a', 'pop',
  'surgery', 'surgical', 'medication', 'medicine', 'diagnos', 'doctor', 'gp ',
  'concussion', 'pregnan', 'post-natal', 'postnatal', 'rehab', 'tendon',
  'ligament', 'inflam', 'arthrit', 'hernia', 'disc ', 'sciatic',
  'dizzy', 'faint', 'nausea', 'numb', 'tingl', 'swell', 'ache', 'aching',
  'blood pressure', 'heart condition', 'palpitation', 'breathless',
  'shortness of breath', 'unwell', 'illness', 'sick',
];

const INTENT_PATTERNS: { intent: AiIntent; patterns: RegExp[] }[] = [
  {
    intent: 'substitute-exercise',
    patterns: [/\b(replace|substitut|swap|instead of|alternative)\b/i],
  },
  {
    intent: 'shorten-workout',
    patterns: [/\b(shorten|adjust|cut|only have|reduce)\b.*\b(minute|min|hour|time)\b/i, /\b\d+\s*(minutes|mins|min)\b/i],
  },
  {
    intent: 'why-recovery-fell',
    patterns: [/\b(recovery|readiness|hrv|sleep score)\b.*\b(fell|drop|down|low|worse|bad)\b/i, /\bwhy.*\b(recovery|readiness)\b/i],
  },
  {
    intent: 'post-training-nutrition',
    patterns: [/\b(eat|meal|food|protein|carb|nutrition|macro)\b/i],
  },
  {
    intent: 'progress-check',
    patterns: [/\b(progress|improving|getting (stronger|fitter)|working)\b/i],
  },
  {
    intent: 'what-should-i-train',
    patterns: [/\b(what should i (train|do)|today'?s? (workout|session|training)|train today)\b/i],
  },
];

export function classifyIntent(question: string): AiIntent {
  const text = question.toLowerCase();
  if (MEDICAL_TERMS.some((term) => text.includes(term))) return 'medical';
  for (const { intent, patterns } of INTENT_PATTERNS) {
    if (patterns.some((p) => p.test(question))) return intent;
  }
  return 'unknown';
}

export function answer(question: string, context: AiContext): AiAnswer {
  const intent = classifyIntent(question);
  switch (intent) {
    case 'medical':
      return medicalAnswer();
    case 'what-should-i-train':
      return trainTodayAnswer(context);
    case 'substitute-exercise':
      return substituteAnswer(question, context);
    case 'why-recovery-fell':
      return recoveryAnswer(context);
    case 'shorten-workout':
      return shortenAnswer(question, context);
    case 'post-training-nutrition':
      return nutritionAnswer(context);
    case 'progress-check':
      return progressAnswer(context);
    default:
      return unknownAnswer(context);
  }
}

function medicalAnswer(): AiAnswer {
  return {
    intent: 'medical',
    headline: 'This one needs a professional, not an assistant.',
    body: [
      'I am not able to advise on pain, injury or any medical question, and guessing here could genuinely hurt you.',
      'If something hurts, stop training that movement. Speak to a physiotherapist or doctor before you load it again.',
    ],
    actions: [
      { label: 'Message my coach', action: 'open-coach-chat' },
      { label: 'Log a pain note', action: 'open-check-in' },
      { label: 'Switch to mobility today', action: 'swap-to-mobility' },
    ],
    sources: [],
    disclaimer: MEDICAL_DISCLAIMER,
  };
}

function trainTodayAnswer(context: AiContext): AiAnswer {
  const sources = ['Today’s plan'];
  const body: string[] = [];

  if (!context.todaySessionTitle) {
    return {
      intent: 'what-should-i-train',
      headline: 'Today is a rest day.',
      body: [
        'Nothing is scheduled, and that is deliberate — the adaptation from this week happens on days like today.',
        'If you want to move, a 15-minute mobility session or an easy walk fits without touching your recovery.',
      ],
      actions: [
        { label: 'Open a mobility session', action: 'open-recovery' },
        { label: 'See this week', action: 'open-plan' },
      ],
      sources,
    };
  }

  body.push(
    `Your plan has ${context.todaySessionTitle}${context.todaySessionMinutes ? `, ${formatMinutes(context.todaySessionMinutes)}` : ''}.`,
  );

  const readiness = context.readiness;
  if (readiness && readiness.score !== null) {
    sources.push('Readiness score');
    body.push(`Readiness is ${readiness.score} — ${readiness.headline.toLowerCase()}. ${readiness.guidance}`);
  } else {
    body.push('I do not have readiness data for today, so this is the plan as written rather than an adjusted version.');
  }

  if (context.weeklyTarget > 0) {
    sources.push('Weekly adherence');
    const remaining = Math.max(0, context.weeklyTarget - context.weeklyCompleted);
    body.push(
      remaining === 0
        ? `You have already hit all ${context.weeklyTarget} sessions this week. Anything today is a bonus.`
        : `That is ${context.weeklyCompleted} of ${context.weeklyTarget} sessions this week, with ${remaining} to go.`,
    );
  }

  return {
    intent: 'what-should-i-train',
    headline: context.todaySessionTitle,
    body,
    actions: [
      { label: 'Start workout', action: 'start-workout' },
      { label: 'Shorten to 30 minutes', action: 'shorten-30' },
      { label: 'Swap this session', action: 'swap-session' },
    ],
    sources,
  };
}

function substituteAnswer(question: string, context: AiContext): AiAnswer {
  const mentioned = findMentionedExercise(question);
  if (!mentioned) {
    return {
      intent: 'substitute-exercise',
      headline: 'Tell me which movement and I will swap it.',
      body: [
        'I can substitute any movement in today’s session for one that trains the same pattern with the equipment you have.',
        'Open the session and use Substitute on the exercise, or name it here — for example, "can I replace barbell back squat?".',
      ],
      actions: [{ label: 'Open today’s session', action: 'start-workout' }],
      sources: ['Your equipment'],
    };
  }

  const replacement = substituteExercise(mentioned.id, context.equipment);
  if (!replacement) {
    return {
      intent: 'substitute-exercise',
      headline: `No good swap for ${mentioned.name} with your current setup.`,
      body: [
        `Everything that trains the ${mentioned.pattern.replace('-', ' ')} pattern needs equipment you have not listed.`,
        'Update your equipment and I will re-check, or skip the movement today and keep the rest of the session intact.',
      ],
      actions: [
        { label: 'Update my equipment', action: 'open-equipment' },
        { label: 'Skip this exercise', action: 'skip-exercise' },
      ],
      sources: ['Your equipment', 'Movement library'],
    };
  }

  return {
    intent: 'substitute-exercise',
    headline: `Swap ${mentioned.name} for ${replacement.name}.`,
    body: [
      `Both train the ${mentioned.pattern.replace('-', ' ')} pattern, so your week keeps its balance.`,
      `Coaching cue: ${replacement.cue}`,
      'Your progression carries across — the plan tracks the pattern, not the specific bar.',
    ],
    actions: [
      { label: `Use ${replacement.name}`, action: `substitute:${mentioned.id}:${replacement.id}` },
      { label: 'See other options', action: `substitutes:${mentioned.id}` },
    ],
    sources: ['Your equipment', 'Movement library'],
  };
}

function recoveryAnswer(context: AiContext): AiAnswer {
  const readiness = context.readiness;
  if (!readiness || readiness.score === null) {
    return {
      intent: 'why-recovery-fell',
      headline: 'I do not have recovery data to explain yet.',
      body: [
        'Readiness needs sleep, HRV or resting heart rate from a connected device, or a manual morning check-in.',
        'Connect a wearable and I can tell you exactly which input moved and by how much.',
      ],
      actions: [{ label: 'Connect a wearable', action: 'open-wearables' }],
      sources: [],
    };
  }

  const weakest = [...readiness.components].sort((a, b) => a.score - b.score)[0];
  const body = [
    `Readiness is ${readiness.score} today — ${readiness.headline.toLowerCase()}.`,
  ];
  if (weakest) {
    body.push(
      `The input pulling it down is ${weakest.label.toLowerCase()}: ${weakest.detail}. That contributes ${Math.round(weakest.weight * 100)}% of the score.`,
    );
  }
  body.push(readiness.guidance);
  if (typeof context.lastSessionRpe === 'number' && context.lastSessionRpe >= 8.5) {
    body.push(`Your last session came in at RPE ${context.lastSessionRpe.toFixed(1)}, which is a large part of why today reads lower.`);
  }

  return {
    intent: 'why-recovery-fell',
    headline: `Readiness ${readiness.score} — ${readiness.headline}`,
    body,
    actions: [
      { label: 'Adjust today’s session', action: 'adapt-session' },
      { label: 'Open recovery', action: 'open-recovery' },
    ],
    sources: ['Readiness inputs', 'Recent session load'],
  };
}

function shortenAnswer(question: string, context: AiContext): AiAnswer {
  const requested = extractMinutes(question) ?? 30;
  if (!context.todaySessionTitle) {
    return {
      intent: 'shorten-workout',
      headline: 'Nothing scheduled to shorten today.',
      body: ['Today is a rest day. If you want to move, a 15-minute mobility session is the right size.'],
      actions: [{ label: 'Open a mobility session', action: 'open-recovery' }],
      sources: ['Today’s plan'],
    };
  }

  const original = context.todaySessionMinutes ?? 45;
  const kept = requested >= original
    ? 'Nothing needs cutting — that is already at or above the scheduled length.'
    : 'I keep the main lift and its working sets, drop the accessories from the bottom of the session up, and shorten rest on the last block only.';

  return {
    intent: 'shorten-workout',
    headline: `${context.todaySessionTitle} in ${requested} minutes.`,
    body: [
      `Scheduled length is ${formatMinutes(original)}.`,
      kept,
      'The compound work is what drives the adaptation this block is built on, so it is the last thing to go.',
    ],
    actions: [
      { label: `Rebuild at ${requested} min`, action: `shorten:${requested}` },
      { label: 'Start as written', action: 'start-workout' },
    ],
    sources: ['Today’s plan', 'Programme structure'],
  };
}

function nutritionAnswer(context: AiContext): AiAnswer {
  if (!context.macros) {
    return {
      intent: 'post-training-nutrition',
      headline: 'Set your nutrition targets and I can be specific.',
      body: ['Once your height, weight and goal are in, I can give you exact numbers rather than general advice.'],
      actions: [{ label: 'Set up nutrition', action: 'open-nutrition' }],
      sources: [],
    };
  }

  const perMeal = Math.round(context.macros.proteinGrams / 4);
  return {
    intent: 'post-training-nutrition',
    headline: `Aim for ${perMeal}g protein and a real carbohydrate source.`,
    body: [
      `Your daily targets are ${context.macros.calories} kcal, ${context.macros.proteinGrams}g protein, ${context.macros.carbGrams}g carbs and ${context.macros.fatGrams}g fat.`,
      `Post-training, ${perMeal}g of protein plus 40–60g of carbohydrate covers what the session used and starts recovery.`,
      'Timing matters far less than hitting the daily total — eat when it fits your day.',
    ],
    actions: [
      { label: 'See recovery meals', action: 'open-nutrition' },
      { label: 'Log a meal', action: 'log-meal' },
    ],
    sources: ['Your macro targets', 'Today’s training load'],
  };
}

function progressAnswer(context: AiContext): AiAnswer {
  const body: string[] = [];
  const sources: string[] = [];

  if (context.programName && context.weekNumber && context.totalWeeks) {
    sources.push('Your roadmap');
    body.push(`You are in week ${context.weekNumber} of ${context.totalWeeks} on ${context.programName}.`);
  }
  if (context.weeklyTarget > 0) {
    sources.push('Weekly adherence');
    body.push(`This week: ${context.weeklyCompleted} of ${context.weeklyTarget} sessions completed.`);
  }
  if (context.currentStreakDays > 0) {
    sources.push('Training streak');
    body.push(`Current streak is ${context.currentStreakDays} days. Consistency is the variable that predicts everything else.`);
  }
  body.push('Your Progress page has the strength, volume and consistency series behind these numbers.');

  return {
    intent: 'progress-check',
    headline: 'Here is where you actually are.',
    body,
    actions: [{ label: 'Open Progress', action: 'open-progress' }],
    sources,
  };
}

function unknownAnswer(context: AiContext): AiAnswer {
  return {
    intent: 'unknown',
    headline: 'I am not sure I can answer that one well.',
    body: [
      'I work from your plan, your training history, your readiness and your nutrition targets. Ask me about any of those and I can be specific.',
      context.hasHumanCoach
        ? 'For anything outside that, your coach is the better answer — they have the context I do not.'
        : 'For anything outside that, a human coach is the better answer. FORGE COACH matches you with one.',
    ],
    actions: context.hasHumanCoach
      ? [{ label: 'Message my coach', action: 'open-coach-chat' }]
      : [{ label: 'Find a coach', action: 'open-coaching' }],
    sources: [],
  };
}

function findMentionedExercise(question: string): { id: string; name: string; pattern: string } | null {
  const text = question.toLowerCase();
  const candidates = [
    'barbell-back-squat', 'barbell-front-squat', 'goblet-squat', 'bodyweight-squat',
    'conventional-deadlift', 'romanian-deadlift', 'barbell-bench-press', 'dumbbell-bench-press',
    'push-up', 'overhead-press', 'pull-up', 'barbell-row', 'dumbbell-row', 'walking-lunge',
    'kettlebell-swing', 'hip-thrust', 'plank',
  ];

  // Longest match first, so "barbell back squat" does not resolve to "squat".
  const matches = candidates
    .map((id) => ({ id, exercise: findExercise(id) }))
    .filter((entry): entry is { id: string; exercise: NonNullable<ReturnType<typeof findExercise>> } => entry.exercise !== undefined)
    .filter((entry) => text.includes(entry.exercise.name.toLowerCase()))
    .sort((a, b) => b.exercise.name.length - a.exercise.name.length);

  const best = matches[0];
  if (best) return { id: best.id, name: best.exercise.name, pattern: best.exercise.pattern };

  // Fall back to the bare movement word — "can I replace squats?"
  const bare: Record<string, string> = {
    squat: 'barbell-back-squat',
    deadlift: 'conventional-deadlift',
    bench: 'barbell-bench-press',
    'pull-up': 'pull-up',
    pullup: 'pull-up',
    row: 'barbell-row',
    lunge: 'walking-lunge',
    press: 'overhead-press',
    plank: 'plank',
  };
  for (const [word, id] of Object.entries(bare)) {
    if (text.includes(word)) {
      const exercise = findExercise(id);
      if (exercise) return { id, name: exercise.name, pattern: exercise.pattern };
    }
  }
  return null;
}

function extractMinutes(question: string): number | null {
  const match = /(\d{1,3})\s*(minutes|minute|mins|min)\b/i.exec(question);
  if (match?.[1]) return Number(match[1]);
  const hour = /(\d)\s*(hours|hour|hr)\b/i.exec(question);
  if (hour?.[1]) return Number(hour[1]) * 60;
  return null;
}

/** Rendered under every AI answer that touched a load figure. */
export function formatLoadForMember(grams: number, system: UnitSystem): string {
  return formatLoad(grams, system);
}

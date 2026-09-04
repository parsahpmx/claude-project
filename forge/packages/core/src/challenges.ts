import { clamp, percent } from './units.js';

/**
 * Challenges.
 *
 * Every challenge in FORGE measures an action the member controls — sessions
 * completed, steps taken, minutes moved — never an outcome like weight lost.
 * A leaderboard ranked on weight loss rewards dehydration and punishes muscle
 * gain, which is a product actively working against its own members. The
 * metric union below is the enforcement point: there is no way to express a
 * weight-loss challenge in this system.
 */

export const CHALLENGE_METRICS = [
  'sessions-completed',
  'steps',
  'active-minutes',
  'distance-metres',
  'mobility-sessions',
  'streak-days',
] as const;
export type ChallengeMetric = (typeof CHALLENGE_METRICS)[number];

export const CHALLENGE_METRIC_LABELS: Record<ChallengeMetric, string> = {
  'sessions-completed': 'Sessions completed',
  steps: 'Steps',
  'active-minutes': 'Active minutes',
  'distance-metres': 'Distance',
  'mobility-sessions': 'Mobility sessions',
  'streak-days': 'Streak days',
};

export interface ChallengeDefinition {
  slug: string;
  name: string;
  tagline: string;
  metric: ChallengeMetric;
  target: number;
  durationDays: number;
  badge: string;
  rules: string[];
}

export interface ChallengeEntry {
  userId: string;
  displayName: string;
  value: number;
  /** Members can opt out of the public board while still taking part. */
  visible: boolean;
  isFriend?: boolean;
}

export interface LeaderboardRow {
  rank: number;
  userId: string;
  displayName: string;
  value: number;
  progressPercent: number;
  completed: boolean;
  isFriend: boolean;
}

/**
 * Rank a challenge board.
 *
 * Ties share a rank ("two members in second place"), and the next rank skips
 * accordingly. Breaking ties arbitrarily on user id would mean a member's
 * position changes when somebody else joins, which reads as a bug.
 */
export function buildLeaderboard(
  definition: ChallengeDefinition,
  entries: readonly ChallengeEntry[],
): LeaderboardRow[] {
  const sorted = [...entries]
    .filter((e) => e.visible)
    .sort((a, b) => b.value - a.value || a.displayName.localeCompare(b.displayName));

  const rows: LeaderboardRow[] = [];
  let lastValue: number | null = null;
  let lastRank = 0;

  sorted.forEach((entry, index) => {
    const rank = lastValue !== null && entry.value === lastValue ? lastRank : index + 1;
    lastValue = entry.value;
    lastRank = rank;
    rows.push({
      rank,
      userId: entry.userId,
      displayName: entry.displayName,
      value: entry.value,
      progressPercent: percent(entry.value, definition.target),
      completed: entry.value >= definition.target,
      isFriend: entry.isFriend === true,
    });
  });

  return rows;
}

export interface ChallengeProgress {
  value: number;
  target: number;
  percent: number;
  remaining: number;
  daysRemaining: number;
  /** Daily rate needed from here to finish on time. */
  requiredDailyRate: number;
  onTrack: boolean;
  message: string;
}

export function challengeProgress(
  definition: ChallengeDefinition,
  value: number,
  daysElapsed: number,
): ChallengeProgress {
  const daysRemaining = Math.max(0, definition.durationDays - daysElapsed);
  const remaining = Math.max(0, definition.target - value);
  const requiredDailyRate = daysRemaining > 0 ? Math.ceil(remaining / daysRemaining) : remaining;
  const expected = (definition.target / definition.durationDays) * clamp(daysElapsed, 0, definition.durationDays);
  const onTrack = value >= expected * 0.95;

  let message: string;
  if (remaining === 0) {
    message = `Challenge complete — ${definition.badge} earned.`;
  } else if (daysRemaining === 0) {
    message = `Finished at ${percent(value, definition.target)}% of target. That still counts.`;
  } else if (onTrack) {
    message = `On track. ${requiredDailyRate.toLocaleString()} ${CHALLENGE_METRIC_LABELS[definition.metric].toLowerCase()} a day gets you there.`;
  } else {
    message = `Behind pace. ${requiredDailyRate.toLocaleString()} a day over the last ${daysRemaining} days closes the gap.`;
  }

  return {
    value,
    target: definition.target,
    percent: percent(value, definition.target),
    remaining,
    daysRemaining,
    requiredDailyRate,
    onTrack,
    message,
  };
}

export const CHALLENGES: ChallengeDefinition[] = [
  {
    slug: '30-day-consistency',
    name: '30-Day Consistency',
    tagline: 'Twenty sessions in thirty days. Nothing else counts.',
    metric: 'sessions-completed',
    target: 20,
    durationDays: 30,
    badge: 'Consistency 30',
    rules: [
      'Any FORGE session of 15 minutes or longer counts once per day',
      'Rest days are expected — the target assumes them',
      'Progress syncs automatically when you complete a session',
    ],
  },
  {
    slug: '100k-steps-week',
    name: '100K Steps Week',
    tagline: 'One hundred thousand steps in seven days.',
    metric: 'steps',
    target: 100_000,
    durationDays: 7,
    badge: '100K Week',
    rules: [
      'Steps sync from your connected wearable or phone',
      'Manual entry is capped at 25,000 a day',
      'The board updates every fifteen minutes',
    ],
  },
  {
    slug: 'strength-month',
    name: 'Strength Month',
    tagline: 'Sixteen strength sessions in thirty days.',
    metric: 'sessions-completed',
    target: 16,
    durationDays: 30,
    badge: 'Strength Month',
    rules: [
      'Only sessions tagged strength count towards the target',
      'A session must have at least one logged working set',
      'Deload weeks still count — the plan knows what it is doing',
    ],
  },
  {
    slug: '5k-improvement',
    name: '5K Improvement',
    tagline: 'Six weeks of structured running, one measured result.',
    metric: 'distance-metres',
    target: 60_000,
    durationDays: 42,
    badge: '5K Builder',
    rules: [
      'Log 60 km of running across six weeks',
      'Time trials at week 1 and week 6 are part of the challenge',
      'Improvement is measured against your own week-1 time, not other members',
    ],
  },
  {
    slug: 'mobility-challenge',
    name: 'Mobility Challenge',
    tagline: 'Twenty-one mobility sessions in twenty-eight days.',
    metric: 'mobility-sessions',
    target: 21,
    durationDays: 28,
    badge: 'Mobility 21',
    rules: [
      'Any mobility or recovery session of 10 minutes or more counts',
      'One session per day counts towards the target',
      'Retest your baseline range at the end',
    ],
  },
];

export function findChallenge(slug: string): ChallengeDefinition | undefined {
  return CHALLENGES.find((c) => c.slug === slug);
}

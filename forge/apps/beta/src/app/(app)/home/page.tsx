import Link from 'next/link';
import { loadBalance, loadBand, consistency } from '@forge/contracts';
import { Card, Badge, Metric, EmptyState, ButtonLink } from '@/components/ui/primitives';
import { ActivityCard } from '@/components/app/activity-card';
import {
  getMyActivities,
  getActiveGoals,
  getUpcomingPlanDays,
  getSessionProfile,
} from '@/lib/queries';
import {
  formatDistance,
  formatDuration,
  isoDate,
  addDays,
  startOfWeek,
  SPORT_LABEL,
} from '@/lib/format';

export const metadata = { title: 'Home' };
export const dynamic = 'force-dynamic';

/**
 * Home answers, in order: what should I do today, am I making progress, what
 * did I just do, and what is worth doing next. Anything that does not answer
 * one of those is not on this page.
 */
export default async function HomePage() {
  const today = isoDate(new Date());
  const weekStart = startOfWeek(today);
  const weekEnd = addDays(weekStart, 6);

  const [profile, planDays, activities, goals] = await Promise.all([
    getSessionProfile(),
    getUpcomingPlanDays(weekStart, weekEnd),
    getMyActivities(8),
    getActiveGoals(),
  ]);

  const units = profile?.units ?? 'metric';
  const todaySession = planDays.find((d) => d.date === today && d.status !== 'rest');
  const weekConsistency = consistency(planDays, today);

  // Load over the last 28 days, bucketed by day, for the balance figure.
  const dailyLoads = buildDailyLoads(
    activities.map((a) => ({
      date: a.startedAt.slice(0, 10),
      load: a.trainingLoad ?? Math.round((a.movingS / 60) * 5),
    })),
    today,
    28,
  );
  const balance = loadBalance(dailyLoads);
  const band = loadBand(balance);

  const weekActivities = activities.filter((a) => a.startedAt.slice(0, 10) >= weekStart);
  const weekMinutes = Math.round(weekActivities.reduce((n, a) => n + a.movingS, 0) / 60);
  const weekDistance = weekActivities.reduce((n, a) => n + a.distanceM, 0);

  return (
    <div className="space-y-10">
      <header>
        <p className="eyebrow">
          {greeting()} · {formatWeekday(today)}
        </p>
        <h1 className="mt-2 text-page-title font-display text-bone-100">
          {profile?.displayName || 'Athlete'}
        </h1>
      </header>

      {/* TODAY */}
      <section aria-labelledby="today-heading">
        <h2 id="today-heading" className="eyebrow mb-4">
          Today
        </h2>
        {todaySession ? (
          <Card className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2.5">
                <Badge tone="accent">
                  {todaySession.sport ? SPORT_LABEL[todaySession.sport] : 'Session'}
                </Badge>
                {todaySession.phase && <Badge>{todaySession.phase}</Badge>}
                {todaySession.status === 'completed' && <Badge tone="good">✓ Done</Badge>}
              </div>
              <p className="mt-3 text-section text-bone-100">
                {todaySession.title || 'Scheduled session'}
              </p>
              <p className="mt-1.5 text-secondary muted">
                Week {todaySession.weekIndex + 1} of your plan
              </p>
            </div>
            {todaySession.status !== 'completed' && (
              <ButtonLink href={`/training?day=${todaySession.id}`} size="lg">
                Start session
              </ButtonLink>
            )}
          </Card>
        ) : (
          <EmptyState
            title="Nothing scheduled today"
            body="Rest is part of the plan. If you want to move anyway, record an activity and it will still count toward your week."
            action={
              <ButtonLink href="/activities/new" variant="secondary">
                Record an activity
              </ButtonLink>
            }
          />
        )}
      </section>

      {/* THIS WEEK */}
      <section aria-labelledby="week-heading">
        <div className="mb-4 flex items-baseline justify-between gap-4">
          <h2 id="week-heading" className="eyebrow">
            This week
          </h2>
          <Link
            href="/progress"
            className="text-secondary font-semibold text-signal hover:underline underline-offset-4"
          >
            Progress →
          </Link>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Card>
            <Metric label="Sessions" value={weekActivities.length} />
          </Card>
          <Card>
            <Metric label="Training time" value={formatDuration(weekMinutes * 60)} />
          </Card>
          <Card>
            <Metric label="Distance" value={formatDistance(weekDistance, units)} />
          </Card>
          <Card>
            <Metric
              label="Load balance"
              value={balance === null ? '—' : balance.toFixed(2)}
              hint={
                band === null
                  ? 'Needs two weeks of history'
                  : {
                      detraining: 'Below your recent norm',
                      steady: 'In line with recent weeks',
                      building: 'Building, sensibly',
                      spike: 'A sharp jump — ease off',
                    }[band]
              }
            />
          </Card>
        </div>
        {weekConsistency !== null && (
          <p className="mt-4 text-secondary muted">
            You have completed{' '}
            <span className="font-semibold text-bone-100">{weekConsistency}%</span> of the sessions
            scheduled so far this week.
          </p>
        )}
      </section>

      {/* RECENT */}
      <section aria-labelledby="recent-heading">
        <div className="mb-4 flex items-baseline justify-between gap-4">
          <h2 id="recent-heading" className="eyebrow">
            Recent activity
          </h2>
          <Link
            href="/activities"
            className="text-secondary font-semibold text-signal hover:underline underline-offset-4"
          >
            All activities →
          </Link>
        </div>
        {activities.length === 0 ? (
          <EmptyState
            title="No activities yet"
            body="Record your first session and it will show up here with its splits, map and personal records."
            action={<ButtonLink href="/activities/new">Record an activity</ButtonLink>}
          />
        ) : (
          <ul className="grid gap-4 lg:grid-cols-2">
            {activities.slice(0, 4).map((activity) => (
              <ActivityCard key={activity.id} activity={activity} units={units} />
            ))}
          </ul>
        )}
      </section>

      {/* GOALS */}
      {goals.length > 0 && (
        <section aria-labelledby="goals-heading">
          <div className="mb-4 flex items-baseline justify-between gap-4">
            <h2 id="goals-heading" className="eyebrow">
              Goals
            </h2>
            <Link
              href="/goals"
              className="text-secondary font-semibold text-signal hover:underline underline-offset-4"
            >
              Manage →
            </Link>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {goals.slice(0, 3).map((goal) => (
              <Card key={goal.id}>
                <p className="text-card-title text-bone-100">{goalLabel(goal.kind)}</p>
                <p className="mt-2 text-metric-l tabular-nums text-bone-100">
                  {goal.target}
                  <span className="ml-1 text-secondary font-normal muted">{goal.unit}</span>
                </p>
              </Card>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function buildDailyLoads(
  entries: readonly { date: string; load: number }[],
  today: string,
  days: number,
): number[] {
  const buckets = new Map<string, number>();
  for (let i = days - 1; i >= 0; i -= 1) buckets.set(addDays(today, -i), 0);
  for (const entry of entries) {
    if (buckets.has(entry.date)) {
      buckets.set(entry.date, (buckets.get(entry.date) ?? 0) + entry.load);
    }
  }
  return [...buckets.values()];
}

function greeting(): string {
  const h = new Date().getUTCHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

function formatWeekday(iso: string): string {
  const names = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return names[new Date(`${iso}T00:00:00.000Z`).getUTCDay()] ?? '';
}

function goalLabel(kind: string): string {
  return (
    {
      weekly_sessions: 'Sessions each week',
      weekly_minutes: 'Minutes each week',
      weekly_distance: 'Distance each week',
      strength_sessions: 'Strength sessions',
      program_completion: 'Finish the programme',
      race: 'Race goal',
    }[kind] ?? kind
  );
}

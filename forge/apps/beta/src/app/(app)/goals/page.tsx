import { Card, EmptyState, Badge } from '@/components/ui/primitives';
import { getActiveGoals, getMyActivities, getSessionProfile } from '@/lib/queries';
import { formatGoalValue, GOAL_LABEL, isoDate, startOfWeek } from '@/lib/format';
import { DISTANCE_SPORTS } from '@forge/contracts';

export const metadata = { title: 'Goals' };
export const dynamic = 'force-dynamic';

/**
 * Goals, measured against what actually happened this week rather than against
 * a stored counter — a counter drifts the first time an activity is edited or
 * deleted, and then quietly lies forever.
 */
export default async function GoalsPage() {
  const [profile, goals, activities] = await Promise.all([
    getSessionProfile(),
    getActiveGoals(),
    getMyActivities(50),
  ]);

  const units = profile?.units ?? 'metric';
  const weekStart = startOfWeek(isoDate(new Date()));
  const thisWeek = activities.filter((a) => a.startedAt.slice(0, 10) >= weekStart);

  const progressFor = (kind: string, sport: string | null): number => {
    const scoped = sport ? thisWeek.filter((a) => a.sport === sport) : thisWeek;
    switch (kind) {
      case 'weekly_sessions':
        return scoped.length;
      case 'strength_sessions':
        return thisWeek.filter((a) => a.sport === 'strength' || a.sport === 'functional').length;
      case 'weekly_minutes':
        return Math.round(scoped.reduce((n, a) => n + a.movingS, 0) / 60);
      case 'weekly_distance':
        return scoped
          .filter((a) => DISTANCE_SPORTS.includes(a.sport))
          .reduce((n, a) => n + a.distanceM, 0);
      default:
        return 0;
    }
  };

  return (
    <div className="space-y-7">
      <header>
        <h1 className="text-page-title font-display text-bone-100">Goals</h1>
        <p className="mt-2 text-secondary muted">
          Measured against what you actually recorded this week.
        </p>
      </header>

      {goals.length === 0 ? (
        <EmptyState
          title="No goals set"
          body="A goal gives the week a shape. Set one for sessions, time or distance and Home will track it."
        />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {goals.map((goal) => {
            const done = progressFor(goal.kind, goal.sport);
            const pct = Math.min(100, Math.round((done / goal.target) * 100));
            const met = done >= goal.target;
            return (
              <li key={goal.id}>
                <Card>
                  <div className="flex items-start justify-between gap-3">
                    <h2 className="text-card-title text-bone-100">
                      {GOAL_LABEL[goal.kind] ?? goal.kind}
                    </h2>
                    {met ? <Badge tone="good">✓ Met</Badge> : <Badge>{pct}%</Badge>}
                  </div>

                  <p className="mt-4 text-metric-l tabular-nums text-bone-100">
                    {formatGoalValue(goal.kind, done, units)}
                    <span className="ml-1.5 text-secondary font-normal muted">
                      of {formatGoalValue(goal.kind, goal.target, units)}
                    </span>
                  </p>

                  {/* Progress carries a number as well as a bar, so it is never
                      length-and-colour alone. */}
                  <div
                    role="progressbar"
                    aria-valuenow={pct}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={`${GOAL_LABEL[goal.kind] ?? goal.kind}: ${pct}% complete`}
                    className="mt-4 h-1.5 overflow-hidden rounded-pill bg-ink-700"
                  >
                    <div
                      className="h-full rounded-pill bg-signal transition-[width] duration-500 ease-forge"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

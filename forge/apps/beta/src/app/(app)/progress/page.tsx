import { loadBalance, loadBand, DISTANCE_SPORTS } from '@forge/contracts';
import { Card, Metric, EmptyState, ButtonLink } from '@/components/ui/primitives';
import { WeeklyVolumeChart } from '@/components/app/charts';
import { getMyActivities, getSessionProfile } from '@/lib/queries';
import { createClient } from '@/lib/supabase/server';
import {
  formatDistance,
  formatDuration,
  formatLoadG,
  isoDate,
  addDays,
  startOfWeek,
} from '@/lib/format';

export const metadata = { title: 'Progress' };
export const dynamic = 'force-dynamic';

/**
 * Progress.
 *
 * Every figure here is one FORGE defines and can explain — see the metrics
 * module in @forge/contracts. Nothing borrows a proprietary formula, and
 * anything that needs more history than exists says so instead of showing a
 * confident zero.
 */
export default async function ProgressPage() {
  const supabase = await createClient();
  const [profile, activities] = await Promise.all([getSessionProfile(), getMyActivities(50)]);

  const { data: prRows } = await supabase
    .from('exercise_prs')
    .select('exercise_slug, best_1rm_g, best_volume_g, best_reps, achieved_at')
    .order('best_1rm_g', { ascending: false })
    .limit(8);

  const units = profile?.units ?? 'metric';
  const today = isoDate(new Date());

  const dailyLoads = buildDaily(activities, today, 28);
  const balance = loadBalance(dailyLoads);
  const band = loadBand(balance);

  const weeks = buildWeeks(activities, today, 8);
  const totalSessions = activities.length;
  const totalMinutes = Math.round(activities.reduce((n, a) => n + a.movingS, 0) / 60);
  const totalDistance = activities
    .filter((a) => DISTANCE_SPORTS.includes(a.sport))
    .reduce((n, a) => n + a.distanceM, 0);

  if (activities.length === 0) {
    return (
      <div className="space-y-7">
        <h1 className="text-page-title font-display text-bone-100">Progress</h1>
        <EmptyState
          title="Nothing to chart yet"
          body="Record a few sessions and this page will show your load, your consistency and your records."
          action={<ButtonLink href="/activities/new">Record an activity</ButtonLink>}
        />
      </div>
    );
  }

  return (
    <div className="space-y-10">
      <header>
        <h1 className="text-page-title font-display text-bone-100">Progress</h1>
        <p className="mt-2 text-secondary muted">Your last {activities.length} sessions.</p>
      </header>

      <section aria-labelledby="overview-heading">
        <h2 id="overview-heading" className="eyebrow mb-4">
          Overview
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Card>
            <Metric label="Sessions" value={totalSessions} size="xl" />
          </Card>
          <Card>
            <Metric label="Training time" value={formatDuration(totalMinutes * 60)} size="xl" />
          </Card>
          <Card>
            <Metric label="Distance" value={formatDistance(totalDistance, units)} size="xl" />
          </Card>
          <Card>
            <Metric
              label="Load balance"
              size="xl"
              value={balance === null ? '—' : balance.toFixed(2)}
              hint={band === null ? 'Needs two weeks of history' : LOAD_COPY[band]}
            />
          </Card>
        </div>
      </section>

      <section aria-labelledby="volume-heading">
        <h2 id="volume-heading" className="eyebrow mb-4">
          Weekly training time
        </h2>
        <Card>
          <WeeklyVolumeChart weeks={weeks} />
        </Card>
      </section>

      <section aria-labelledby="records-heading">
        <h2 id="records-heading" className="eyebrow mb-4">
          Strength records
        </h2>
        {!prRows || prRows.length === 0 ? (
          <EmptyState
            title="No records yet"
            body="Log a strength session with sets, reps and load, and your best estimated one-rep max for each lift shows up here."
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {prRows.map((pr) => (
              <Card key={pr.exercise_slug}>
                <p className="text-card-title capitalize text-bone-100">
                  {pr.exercise_slug.replace(/-/g, ' ')}
                </p>
                <p className="mt-3 text-metric-l tabular-nums text-bone-100">
                  {formatLoadG(pr.best_1rm_g, units)}
                </p>
                <p className="mt-1.5 text-caption muted">
                  Estimated 1RM · best set {pr.best_reps} reps
                </p>
              </Card>
            ))}
          </div>
        )}
      </section>

      <section aria-labelledby="method-heading">
        <h2 id="method-heading" className="eyebrow mb-4">
          How these are worked out
        </h2>
        <Card>
          <dl className="space-y-4 text-secondary">
            <div>
              <dt className="font-semibold text-bone-100">Load balance</dt>
              <dd className="mt-1 muted">
                The last seven days of training load divided by the average week of the last
                twenty-eight. Around 1.0 means this week looks like your recent weeks. It stays
                blank until there are two weeks to compare.
              </dd>
            </div>
            <div>
              <dt className="font-semibold text-bone-100">Training load</dt>
              <dd className="mt-1 muted">
                Session minutes multiplied by perceived effort. A long easy run and a short hard one
                can land in the same place, which is the point.
              </dd>
            </div>
            <div>
              <dt className="font-semibold text-bone-100">Estimated 1RM</dt>
              <dd className="mt-1 muted">
                Load × (1 + reps ÷ 30), from your heaviest qualifying set. Beyond twelve reps the
                estimate stops meaning much, so FORGE does not show one.
              </dd>
            </div>
          </dl>
        </Card>
      </section>
    </div>
  );
}

const LOAD_COPY = {
  detraining: 'Below your recent norm',
  steady: 'In line with recent weeks',
  building: 'Building, sensibly',
  spike: 'A sharp jump — ease off',
} as const;

function buildDaily(
  activities: readonly { startedAt: string; movingS: number; trainingLoad: number | null }[],
  today: string,
  days: number,
): number[] {
  const buckets = new Map<string, number>();
  for (let i = days - 1; i >= 0; i -= 1) buckets.set(addDays(today, -i), 0);
  for (const a of activities) {
    const date = a.startedAt.slice(0, 10);
    if (buckets.has(date)) {
      buckets.set(
        date,
        (buckets.get(date) ?? 0) + (a.trainingLoad ?? Math.round((a.movingS / 60) * 5)),
      );
    }
  }
  return [...buckets.values()];
}

function buildWeeks(
  activities: readonly { startedAt: string; movingS: number }[],
  today: string,
  count: number,
): { week: string; minutes: number }[] {
  const start = startOfWeek(today);
  const weeks: { week: string; minutes: number }[] = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    const weekStart = addDays(start, -7 * i);
    const weekEnd = addDays(weekStart, 6);
    const minutes = Math.round(
      activities
        .filter((a) => {
          const d = a.startedAt.slice(0, 10);
          return d >= weekStart && d <= weekEnd;
        })
        .reduce((n, a) => n + a.movingS, 0) / 60,
    );
    weeks.push({ week: weekStart, minutes });
  }
  return weeks;
}

import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  decodePolyline,
  pacePerKm,
  effortScore,
  estimateOneRepMax,
  DISTANCE_SPORTS,
} from '@forge/contracts';
import { MapCanvas } from '@/components/map/map-canvas';
import { Badge, Card, Metric } from '@/components/ui/primitives';
import { getActivity, getActivitySplits, getStrengthSets, getSessionProfile } from '@/lib/queries';
import {
  formatDistance,
  formatDuration,
  formatDate,
  formatTime,
  formatPace,
  formatElevation,
  formatLoadG,
  SPORT_LABEL,
} from '@/lib/format';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const activity = await getActivity(id).catch(() => null);
  return { title: activity?.title || 'Activity' };
}

export default async function ActivityDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  // RLS decides this: an activity the viewer may not see comes back null, which
  // is a 404 rather than a 403 — telling someone an id exists but is off limits
  // is itself a disclosure.
  const activity = await getActivity(id);
  if (!activity) notFound();

  const [profile, splits, sets] = await Promise.all([
    getSessionProfile(),
    getActivitySplits(id),
    getStrengthSets(id),
  ]);

  const units = profile?.units ?? 'metric';
  const isDistance = DISTANCE_SPORTS.includes(activity.sport);
  const pace = pacePerKm(activity.distanceM, activity.movingS);
  const effort = effortScore(activity.avgHr, activity.maxHr);
  const points = activity.mapPolyline ? decodePolyline(activity.mapPolyline) : [];

  const byExercise = sets.reduce<Record<string, typeof sets>>((acc, set) => {
    (acc[set.exerciseSlug] ??= []).push(set);
    return acc;
  }, {});

  return (
    <article className="space-y-8">
      <header>
        <div className="flex flex-wrap items-center gap-2.5">
          <Badge tone="accent">{SPORT_LABEL[activity.sport]}</Badge>
          <Badge>
            {activity.visibility === 'private'
              ? 'Only me'
              : activity.visibility === 'followers'
                ? 'Followers'
                : 'Public'}
          </Badge>
        </div>
        <h1 className="mt-4 text-page-title font-display text-bone-100">
          {activity.title || 'Untitled activity'}
        </h1>
        <p className="mt-2 text-secondary muted">
          {activity.athlete.displayName} · {formatDate(activity.startedAt)} at{' '}
          {formatTime(activity.startedAt)}
        </p>
        {activity.description && (
          <p className="mt-4 max-w-prose text-body muted">{activity.description}</p>
        )}
      </header>

      {activity.hasGps && points.length > 1 && (
        <div className="relative h-[320px] overflow-hidden rounded-card border border-ink-600 lg:h-[440px]">
          <MapCanvas
            className="relative h-full w-full"
            routes={[{ id: activity.id, name: activity.title, points, emphasis: true }]}
            ariaLabel={`Route map for ${activity.title}`}
          />
          <p className="pointer-events-none absolute bottom-4 left-4 map-panel px-3 py-2 text-caption muted">
            Start and end trimmed for privacy
          </p>
        </div>
      )}

      {/* Core stats. Only what this activity actually has — a strength session
          has no pace, and inventing one would be worse than omitting it. */}
      <section aria-labelledby="stats-heading">
        <h2 id="stats-heading" className="sr-only">
          Activity statistics
        </h2>
        <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-5">
          {isDistance && (
            <Card>
              <Metric
                label="Distance"
                value={formatDistance(activity.distanceM, units)}
                size="xl"
              />
            </Card>
          )}
          <Card>
            <Metric label="Moving time" value={formatDuration(activity.movingS)} size="xl" />
          </Card>
          {isDistance && pace !== null && (
            <Card>
              <Metric label="Pace" value={formatPace(pace, units)} size="xl" />
            </Card>
          )}
          {activity.elevationGainM > 0 && (
            <Card>
              <Metric
                label="Climbing"
                value={formatElevation(activity.elevationGainM, units)}
                size="xl"
              />
            </Card>
          )}
          {activity.avgHr && (
            <Card>
              <Metric label="Avg heart rate" value={activity.avgHr} unit="bpm" size="xl" />
            </Card>
          )}
          {effort !== null && (
            <Card>
              <Metric
                label="Effort"
                value={`${effort}/10`}
                size="xl"
                hint="From heart rate against your max"
              />
            </Card>
          )}
        </div>
      </section>

      {splits.length > 0 && (
        <section aria-labelledby="splits-heading">
          <h2 id="splits-heading" className="eyebrow mb-4">
            Splits
          </h2>
          <div className="scroll-x rounded-card border border-ink-600">
            <table className="w-full min-w-[420px] border-collapse text-secondary">
              <caption className="sr-only">Per-kilometre splits for this activity</caption>
              <thead>
                <tr className="border-b border-ink-600 text-left">
                  <th scope="col" className="px-4 py-3 eyebrow font-normal">
                    Km
                  </th>
                  <th scope="col" className="px-4 py-3 eyebrow font-normal">
                    Time
                  </th>
                  <th scope="col" className="px-4 py-3 eyebrow font-normal">
                    Pace
                  </th>
                  <th scope="col" className="px-4 py-3 eyebrow font-normal">
                    Climb
                  </th>
                  <th scope="col" className="px-4 py-3 eyebrow font-normal">
                    HR
                  </th>
                </tr>
              </thead>
              <tbody>
                {splits.map((split) => (
                  <tr key={split.idx} className="border-b border-ink-600 last:border-0">
                    <td className="px-4 py-3 tabular-nums text-bone-100">{split.idx}</td>
                    <td className="px-4 py-3 tabular-nums">{formatDuration(split.elapsedS)}</td>
                    <td className="px-4 py-3 tabular-nums">{formatPace(split.elapsedS, units)}</td>
                    <td className="px-4 py-3 tabular-nums">
                      {split.elevationM !== null ? `${Math.round(split.elevationM)} m` : '—'}
                    </td>
                    <td className="px-4 py-3 tabular-nums">{split.avgHr ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {Object.keys(byExercise).length > 0 && (
        <section aria-labelledby="sets-heading">
          <h2 id="sets-heading" className="eyebrow mb-4">
            Sets
          </h2>
          <div className="space-y-4">
            {Object.entries(byExercise).map(([slug, exerciseSets]) => {
              const best = exerciseSets.reduce((top, s) =>
                (estimateOneRepMax(s.loadG, s.reps) ?? 0) >
                (estimateOneRepMax(top.loadG, top.reps) ?? 0)
                  ? s
                  : top,
              );
              const oneRm = estimateOneRepMax(best.loadG, best.reps);
              return (
                <Card key={slug}>
                  <div className="flex flex-wrap items-baseline justify-between gap-3">
                    <h3 className="text-card-title capitalize text-bone-100">
                      {slug.replace(/-/g, ' ')}
                    </h3>
                    {oneRm !== null && (
                      <p className="text-secondary muted">
                        Estimated 1RM{' '}
                        <span className="font-semibold tabular-nums text-bone-100">
                          {formatLoadG(oneRm, units)}
                        </span>
                      </p>
                    )}
                  </div>
                  <ul className="mt-4 flex flex-wrap gap-2">
                    {exerciseSets.map((set) => (
                      <li
                        key={set.id}
                        className="rounded-control border border-ink-600 bg-ink-900 px-3 py-2 text-secondary tabular-nums"
                      >
                        <span className="text-bone-100">{set.reps}</span>
                        <span className="muted"> × </span>
                        <span className="text-bone-100">{formatLoadG(set.loadG, units)}</span>
                        {set.rpe !== null && <span className="muted"> @{set.rpe}</span>}
                      </li>
                    ))}
                  </ul>
                </Card>
              );
            })}
          </div>
        </section>
      )}

      <p className="text-secondary">
        <Link
          href="/activities"
          className="font-semibold text-signal hover:underline underline-offset-4"
        >
          ← All activities
        </Link>
      </p>
    </article>
  );
}

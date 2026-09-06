import { ButtonLink, EmptyState } from '@/components/ui/primitives';
import { ActivityCard } from '@/components/app/activity-card';
import { getMyActivities, getSessionProfile } from '@/lib/queries';

export const metadata = { title: 'Activities' };
export const dynamic = 'force-dynamic';

/**
 * The training log. Cursor-paginated (§22): `before` is the timestamp of the
 * last row on the previous page, so page fifty costs what page one costs.
 */
export default async function ActivitiesPage({
  searchParams,
}: { searchParams: Promise<{ before?: string }> }) {
  const { before } = await searchParams;
  const [profile, activities] = await Promise.all([
    getSessionProfile(),
    getMyActivities(20, before),
  ]);

  const units = profile?.units ?? 'metric';
  const last = activities[activities.length - 1];

  return (
    <div className="space-y-7">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-page-title font-display text-bone-100">Activities</h1>
          <p className="mt-2 text-secondary muted">Everything you have recorded, most recent first.</p>
        </div>
        <ButtonLink href="/activities/new">Record an activity</ButtonLink>
      </header>

      {activities.length === 0 ? (
        <EmptyState
          title={before ? 'Nothing further back' : 'No activities yet'}
          body={before
            ? 'You have reached the end of your history.'
            : 'Record your first session and it will appear here with its splits, map and records.'}
          action={before
            ? <ButtonLink href="/activities" variant="secondary">Back to the start</ButtonLink>
            : <ButtonLink href="/activities/new">Record an activity</ButtonLink>}
        />
      ) : (
        <>
          <ul className="grid gap-4 lg:grid-cols-2">
            {activities.map((activity) => (
              <ActivityCard key={activity.id} activity={activity} units={units} />
            ))}
          </ul>
          {activities.length === 20 && last && (
            <div className="flex justify-center pt-2">
              <ButtonLink href={`/activities?before=${encodeURIComponent(last.startedAt)}`} variant="secondary">
                Load older activities
              </ButtonLink>
            </div>
          )}
        </>
      )}
    </div>
  );
}

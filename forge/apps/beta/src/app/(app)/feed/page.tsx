import { isEnabled, parseDisabledFeatures } from '@forge/contracts';
import { notFound } from 'next/navigation';
import { ButtonLink, EmptyState } from '@/components/ui/primitives';
import { ActivityCard } from '@/components/app/activity-card';
import { getFeed, getSessionProfile } from '@/lib/queries';

export const metadata = { title: 'Feed' };
export const dynamic = 'force-dynamic';

/**
 * The feed is BETA OPTIONAL. When the flag is off the route is absent rather
 * than empty — a page that exists but promises nothing is worse than a 404.
 *
 * Ranking is chronological. No recommendation model in the beta (§23).
 */
export default async function FeedPage({
  searchParams,
}: {
  searchParams: Promise<{ before?: string }>;
}) {
  if (!isEnabled('feed', parseDisabledFeatures(process.env.FORGE_DISABLED_FEATURES))) notFound();

  const { before } = await searchParams;
  const [profile, items] = await Promise.all([getSessionProfile(), getFeed(20, before)]);
  const units = profile?.units ?? 'metric';
  const last = items[items.length - 1];

  return (
    <div className="space-y-7">
      <header>
        <h1 className="text-page-title font-display text-bone-100">Feed</h1>
        <p className="mt-2 text-secondary muted">
          Activities from people you follow, newest first.
        </p>
      </header>

      {items.length === 0 ? (
        <EmptyState
          title="Nothing in your feed yet"
          body="Follow another athlete and their shared activities appear here. Your own training lives on Home."
          action={
            <ButtonLink href="/community" variant="secondary">
              Find athletes
            </ButtonLink>
          }
        />
      ) : (
        <>
          <ul className="mx-auto grid max-w-content gap-4 lg:grid-cols-2">
            {items.map((item) => (
              <ActivityCard key={item.id} activity={item} units={units} athlete={item.athlete} />
            ))}
          </ul>
          {items.length === 20 && last && (
            <div className="flex justify-center pt-2">
              <ButtonLink
                href={`/feed?before=${encodeURIComponent(last.startedAt)}`}
                variant="secondary"
              >
                Load older
              </ButtonLink>
            </div>
          )}
        </>
      )}
    </div>
  );
}

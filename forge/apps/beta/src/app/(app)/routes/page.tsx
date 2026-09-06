import Link from 'next/link';
import { Badge, ButtonLink, EmptyState } from '@/components/ui/primitives';
import { getMyRoutes, getSessionProfile } from '@/lib/queries';
import { formatDistance, formatDuration, formatElevation, SPORT_LABEL } from '@/lib/format';

export const metadata = { title: 'Routes' };
export const dynamic = 'force-dynamic';

export default async function RoutesPage() {
  const [profile, routes] = await Promise.all([getSessionProfile(), getMyRoutes(50)]);
  const units = profile?.units ?? 'metric';

  return (
    <div className="space-y-7">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-page-title font-display text-bone-100">Routes</h1>
          <p className="mt-2 text-secondary muted">
            Routes you have built or saved. Private unless you share one.
          </p>
        </div>
        <ButtonLink href="/routes/new">Build a route</ButtonLink>
      </header>

      {routes.length === 0 ? (
        <EmptyState
          title="No saved routes"
          body="Build a route from a start point and a few waypoints, and FORGE works out the distance, the climbing and roughly how long it will take."
          action={<ButtonLink href="/routes/new">Build a route</ButtonLink>}
        />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {routes.map((route) => (
            <li key={route.id}>
              <Link
                href={`/route/${route.id}`}
                className="block rounded-card border border-ink-600 bg-ink-800 p-5 transition-transform duration-200 ease-forge hover:-translate-y-0.5 hover:shadow-lift"
              >
                <div className="flex items-start justify-between gap-3">
                  <h2 className="text-card-title text-bone-100">{route.name}</h2>
                  <Badge>{SPORT_LABEL[route.sport]}</Badge>
                </div>
                <dl className="mt-4 grid grid-cols-3 gap-3 text-secondary">
                  <div>
                    <dt className="text-caption muted">Distance</dt>
                    <dd className="mt-0.5 tabular-nums text-bone-100">
                      {formatDistance(route.distanceM, units)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-caption muted">Climb</dt>
                    <dd className="mt-0.5 tabular-nums text-bone-100">
                      {formatElevation(route.elevationGainM, units)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-caption muted">Time</dt>
                    <dd className="mt-0.5 tabular-nums text-bone-100">
                      {formatDuration(route.estimatedS)}
                    </dd>
                  </div>
                </dl>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

import Link from 'next/link';
import { decodePolyline } from '@forge/contracts';
import { MapCanvas, type MapRoute } from '@/components/map/map-canvas';
import { Badge, ButtonLink, EmptyState } from '@/components/ui/primitives';
import { getMyRoutes, getMyActivities, getSessionProfile } from '@/lib/queries';
import { formatDistance, formatElevation, SPORT_LABEL } from '@/lib/format';

export const metadata = { title: 'Maps' };
export const dynamic = 'force-dynamic';

/**
 * Maps.
 *
 * This is the one screen where desktop should beat mobile outright, so the map
 * gets the whole viewport and the controls sit over it rather than beside it in
 * a column that steals width. On mobile the panel becomes a sheet under the map.
 *
 * The map shown here is personal: the athlete's own routes and their own
 * recorded activities. There is no community heatmap, and the absence is
 * deliberate — see docs/WEB_MAPS.md.
 */
export default async function MapsPage() {
  const [profile, routes, activities] = await Promise.all([
    getSessionProfile(),
    getMyRoutes(40),
    getMyActivities(40),
  ]);

  const units = profile?.units ?? 'metric';

  // Only activities that actually carry a sanitized line can be drawn.
  const traced = activities.filter((a) => a.hasGps && a.mapPolyline);
  const mapRoutes: MapRoute[] = traced.slice(0, 25).map((a) => ({
    id: a.id,
    name: a.title,
    points: decodePolyline(a.mapPolyline!),
  }));

  return (
    <div className="-mx-[var(--gutter)] -mt-8 md:-mb-12">
      <div className="relative grid lg:grid-cols-[380px_1fr] lg:gap-0">
        {/* Controls. First in the DOM so keyboard and screen-reader users reach
            them before the map, which they cannot operate anyway. */}
        <aside
          aria-label="Map filters and routes"
          className="order-2 border-t border-ink-600 bg-ink-900 px-[var(--gutter)] py-7 lg:order-1 lg:h-[calc(100dvh-4rem)] lg:overflow-y-auto lg:border-r lg:border-t-0 lg:px-6"
        >
          <h1 className="text-page-title font-display text-bone-100">Your map</h1>
          <p className="mt-2 text-secondary muted">
            Routes you have saved and activities you have recorded. Private to you
            unless you share a route deliberately.
          </p>

          <div className="mt-7">
            <h2 className="eyebrow mb-3">Saved routes <span className="muted">{routes.length}</span></h2>
            {routes.length === 0 ? (
              <EmptyState
                title="No saved routes"
                body="Build a route and it will show here, ready to send to your phone before a session."
                action={<ButtonLink href="/routes/new" size="sm" variant="secondary">Build a route</ButtonLink>}
              />
            ) : (
              <ul className="space-y-2.5">
                {routes.map((route) => (
                  <li key={route.id}>
                    <Link
                      href={`/route/${route.id}`}
                      className="block rounded-control border border-ink-600 bg-ink-800 p-4 transition-colors hover:border-smoke-400"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <p className="text-card-title text-bone-100">{route.name}</p>
                        <Badge>{SPORT_LABEL[route.sport]}</Badge>
                      </div>
                      <p className="mt-1.5 text-secondary muted tabular-nums">
                        {formatDistance(route.distanceM, units)} · {formatElevation(route.elevationGainM, units)}
                      </p>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="mt-8">
            <h2 className="eyebrow mb-3">
              Recorded activities <span className="muted">{traced.length} with a trace</span>
            </h2>
            {traced.length === 0 ? (
              <p className="text-secondary muted">
                None of your activities carry a map yet. Activities recorded with GPS
                will appear here once processed.
              </p>
            ) : (
              <ul className="space-y-2">
                {traced.slice(0, 12).map((activity) => (
                  <li key={activity.id}>
                    <Link
                      href={`/activity/${activity.id}`}
                      className="flex items-baseline justify-between gap-3 rounded-control px-3 py-2.5 text-secondary transition-colors hover:bg-ink-800"
                    >
                      <span className="truncate text-bone-200">{activity.title}</span>
                      <span className="shrink-0 tabular-nums muted">
                        {formatDistance(activity.distanceM, units)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>

        {/* The map itself. Uses the screen, per §101. */}
        <div className="relative order-1 h-[52dvh] lg:order-2 lg:h-[calc(100dvh-4rem)]">
          <MapCanvas
            className="relative h-full w-full"
            routes={mapRoutes}
            ariaLabel={`Personal activity map showing ${mapRoutes.length} recorded routes`}
          />
          <div className="pointer-events-none absolute left-4 top-4 map-panel px-4 py-3">
            <p className="text-caption muted">Showing</p>
            <p className="mt-0.5 text-secondary font-semibold text-bone-100 tabular-nums">
              {mapRoutes.length} activit{mapRoutes.length === 1 ? 'y' : 'ies'}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

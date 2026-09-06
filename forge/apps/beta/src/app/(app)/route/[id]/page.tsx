import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Badge, ButtonLink } from '@/components/ui/primitives';
import { MapCanvas } from '@/components/map/map-canvas';
import { RouteSummary } from '@/components/map/route-summary';
import { createClient } from '@/lib/supabase/server';
import { getSessionProfile } from '@/lib/queries';
import { SPORT_LABEL } from '@/lib/format';
import type { LngLat } from '@forge/contracts';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data } = await supabase.from('routes').select('name').eq('id', id).maybeSingle();
  return { title: data?.name ?? 'Route' };
}

export default async function RouteDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  // The geometry comes back as GeoJSON so it can be handed straight to the map
  // without a PostGIS round trip in the browser.
  const { data } = await supabase
    .from('routes')
    .select(
      'id, name, description, sport, distance_m, elevation_gain_m, estimated_s, surface, visibility, path',
    )
    .eq('id', id)
    .maybeSingle();

  if (!data) notFound();

  const profile = await getSessionProfile();
  const units = profile?.units ?? 'metric';
  const points = extractLineString(data.path);

  return (
    <article className="space-y-8">
      <header>
        <div className="flex flex-wrap items-center gap-2.5">
          <Badge tone="accent">{SPORT_LABEL[data.sport] ?? data.sport}</Badge>
          <Badge>
            {data.visibility === 'private'
              ? 'Only me'
              : data.visibility === 'followers'
                ? 'Followers'
                : 'Anyone'}
          </Badge>
        </div>
        <h1 className="mt-4 text-page-title font-display text-bone-100">{data.name}</h1>
        {data.description && <p className="mt-3 max-w-prose text-body muted">{data.description}</p>}
      </header>

      {points.length > 1 && (
        <div className="relative h-[340px] overflow-hidden rounded-card border border-ink-600 lg:h-[460px]">
          <MapCanvas
            className="relative h-full w-full"
            routes={[{ id: data.id, name: data.name, points, emphasis: true }]}
            ariaLabel={`Map of the route ${data.name}`}
          />
        </div>
      )}

      <RouteSummary
        name={data.name}
        distanceM={data.distance_m}
        elevationGainM={data.elevation_gain_m}
        estimatedS={data.estimated_s}
        surface={data.surface}
        units={units}
      />

      <div className="flex flex-wrap gap-3">
        <ButtonLink href="/routes" variant="secondary">
          All routes
        </ButtonLink>
        <ButtonLink href="/maps" variant="ghost">
          Open the map
        </ButtonLink>
      </div>

      <p className="text-secondary">
        <Link href="/maps" className="font-semibold text-signal hover:underline underline-offset-4">
          ← Back to your map
        </Link>
      </p>
    </article>
  );
}

/**
 * PostgREST hands a geography column back as GeoJSON when the column is
 * selected directly. Anything else — a WKB hex string, a null — yields no
 * points rather than a thrown error, so a route with odd geometry still renders
 * its numbers.
 */
function extractLineString(value: unknown): LngLat[] {
  if (!value || typeof value !== 'object') return [];
  const geo = value as { type?: string; coordinates?: unknown };
  if (geo.type !== 'LineString' || !Array.isArray(geo.coordinates)) return [];
  return geo.coordinates
    .filter(
      (p): p is [number, number] =>
        Array.isArray(p) && p.length >= 2 && typeof p[0] === 'number' && typeof p[1] === 'number',
    )
    .map(([lng, lat]) => [lng, lat] as LngLat);
}

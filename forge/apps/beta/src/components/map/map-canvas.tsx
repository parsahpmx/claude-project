'use client';

import { useEffect, useRef, useState } from 'react';
import type { LngLat } from '@forge/contracts';

/**
 * The map surface.
 *
 * MapLibre GL is loaded lazily on first render of a map screen so that Home,
 * Training and Progress never download it (§123). Tiles come from a style URL
 * in the environment; the default is the OpenStreetMap demo style, which is
 * fine for development and explicitly not fine for beta traffic.
 *
 * If the style fails to load — offline, blocked, rate-limited — the component
 * says so and keeps rendering the route summary beside it. A map that silently
 * shows nothing is worse than one that admits it is missing.
 */
export interface MapRoute {
  id: string;
  name: string;
  points: LngLat[];
  emphasis?: boolean;
}

export function MapCanvas({
  routes = [],
  center = [-2.5879, 51.4545],
  zoom = 11,
  className,
  ariaLabel,
}: {
  routes?: MapRoute[];
  center?: LngLat;
  zoom?: number;
  className?: string;
  ariaLabel: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'unavailable'>('loading');

  useEffect(() => {
    let cancelled = false;
    let map: { remove: () => void } | null = null;

    (async () => {
      try {
        const maplibre = await import('maplibre-gl');
        if (cancelled || !container.current) return;

        const styleUrl = process.env.NEXT_PUBLIC_MAP_STYLE_URL;
        if (!styleUrl) {
          setStatus('unavailable');
          return;
        }

        const instance = new maplibre.Map({
          container: container.current,
          style: styleUrl,
          center,
          zoom,
          attributionControl: { compact: true },
        });
        map = instance;

        instance.on('error', () => {
          if (!cancelled) setStatus('unavailable');
        });

        instance.on('load', () => {
          if (cancelled) return;
          setStatus('ready');

          for (const route of routes) {
            if (route.points.length < 2) continue;
            instance.addSource(`route-${route.id}`, {
              type: 'geojson',
              data: {
                type: 'Feature',
                properties: {},
                geometry: { type: 'LineString', coordinates: route.points },
              },
            });
            // Casing under the line, so it stays visible over light and dark
            // terrain alike rather than only over one of them.
            instance.addLayer({
              id: `route-${route.id}-casing`,
              type: 'line',
              source: `route-${route.id}`,
              paint: {
                'line-color': '#0B0B0C',
                'line-width': route.emphasis ? 8 : 6,
                'line-opacity': 0.55,
              },
              layout: { 'line-cap': 'round', 'line-join': 'round' },
            });
            instance.addLayer({
              id: `route-${route.id}-line`,
              type: 'line',
              source: `route-${route.id}`,
              paint: {
                'line-color': '#B8E62E',
                'line-width': route.emphasis ? 4 : 3,
              },
              layout: { 'line-cap': 'round', 'line-join': 'round' },
            });
          }

          if (routes.length > 0) {
            const all = routes.flatMap((r) => r.points);
            if (all.length > 1) {
              const lngs = all.map((p) => p[0]);
              const lats = all.map((p) => p[1]);
              instance.fitBounds(
                [
                  [Math.min(...lngs), Math.min(...lats)],
                  [Math.max(...lngs), Math.max(...lats)],
                ],
                { padding: 48, duration: 0 },
              );
            }
          }
        });
      } catch {
        if (!cancelled) setStatus('unavailable');
      }
    })();

    return () => {
      cancelled = true;
      map?.remove();
    };
    // Routes are fixed for the lifetime of a given map view in the beta.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className={className} role="region" aria-label={ariaLabel}>
      <div ref={container} className="h-full w-full" />
      {status !== 'ready' && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center bg-ink-800">
          <div className="max-w-xs px-6 text-center">
            {status === 'loading' ? (
              <p className="text-secondary muted">Loading map…</p>
            ) : (
              <>
                <p className="text-card-title text-bone-100">Map unavailable</p>
                <p className="mt-2 text-secondary muted">
                  Tiles could not be loaded. Route distance, elevation and splits are all still
                  shown below.
                </p>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

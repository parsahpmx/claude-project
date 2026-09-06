import type { LngLat } from '@forge/contracts';
import { pathLengthM } from '@forge/contracts';
import { formatDistance, formatDuration, formatElevation } from '@/lib/format';

/**
 * The text a map cannot give a screen reader (§82).
 *
 * Core route facts must never be map-only. This renders the same information as
 * prose and a definition list, so the route is fully usable without ever seeing
 * the tiles — which also covers the case where tiles fail to load.
 */
export function RouteSummary({
  name,
  points,
  distanceM,
  elevationGainM,
  estimatedS,
  surface,
  units = 'metric',
}: {
  name: string;
  points?: LngLat[];
  distanceM?: number;
  elevationGainM?: number;
  estimatedS?: number;
  surface?: string;
  units?: 'metric' | 'imperial';
}) {
  const distance = distanceM ?? (points ? Math.round(pathLengthM(points)) : 0);

  return (
    <div>
      <p className="sr-only">
        {name}. {formatDistance(distance, units)}
        {elevationGainM !== undefined
          ? `, ${formatElevation(elevationGainM, units)} of climbing`
          : ''}
        {estimatedS ? `, about ${formatDuration(estimatedS)}` : ''}
        {surface && surface !== 'unknown' ? `, ${surface} surface` : ''}.
      </p>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
        <div>
          <dt className="eyebrow">Distance</dt>
          <dd className="mt-1.5 text-metric-l tabular-nums text-bone-100">
            {formatDistance(distance, units)}
          </dd>
        </div>
        {elevationGainM !== undefined && (
          <div>
            <dt className="eyebrow">Climbing</dt>
            <dd className="mt-1.5 text-metric-l tabular-nums text-bone-100">
              {formatElevation(elevationGainM, units)}
            </dd>
          </div>
        )}
        {estimatedS !== undefined && estimatedS > 0 && (
          <div>
            <dt className="eyebrow">Estimated</dt>
            <dd className="mt-1.5 text-metric-l tabular-nums text-bone-100">
              {formatDuration(estimatedS)}
            </dd>
          </div>
        )}
        {surface && surface !== 'unknown' && (
          <div>
            <dt className="eyebrow">Surface</dt>
            <dd className="mt-1.5 text-metric-l capitalize text-bone-100">{surface}</dd>
          </div>
        )}
      </dl>
    </div>
  );
}

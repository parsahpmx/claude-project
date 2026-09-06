import Link from 'next/link';
import type { Activity } from '@forge/contracts';
import { pacePerKm } from '@forge/contracts';
import { Badge } from '@/components/ui/primitives';
import { RouteGlyph } from '@/components/marketing/route-glyph';
import {
  formatDistance,
  formatDuration,
  formatDate,
  formatPace,
  formatElevation,
  SPORT_LABEL,
  SPORT_GLYPH,
} from '@/lib/format';
import { DISTANCE_SPORTS } from '@forge/contracts';

/**
 * A feed card. Shows what the activity was and how it went, and nothing that
 * needs a second query — splits, streams and the track all load on the detail
 * page instead (§26).
 */
export function ActivityCard({
  activity,
  units = 'metric',
  athlete,
}: {
  activity: Activity;
  units?: 'metric' | 'imperial';
  athlete?: { displayName: string; username: string | null };
}) {
  const isDistance = DISTANCE_SPORTS.includes(activity.sport);
  const pace = isDistance ? pacePerKm(activity.distanceM, activity.movingS) : null;

  return (
    <li className="card overflow-hidden transition-transform duration-200 ease-forge hover:-translate-y-0.5 hover:shadow-lift">
      <Link href={`/activity/${activity.id}`} className="block">
        <div className="flex items-start justify-between gap-4 p-5 pb-4">
          <div className="min-w-0">
            {athlete && <p className="text-secondary muted">{athlete.displayName}</p>}
            <h3 className="mt-0.5 text-card-title text-bone-100">
              {activity.title || 'Untitled activity'}
            </h3>
            <p className="mt-1 text-caption muted">{formatDate(activity.startedAt)}</p>
          </div>
          <Badge>
            <span aria-hidden>{SPORT_GLYPH[activity.sport]}</span>
            {SPORT_LABEL[activity.sport]}
          </Badge>
        </div>

        {activity.hasGps && activity.mapPolyline && (
          <div className="mx-5 mb-4 h-24 overflow-hidden rounded-control border border-ink-600 bg-ink-900 text-signal">
            <RouteGlyph
              seed={activity.id}
              className="h-full w-full"
              strokeWidth={2}
              showMarkers={false}
            />
          </div>
        )}

        <dl className="grid grid-cols-3 gap-px border-t border-ink-600 bg-ink-600">
          {(isDistance
            ? [
                ['Distance', formatDistance(activity.distanceM, units)],
                ['Time', formatDuration(activity.movingS)],
                ['Pace', formatPace(pace, units)],
              ]
            : [
                ['Time', formatDuration(activity.movingS)],
                ['Elevation', formatElevation(activity.elevationGainM, units)],
                ['Effort', activity.avgHr ? `${activity.avgHr} bpm` : '—'],
              ]
          ).map(([label, value]) => (
            <div key={label} className="bg-ink-800 px-4 py-3.5">
              <dt className="text-caption muted">{label}</dt>
              <dd className="mt-1 text-secondary font-semibold tabular-nums text-bone-100">
                {value}
              </dd>
            </div>
          ))}
        </dl>
      </Link>
    </li>
  );
}

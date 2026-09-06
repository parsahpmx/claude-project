import { haversineM } from './geo.js';
import type { LngLat, PrivacySettings, Visibility } from './types.js';

export interface PrivateZone {
  center: LngLat;
  radiusM: number;
}

/**
 * Turn a raw GPS track into the version other people may see.
 *
 * Three rules, applied in order:
 *
 *  1. Trim the start and the end. A track that begins at your front door is a
 *     home address published at five-decimal precision. `hideRadiusM` is how
 *     much of each end to drop.
 *  2. Drop anything inside a private zone, wherever it falls in the track.
 *  3. If what survives is too short to be a route, publish nothing at all —
 *     a two-point stub near home is worse than an activity with no map.
 *
 * The result is what gets encoded into `activities.map_polyline`. The raw track
 * never leaves `activity_tracks`, which no visibility policy can reach.
 */
export function sanitizeTrack(
  points: readonly LngLat[],
  settings: Pick<PrivacySettings, 'hideStartEnd' | 'hideRadiusM'>,
  zones: readonly PrivateZone[] = [],
): LngLat[] {
  if (points.length === 0) return [];

  let working = [...points];

  if (settings.hideStartEnd && settings.hideRadiusM > 0) {
    working = trimEnds(working, settings.hideRadiusM);
  }

  if (zones.length > 0) {
    working = working.filter(
      (p) => !zones.some((z) => haversineM(p, z.center) <= z.radiusM),
    );
  }

  // Fewer than four surviving points is not a shape, it is a location.
  return working.length >= 4 ? working : [];
}

function trimEnds(points: readonly LngLat[], radiusM: number): LngLat[] {
  const start = points[0]!;
  let from = 0;
  while (from < points.length && haversineM(points[from]!, start) <= radiusM) from += 1;

  const end = points[points.length - 1]!;
  let to = points.length - 1;
  while (to > from && haversineM(points[to]!, end) <= radiusM) to -= 1;

  return from >= to ? [] : points.slice(from, to + 1);
}

/**
 * Whether a viewer may see content at a given visibility. This mirrors the
 * `private.can_view` SQL function so the UI can hide what the database would
 * refuse anyway — the database remains the enforcement point, this is only so
 * the interface does not offer an action that is going to fail.
 */
export function canView(input: {
  viewerId: string | null;
  ownerId: string;
  level: Visibility;
  viewerFollowsOwner: boolean;
  eitherHasBlocked: boolean;
  ownerProfileVisibility: Visibility;
}): boolean {
  const { viewerId, ownerId, level, viewerFollowsOwner, eitherHasBlocked, ownerProfileVisibility } = input;
  if (viewerId === ownerId) return true;
  if (viewerId === null) return level === 'public' && ownerProfileVisibility === 'public';
  if (eitherHasBlocked) return false;
  if (level === 'private') return false;
  if (level === 'followers') return viewerFollowsOwner;
  return ownerProfileVisibility !== 'private';
}

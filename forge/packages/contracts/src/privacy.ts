import { haversineM } from './geo';
import type { LngLat, PrivacySettings, Visibility } from './types';

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
    working = working.filter((p) => !zones.some((z) => haversineM(p, z.center) <= z.radiusM));
  }

  // Fewer than four surviving points is not a shape, it is a location.
  return working.length >= 4 ? working : [];
}

/**
 * Remove every point within `radiusM` of where the track started or ended.
 *
 * The obvious implementation — walk in from each end until you leave the
 * radius, then keep the middle — is wrong, and wrong in the common case. It
 * stops at the *first* point outside the radius, so anything that comes back
 * inside afterwards survives. A warm-up loop around the block, an out-and-back
 * that passes the house, or plain GPS noise at the start all put points a few
 * dozen metres from the front door into a published track that claimed to hide
 * a 250 m circle. Measured on a realistic warm-up loop, that leaked a point
 * 80 m from home.
 *
 * So the radius is treated as what it says it is: an exclusion zone, not a
 * head-and-tail trim. Nothing inside it is published, wherever in the track it
 * falls.
 *
 * This can split the track in two, and the renderer will draw a straight line
 * across the gap. That is the same trade the private-zone filter above already
 * makes, and a chord over the missing section reveals far less than the points
 * themselves.
 */
function trimEnds(points: readonly LngLat[], radiusM: number): LngLat[] {
  const start = points[0]!;
  const end = points[points.length - 1]!;

  return points.filter((p) => haversineM(p, start) > radiusM && haversineM(p, end) > radiusM);
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
  const { viewerId, ownerId, level, viewerFollowsOwner, eitherHasBlocked, ownerProfileVisibility } =
    input;
  if (viewerId === ownerId) return true;
  if (viewerId === null) return level === 'public' && ownerProfileVisibility === 'public';
  if (eitherHasBlocked) return false;
  if (level === 'private') return false;
  if (level === 'followers') return viewerFollowsOwner;
  return ownerProfileVisibility !== 'private';
}

import { describe, expect, it } from 'vitest';
import { encodePolyline, decodePolyline, haversineM, pathLengthM, simplify } from './geo';
import { sanitizeTrack, canView } from './privacy';
import {
  loadBalance,
  loadBand,
  consistency,
  effortScore,
  estimateOneRepMax,
  sessionLoad,
  pacePerKm,
} from './metrics';
import { isEnabled, isKnownFeature, parseDisabledFeatures, type FeatureName } from './flags';
import { activityCreateSchema, routeCreateSchema } from './validation';
import type { LngLat } from './types';

/** A straight west-to-east line at ~1.1 m per 1e-5 degree of longitude. */
function line(points: number): LngLat[] {
  return Array.from({ length: points }, (_, i) => [-0.1 + i * 0.0005, 51.5] as LngLat);
}

describe('geo', () => {
  it('round-trips a polyline through encode and decode', () => {
    const points: LngLat[] = [
      [-0.1276, 51.5074],
      [-0.128, 51.508],
      [-0.129, 51.509],
    ];
    const decoded = decodePolyline(encodePolyline(points));
    expect(decoded).toHaveLength(3);
    decoded.forEach((p, i) => {
      expect(p[0]).toBeCloseTo(points[i]![0], 4);
      expect(p[1]).toBeCloseTo(points[i]![1], 4);
    });
  });

  it('measures a known distance', () => {
    // London to Paris, ~344km.
    const d = haversineM([-0.1276, 51.5074], [2.3522, 48.8566]);
    expect(d).toBeGreaterThan(340_000);
    expect(d).toBeLessThan(350_000);
  });

  it('simplifies without moving the endpoints', () => {
    const points = line(200);
    const out = simplify(points, 0.001);
    expect(out.length).toBeLessThan(points.length);
    expect(out[0]).toEqual(points[0]);
    expect(out[out.length - 1]).toEqual(points[points.length - 1]);
  });

  it('reports zero length for a single point', () => {
    expect(pathLengthM([[0, 0]])).toBe(0);
  });
});

describe('privacy: sanitizeTrack', () => {
  const settings = { hideStartEnd: true, hideRadiusM: 250 };

  it('drops the points near the start and the end', () => {
    const points = line(400);
    const out = sanitizeTrack(points, settings);
    expect(out.length).toBeGreaterThan(0);
    expect(out.length).toBeLessThan(points.length);
    // Nothing within the hide radius of either original endpoint survives.
    expect(haversineM(out[0]!, points[0]!)).toBeGreaterThan(settings.hideRadiusM);
    expect(haversineM(out[out.length - 1]!, points[points.length - 1]!)).toBeGreaterThan(
      settings.hideRadiusM,
    );
  });

  /**
   * Regression: the trim used to walk in from each end and stop at the first
   * point outside the radius, so anything that came back inside afterwards was
   * published. A warm-up loop round the block put a point 80 m from the front
   * door into a track that claimed to hide a 250 m circle.
   */
  it('excludes points that re-enter the hidden radius later in the track', () => {
    const home: LngLat = [-2.24, 53.48];
    const north = (m: number): LngLat => [home[0], home[1] + m / 111320];

    const track: LngLat[] = [
      home,
      north(100),
      north(250),
      north(400), // leaves the radius
      north(200),
      north(80), // ...and comes back well inside it
      north(300),
      north(1000),
      north(2000),
      north(3000),
    ];

    const out = sanitizeTrack(track, settings);
    expect(out.length).toBeGreaterThanOrEqual(4);
    for (const p of out) {
      expect(haversineM(p, home)).toBeGreaterThan(settings.hideRadiusM);
    }
  });

  it('hides the finish too when a route ends somewhere else', () => {
    const start: LngLat = [-2.24, 53.48];
    const finish: LngLat = [-2.24, 53.52];
    const between = (m: number): LngLat => [start[0], start[1] + m / 111320];

    // Approaches the finish, drifts away, then returns — the mirror of the
    // warm-up case, at the other end.
    const track: LngLat[] = [
      start,
      between(500),
      between(1500),
      between(3000),
      between(4300), // within 250 m of the finish
      between(3900),
      between(4400),
      finish,
    ];

    const out = sanitizeTrack(track, settings);
    for (const p of out) {
      expect(haversineM(p, start)).toBeGreaterThan(settings.hideRadiusM);
      expect(haversineM(p, finish)).toBeGreaterThan(settings.hideRadiusM);
    }
  });

  it('publishes nothing when trimming leaves too little to be a shape', () => {
    // A short there-and-back entirely inside the hide radius.
    const points = line(5);
    expect(sanitizeTrack(points, settings)).toEqual([]);
  });

  it('removes points inside a private zone wherever they fall', () => {
    const points = line(400);
    const midpoint = points[200]!;
    const out = sanitizeTrack(points, settings, [{ center: midpoint, radiusM: 300 }]);
    for (const p of out) {
      expect(haversineM(p, midpoint)).toBeGreaterThan(300);
    }
  });

  it('leaves the track alone when the member has turned trimming off', () => {
    const points = line(400);
    const out = sanitizeTrack(points, { hideStartEnd: false, hideRadiusM: 250 });
    expect(out).toHaveLength(points.length);
  });

  it('never returns a two-point stub, which would be a location not a route', () => {
    const points: LngLat[] = [
      [0, 0],
      [0.00001, 0],
      [0.00002, 0],
    ];
    expect(sanitizeTrack(points, settings)).toEqual([]);
  });
});

describe('privacy: canView mirrors the SQL policy', () => {
  const base = {
    viewerId: 'viewer',
    ownerId: 'owner',
    viewerFollowsOwner: false,
    eitherHasBlocked: false,
    ownerProfileVisibility: 'public' as const,
  };

  it('always shows an owner their own content', () => {
    expect(canView({ ...base, viewerId: 'owner', level: 'private' })).toBe(true);
  });

  it('hides private content from everyone else', () => {
    expect(canView({ ...base, level: 'private' })).toBe(false);
  });

  it('requires an accepted follow for followers-only content', () => {
    expect(canView({ ...base, level: 'followers' })).toBe(false);
    expect(canView({ ...base, level: 'followers', viewerFollowsOwner: true })).toBe(true);
  });

  it('lets a block override everything short of ownership', () => {
    expect(canView({ ...base, level: 'public', eitherHasBlocked: true })).toBe(false);
    expect(
      canView({ ...base, level: 'followers', viewerFollowsOwner: true, eitherHasBlocked: true }),
    ).toBe(false);
  });

  it('shows anonymous viewers only public content on a public profile', () => {
    expect(canView({ ...base, viewerId: null, level: 'public' })).toBe(true);
    expect(
      canView({ ...base, viewerId: null, level: 'public', ownerProfileVisibility: 'followers' }),
    ).toBe(false);
    expect(canView({ ...base, viewerId: null, level: 'followers' })).toBe(false);
  });
});

describe('metrics', () => {
  it('reports load balance as null until there is enough history', () => {
    expect(loadBalance(Array(13).fill(50))).toBeNull();
    expect(loadBalance(Array(28).fill(50))).toBeCloseTo(1, 1);
  });

  it('bands a spike above a steady week', () => {
    expect(loadBand(1.0)).toBe('steady');
    expect(loadBand(1.6)).toBe('spike');
    expect(loadBand(0.5)).toBe('detraining');
    expect(loadBand(null)).toBeNull();
  });

  it('does not mark a plan down for sessions still in the future', () => {
    const days = [
      { status: 'completed', date: '2026-09-01' },
      { status: 'scheduled', date: '2026-09-30' },
    ];
    expect(consistency(days, '2026-09-06')).toBe(100);
  });

  it('returns null effort without heart rate rather than inventing one', () => {
    expect(effortScore(null, 190)).toBeNull();
    expect(effortScore(150, null)).toBeNull();
    expect(effortScore(150, 190)).toBeGreaterThan(0);
  });

  it('refuses a one-rep-max estimate beyond twelve reps', () => {
    expect(estimateOneRepMax(100_000, 5)).toBeGreaterThan(100_000);
    expect(estimateOneRepMax(100_000, 20)).toBeNull();
  });

  it('computes session load and pace', () => {
    expect(sessionLoad(60, 7)).toBe(420);
    expect(sessionLoad(0, 7)).toBe(0);
    expect(pacePerKm(5000, 1500)).toBe(300);
    expect(pacePerKm(50, 10)).toBeNull();
  });
});

describe('feature flags', () => {
  it('cannot be talked into enabling a post-beta surface', () => {
    expect(isEnabled('globalHeatmap')).toBe(false);
    expect(isEnabled('messaging', [])).toBe(false);
  });

  it('keeps core features on even if an environment tries to disable them', () => {
    expect(isEnabled('activities', ['activities'])).toBe(true);
  });

  it('lets an environment turn optional features off', () => {
    expect(isEnabled('clubs')).toBe(true);
    expect(isEnabled('clubs', ['clubs'])).toBe(false);
  });

  it('parses the environment variable', () => {
    expect(parseDisabledFeatures('clubs, events')).toEqual(['clubs', 'events']);
    expect(parseDisabledFeatures(undefined)).toEqual([]);
  });
});

describe('validation', () => {
  const valid = {
    sport: 'run',
    title: 'Morning run',
    startedAt: '2026-09-06T07:00:00.000Z',
    elapsedS: 3600,
    movingS: 3500,
    distanceM: 10_000,
    elevationGainM: 50,
  };

  it('rejects moving time greater than elapsed time', () => {
    expect(activityCreateSchema.safeParse({ ...valid, movingS: 4000 }).success).toBe(false);
  });

  it('rejects a track large enough to be a denial of service', () => {
    const track = Array.from({ length: 50_001 }, () => [0, 0]);
    expect(activityCreateSchema.safeParse({ ...valid, track }).success).toBe(false);
  });

  it('accepts a well-formed activity', () => {
    expect(activityCreateSchema.safeParse(valid).success).toBe(true);
  });

  it('requires at least two points for a route', () => {
    expect(routeCreateSchema.safeParse({ name: 'Loop', path: [[0, 0]] }).success).toBe(false);
    expect(
      routeCreateSchema.safeParse({
        name: 'Loop',
        path: [
          [0, 0],
          [0.01, 0.01],
        ],
      }).success,
    ).toBe(true);
  });

  it('rejects coordinates outside the world', () => {
    expect(
      routeCreateSchema.safeParse({
        name: 'Loop',
        path: [
          [200, 0],
          [0, 0],
        ],
      }).success,
    ).toBe(false);
  });
});

describe('feature flags fail safe', () => {
  it('keeps every unbuilt platform surface off', () => {
    for (const name of [
      'coachPlatform',
      'gymPlatform',
      'classBooking',
      'qrAccess',
      'payments',
      'aiAssistant',
      'googleMaps',
      'adminConsole',
    ] as const) {
      // Not even an environment that tries can turn these on: the security
      // work behind them is not done, and a flag file must not be able to
      // expose a surface that was never built.
      expect(isEnabled(name), name).toBe(false);
      expect(isEnabled(name, []), name).toBe(false);
    }
  });

  it('treats a flag it has never heard of as off', () => {
    expect(isEnabled('somethingFromAnOlderDeploy' as FeatureName)).toBe(false);
    expect(isKnownFeature('somethingFromAnOlderDeploy')).toBe(false);
    expect(isKnownFeature('activities')).toBe(true);
  });
});

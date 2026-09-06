import type { LngLat } from './types';

const EARTH_RADIUS_M = 6_371_008.8;
const toRad = (deg: number) => (deg * Math.PI) / 180;

/** Great-circle distance in metres between two [lng, lat] points. */
export function haversineM(a: LngLat, b: LngLat): number {
  const [lng1, lat1] = a;
  const [lng2, lat2] = b;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(s)));
}

export function pathLengthM(points: readonly LngLat[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    total += haversineM(points[i - 1]!, points[i]!);
  }
  return total;
}

/**
 * Google encoded polyline, precision 5.
 *
 * Implemented here rather than pulled in as a dependency: it is forty lines,
 * it is the format every map client already understands, and it keeps the
 * sanitized geometry a plain string that no query can accidentally widen back
 * into full precision.
 */
export function encodePolyline(points: readonly LngLat[]): string {
  let lastLat = 0;
  let lastLng = 0;
  let out = '';

  const chunk = (value: number): string => {
    let v = value < 0 ? ~(value << 1) : value << 1;
    let s = '';
    while (v >= 0x20) {
      s += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
      v >>= 5;
    }
    s += String.fromCharCode(v + 63);
    return s;
  };

  for (const [lng, lat] of points) {
    const iLat = Math.round(lat * 1e5);
    const iLng = Math.round(lng * 1e5);
    out += chunk(iLat - lastLat) + chunk(iLng - lastLng);
    lastLat = iLat;
    lastLng = iLng;
  }
  return out;
}

export function decodePolyline(encoded: string): LngLat[] {
  const points: LngLat[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  const readVarint = (): number => {
    let result = 0;
    let shift = 0;
    let byte: number;
    do {
      byte = encoded.charCodeAt(index) - 63;
      index += 1;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };

  while (index < encoded.length) {
    lat += readVarint();
    lng += readVarint();
    points.push([lng / 1e5, lat / 1e5]);
  }
  return points;
}

/**
 * Douglas–Peucker, so a feed card carries a few hundred points instead of a few
 * thousand. Tolerance is in degrees, which is fine for display simplification.
 */
export function simplify(points: readonly LngLat[], tolerance = 0.0001): LngLat[] {
  if (points.length <= 2) return [...points];

  const perpendicular = (p: LngLat, a: LngLat, b: LngLat): number => {
    const [px, py] = p;
    const [ax, ay] = a;
    const [bx, by] = b;
    const dx = bx - ax;
    const dy = by - ay;
    if (dx === 0 && dy === 0) return Math.hypot(px - ax, py - ay);
    const t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy);
    const clamped = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (ax + clamped * dx), py - (ay + clamped * dy));
  };

  let maxDist = 0;
  let index = 0;
  const first = points[0]!;
  const last = points[points.length - 1]!;
  for (let i = 1; i < points.length - 1; i += 1) {
    const d = perpendicular(points[i]!, first, last);
    if (d > maxDist) {
      maxDist = d;
      index = i;
    }
  }

  if (maxDist <= tolerance) return [first, last];
  return [
    ...simplify(points.slice(0, index + 1), tolerance).slice(0, -1),
    ...simplify(points.slice(index), tolerance),
  ];
}

/**
 * A route drawn as a line.
 *
 * FORGE has no photography budget and no stock library, and a fitness site full
 * of generic gym photos looks like every other fitness site. The product's own
 * material — a GPS trace — is a better visual: it is what the athlete actually
 * makes, it is legible at any size, and it costs nothing to ship.
 *
 * Deterministic from `seed`, so the same route renders identically on the
 * server and the client and never causes a hydration mismatch.
 */
function hash(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return () => {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function RouteGlyph({
  seed,
  className,
  strokeWidth = 2.5,
  showMarkers = true,
}: {
  seed: string;
  className?: string;
  strokeWidth?: number;
  showMarkers?: boolean;
}) {
  const rand = hash(seed);
  const steps = 26;
  const points: [number, number][] = [];

  // A wander with momentum, kept inside the box. Pure noise looks like static;
  // carrying velocity forward makes it read as a path someone actually ran.
  let x = 12 + rand() * 22;
  let y = 70 + rand() * 18;
  let vx = 1.6 + rand();
  let vy = -0.6 + rand() * 1.2;

  for (let i = 0; i < steps; i += 1) {
    points.push([x, y]);
    vx += (rand() - 0.45) * 1.5;
    vy += (rand() - 0.5) * 1.9;
    vx = Math.max(-2.6, Math.min(3.4, vx));
    vy = Math.max(-2.8, Math.min(2.8, vy));
    x += vx * 2.6;
    y += vy * 2.4;
    if (x > 88 || x < 8) vx *= -1;
    if (y > 88 || y < 12) vy *= -1;
    x = Math.max(8, Math.min(92, x));
    y = Math.max(10, Math.min(90, y));
  }

  const d = points
    .map(([px, py], i) => {
      if (i === 0) return `M ${px.toFixed(1)} ${py.toFixed(1)}`;
      const [prevX, prevY] = points[i - 1]!;
      const cx = (prevX + px) / 2;
      const cy = (prevY + py) / 2;
      return `Q ${prevX.toFixed(1)} ${prevY.toFixed(1)} ${cx.toFixed(1)} ${cy.toFixed(1)}`;
    })
    .join(' ');

  const start = points[0]!;
  const end = points[points.length - 1]!;

  return (
    <svg
      viewBox="0 0 100 100"
      className={className}
      role="img"
      aria-label="Abstract route trace"
      preserveAspectRatio="xMidYMid slice"
    >
      {/* A faint grid, so the line reads as a route on a map rather than a squiggle. */}
      <g stroke="currentColor" strokeWidth="0.25" opacity="0.14">
        {[20, 40, 60, 80].map((v) => (
          <line key={`h${v}`} x1="0" y1={v} x2="100" y2={v} />
        ))}
        {[20, 40, 60, 80].map((v) => (
          <line key={`v${v}`} x1={v} y1="0" x2={v} y2="100" />
        ))}
      </g>
      <path
        d={d}
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth + 2.5}
        opacity="0.18"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d={d}
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {showMarkers && (
        <>
          <circle cx={start[0]} cy={start[1]} r="2.2" fill="currentColor" />
          <circle
            cx={end[0]}
            cy={end[1]}
            r="3"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
          />
        </>
      )}
    </svg>
  );
}

import clsx from 'clsx';

/**
 * Charts.
 *
 * Hand-built SVG rather than a charting library: the whole product needs six
 * chart types, all of them small, and a library would cost more bundle weight
 * than the charts themselves while making them look like somebody else's
 * product. Every chart here is also readable as a table — the numbers are in
 * the labels, not only in the geometry.
 */

export function ProgressRing({
  value,
  size = 92,
  label,
  sublabel,
  tone = 'accent',
}: {
  value: number;
  size?: number;
  label?: string;
  sublabel?: string;
  tone?: 'accent' | 'good' | 'warn' | 'bad' | 'neutral';
}) {
  const clamped = Math.max(0, Math.min(100, value));
  const stroke = size >= 80 ? 7 : 5;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const dash = (clamped / 100) * circumference;

  const colours = {
    accent: 'stroke-ember',
    good: 'stroke-signal-good',
    warn: 'stroke-signal-warn',
    bad: 'stroke-signal-bad',
    neutral: 'stroke-smoke-500',
  } as const;

  return (
    <div className="inline-flex flex-col items-center gap-2">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${label ?? 'Progress'}: ${clamped}%`}>
          <circle
            cx={size / 2} cy={size / 2} r={radius} fill="none" strokeWidth={stroke}
            className="stroke-current opacity-10"
          />
          <circle
            cx={size / 2} cy={size / 2} r={radius} fill="none" strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${dash} ${circumference - dash}`}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
            className={clsx(colours[tone], 'transition-[stroke-dasharray] duration-700 ease-forge')}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="display text-lg tabular-nums leading-none">{clamped}</span>
          {sublabel && <span className="mt-0.5 text-[0.5625rem] uppercase tracking-[0.12em] opacity-55">{sublabel}</span>}
        </div>
      </div>
      {label && <span className="text-[0.6875rem] uppercase tracking-[0.1em] opacity-65">{label}</span>}
    </div>
  );
}

export function ProgressBar({
  value,
  max = 100,
  label,
  valueLabel,
  tone = 'accent',
}: {
  value: number;
  max?: number;
  label?: string;
  valueLabel?: string;
  tone?: 'accent' | 'good' | 'warn' | 'bad' | 'neutral';
}) {
  const percent = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  const colours = {
    accent: 'bg-ember', good: 'bg-signal-good', warn: 'bg-signal-warn',
    bad: 'bg-signal-bad', neutral: 'bg-smoke-500',
  } as const;

  return (
    <div>
      {(label || valueLabel) && (
        <div className="mb-2 flex items-baseline justify-between gap-3">
          {label && <span className="text-xs font-medium opacity-70">{label}</span>}
          {valueLabel && <span className="text-xs font-semibold tabular-nums">{valueLabel}</span>}
        </div>
      )}
      <div
        className="h-1.5 w-full overflow-hidden rounded-pill bg-current/10"
        role="progressbar"
        aria-valuenow={Math.round(percent)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label ?? 'Progress'}
      >
        <div
          className={clsx('h-full rounded-pill transition-[width] duration-700 ease-forge', colours[tone])}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

export interface SeriesPoint {
  date: string;
  value: number;
}

export function LineChart({
  points,
  height = 160,
  label,
  format = (v) => String(Math.round(v)),
  tone = 'accent',
  comparison,
}: {
  points: SeriesPoint[];
  height?: number;
  label: string;
  format?: (value: number) => string;
  tone?: 'accent' | 'neutral';
  comparison?: SeriesPoint[];
}) {
  if (points.length < 2) {
    return (
      <div className="flex h-40 items-center justify-center rounded-card border border-dashed border-current/15 text-xs opacity-55">
        Not enough data yet for {label.toLowerCase()}
      </div>
    );
  }

  const width = 640;
  const padding = 8;
  const values = points.map((p) => p.value);
  const min = Math.min(...values, ...(comparison?.map((p) => p.value) ?? []));
  const max = Math.max(...values, ...(comparison?.map((p) => p.value) ?? []));
  const span = max - min || 1;

  const toPath = (series: SeriesPoint[]) =>
    series
      .map((point, index) => {
        const x = padding + (index / (series.length - 1)) * (width - padding * 2);
        const y = height - padding - ((point.value - min) / span) * (height - padding * 2);
        return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');

  const path = toPath(points);
  const areaPath = `${path} L${width - padding},${height - padding} L${padding},${height - padding} Z`;
  const first = points[0]!;
  const last = points[points.length - 1]!;

  return (
    <figure>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full"
        style={{ height }}
        role="img"
        aria-label={`${label}. From ${format(first.value)} on ${first.date} to ${format(last.value)} on ${last.date}.`}
      >
        <defs>
          <linearGradient id={`grad-${label.replace(/\W/g, '')}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.18" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path
          d={areaPath}
          fill={`url(#grad-${label.replace(/\W/g, '')})`}
          className={tone === 'accent' ? 'text-ember' : 'text-smoke-500'}
        />
        {comparison && comparison.length > 1 && (
          <path
            d={toPath(comparison)} fill="none" strokeWidth={1.5} strokeDasharray="4 4"
            className="stroke-current opacity-30"
          />
        )}
        <path
          d={path} fill="none" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
          className={clsx('animate-sweep-in origin-left', tone === 'accent' ? 'stroke-ember' : 'stroke-smoke-500')}
        />
      </svg>
      <figcaption className="mt-2 flex justify-between text-[0.6875rem] tabular-nums opacity-55">
        <span>{format(first.value)}</span>
        <span className="font-semibold opacity-90">{format(last.value)}</span>
      </figcaption>
    </figure>
  );
}

export function BarChart({
  points,
  height = 150,
  label,
  format = (v) => String(Math.round(v)),
}: {
  points: SeriesPoint[];
  height?: number;
  label: string;
  format?: (value: number) => string;
}) {
  if (points.length === 0) {
    return (
      <div className="flex h-36 items-center justify-center rounded-card border border-dashed border-current/15 text-xs opacity-55">
        No {label.toLowerCase()} recorded yet
      </div>
    );
  }
  const max = Math.max(...points.map((p) => p.value), 1);

  return (
    <figure>
      <div className="flex items-end gap-1.5" style={{ height }} role="img" aria-label={`${label} by week`}>
        {points.map((point) => (
          <div key={point.date} className="group/bar relative flex flex-1 flex-col justify-end">
            <div
              className={clsx(
                'w-full rounded-t-[3px] transition-all duration-500 ease-forge',
                point.value === 0 ? 'bg-current/8' : 'bg-ember/75 group-hover/bar:bg-ember',
              )}
              style={{ height: `${Math.max(2, (point.value / max) * 100)}%` }}
            />
            <span className="sr-only">{`${point.date}: ${format(point.value)}`}</span>
          </div>
        ))}
      </div>
      <figcaption className="mt-2 flex justify-between text-[0.6875rem] opacity-55">
        <span>{points[0]!.date.slice(5)}</span>
        <span>Peak {format(max)}</span>
        <span>{points[points.length - 1]!.date.slice(5)}</span>
      </figcaption>
    </figure>
  );
}

export function Heatmap({
  cells,
  label,
}: {
  cells: { date: string; count: number; intensity: number }[];
  label: string;
}) {
  // Five steps, each with a distinct lightness as well as a distinct opacity,
  // so the ramp survives greyscale.
  const shades = ['bg-current/[0.06]', 'bg-ember/25', 'bg-ember/45', 'bg-ember/70', 'bg-ember'];

  return (
    <figure>
      <div
        className="scroll-x scrollbar-none"
        role="img"
        aria-label={`${label}. ${cells.filter((c) => c.count > 0).length} active days of ${cells.length}.`}
      >
        <div className="grid grid-flow-col grid-rows-7 gap-1" style={{ minWidth: `${Math.ceil(cells.length / 7) * 14}px` }}>
          {cells.map((cell) => (
            <span
              key={cell.date}
              title={`${cell.date}: ${cell.count} session${cell.count === 1 ? '' : 's'}`}
              className={clsx('h-2.5 w-2.5 rounded-[2px]', shades[cell.intensity] ?? shades[0])}
            />
          ))}
        </div>
      </div>
      <figcaption className="mt-3 flex items-center gap-2 text-[0.6875rem] opacity-55">
        <span>Less</span>
        {shades.map((shade, index) => (
          <span key={index} className={clsx('h-2.5 w-2.5 rounded-[2px]', shade)} />
        ))}
        <span>More</span>
      </figcaption>
    </figure>
  );
}

export function DonutChart({
  segments,
  label,
}: {
  segments: { label: string; value: number; share: number }[];
  label: string;
}) {
  if (segments.length === 0) {
    return (
      <div className="flex h-40 items-center justify-center rounded-card border border-dashed border-current/15 text-xs opacity-55">
        No {label.toLowerCase()} yet
      </div>
    );
  }

  const size = 148;
  const stroke = 20;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  // A ramp of one hue rather than a rainbow: the categories are one dimension.
  const opacities = [1, 0.82, 0.66, 0.52, 0.4, 0.3, 0.22, 0.16, 0.12];

  let offset = 0;
  return (
    <div className="flex flex-wrap items-center gap-6">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label}>
        {segments.map((segment, index) => {
          const dash = (segment.share / 100) * circumference;
          const element = (
            <circle
              key={segment.label}
              cx={size / 2} cy={size / 2} r={radius} fill="none" strokeWidth={stroke}
              strokeDasharray={`${dash} ${circumference - dash}`}
              strokeDashoffset={-offset}
              transform={`rotate(-90 ${size / 2} ${size / 2})`}
              className="stroke-ember"
              style={{ opacity: opacities[index] ?? 0.1 }}
            />
          );
          offset += dash;
          return element;
        })}
      </svg>
      <ul className="min-w-[160px] flex-1 space-y-2">
        {segments.slice(0, 6).map((segment, index) => (
          <li key={segment.label} className="flex items-center justify-between gap-3 text-xs">
            <span className="flex items-center gap-2 capitalize">
              <span
                aria-hidden
                className="h-2.5 w-2.5 rounded-[2px] bg-ember"
                style={{ opacity: opacities[index] ?? 0.1 }}
              />
              {segment.label}
            </span>
            <span className="font-semibold tabular-nums">{segment.share}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Sparkline({ values, tone = 'accent' }: { values: number[]; tone?: 'accent' | 'neutral' }) {
  if (values.length < 2) return <span className="text-xs opacity-40">—</span>;
  const width = 72;
  const height = 22;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const path = values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * width;
      const y = height - ((value - min) / span) * height;
      return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden className="overflow-visible">
      <path
        d={path} fill="none" strokeWidth={1.75} strokeLinecap="round"
        className={tone === 'accent' ? 'stroke-ember' : 'stroke-smoke-500'}
      />
    </svg>
  );
}

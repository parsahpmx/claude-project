import { formatDuration } from '@/lib/format';

/**
 * Weekly training time.
 *
 * Server-rendered SVG rather than a chart library: one series of eight bars
 * does not justify shipping a runtime to the browser, and hand-drawing it means
 * the hover affordance can be a native `<title>` — which works with no
 * JavaScript at all and is read aloud by screen readers as well.
 *
 * Colour choices follow the visualization rules: a single series needs no
 * legend because the heading names it; the fill is a step deeper than the UI
 * accent, which is too light to fill a shape on near-black; and the current
 * week is marked by a label as well as a brighter fill, so identity never rests
 * on colour alone.
 */
export function WeeklyVolumeChart({
  weeks,
}: { weeks: readonly { week: string; minutes: number }[] }) {
  if (weeks.length === 0) {
    return <p className="text-secondary muted">Not enough history to chart yet.</p>;
  }

  const max = Math.max(...weeks.map((w) => w.minutes), 1);
  const peak = weeks.reduce((top, w) => (w.minutes > top.minutes ? w : top), weeks[0]!);
  const current = weeks[weeks.length - 1]!;

  const width = 100;
  const height = 44;
  const gap = 2;                                   // 2px surface gap between bars
  const barWidth = (width - gap * (weeks.length - 1)) / weeks.length;

  return (
    <figure>
      <figcaption className="sr-only">
        Training time for each of the last {weeks.length} weeks, in minutes.
      </figcaption>

      <svg viewBox={`0 0 ${width} ${height + 6}`} className="w-full" role="img"
        aria-label={`Weekly training time. Peak ${formatDuration(peak.minutes * 60)} in the week of ${peak.week}. This week ${formatDuration(current.minutes * 60)}.`}>
        {/* A single recessive gridline at the peak, rather than a full grid. */}
        <line x1="0" y1="0.5" x2={width} y2="0.5" stroke="currentColor" strokeWidth="0.25"
          className="text-ink-600" />
        <line x1="0" y1={height} x2={width} y2={height} stroke="currentColor" strokeWidth="0.4"
          className="text-ink-600" />

        {/* Rounded data-ends (rx), anchored to the baseline. */}
        {weeks.map((w, i) => {
          const h = Math.max(w.minutes === 0 ? 0 : 1.2, (w.minutes / max) * (height - 2));
          const x = i * (barWidth + gap);
          const isCurrent = i === weeks.length - 1;
          return (
            <rect
              key={w.week}
              x={x}
              y={height - h}
              width={barWidth}
              height={h}
              rx="1.2"
              className={isCurrent ? 'fill-signal' : 'fill-signal-700'}
            >
              <title>{`Week of ${w.week}: ${formatDuration(w.minutes * 60)}`}</title>
            </rect>
          );
        })}
      </svg>

      {/* Selective direct labels: the peak and the current week, never all of them. */}
      <div className="mt-3 flex items-baseline justify-between text-caption">
        <span className="muted">
          Peak <span className="tabular-nums text-bone-100">{formatDuration(peak.minutes * 60)}</span>
        </span>
        <span className="muted">
          This week <span className="tabular-nums text-bone-100">{formatDuration(current.minutes * 60)}</span>
        </span>
      </div>

      {/* The table view. Charts should never be the only way to reach the data. */}
      <details className="mt-4">
        <summary className="cursor-pointer text-caption muted hover:text-bone-100">
          Show these figures as a table
        </summary>
        <table className="mt-3 w-full border-collapse text-secondary">
          <caption className="sr-only">Weekly training time in minutes</caption>
          <thead>
            <tr className="border-b border-ink-600 text-left">
              <th scope="col" className="py-2 eyebrow font-normal">Week beginning</th>
              <th scope="col" className="py-2 eyebrow font-normal">Training time</th>
            </tr>
          </thead>
          <tbody>
            {weeks.map((w) => (
              <tr key={w.week} className="border-b border-ink-600 last:border-0">
                <td className="py-2 tabular-nums">{w.week}</td>
                <td className="py-2 tabular-nums text-bone-100">{formatDuration(w.minutes * 60)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}

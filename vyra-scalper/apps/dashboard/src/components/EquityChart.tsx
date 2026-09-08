"use client";

/**
 * The equity curve, drawn as inline SVG.
 *
 * No charting library: the one chart this console needs is a monotonic-in-time line, and a
 * dependency that renders it would be several hundred kilobytes for a path element.
 *
 * The y-axis is **not** zero-based. An equity curve compressed against zero hides the
 * drawdown, which is the part of the picture that matters; the axis labels state the range
 * so the scale cannot be misread.
 */

import { useMemo } from "react";

import { money } from "@/lib/format";
import type { Row } from "@/lib/types";

const WIDTH = 900;
const HEIGHT = 240;
const PAD = { top: 12, right: 16, bottom: 22, left: 78 };

export function EquityChart({ points }: { points: Row[] }) {
  const series = useMemo(() => extract(points), [points]);

  if (series.length < 2) {
    return <p className="dim">Not enough points to draw a curve.</p>;
  }

  const values = series.map((p) => p.equity);
  const min = Math.min(...values);
  const max = Math.max(...values);
  // A flat curve would divide by zero; give it a nominal band so the line renders centred.
  const span = max - min || Math.abs(max) || 1;
  const innerW = WIDTH - PAD.left - PAD.right;
  const innerH = HEIGHT - PAD.top - PAD.bottom;

  const x = (index: number) => PAD.left + (index / (series.length - 1)) * innerW;
  const y = (value: number) => PAD.top + innerH - ((value - min) / span) * innerH;

  const path = series.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(2)},${y(p.equity).toFixed(2)}`).join(" ");
  const start = series[0]!.equity;
  const end = series[series.length - 1]!.equity;
  const stroke = end >= start ? "var(--profit)" : "var(--loss)";

  // Peak-to-trough on the sampled points. Labelled as such: the engine computes the exact
  // figure on every point, and this curve is a sample of it.
  let peak = series[0]!.equity;
  let worst = 0;
  for (const point of series) {
    peak = Math.max(peak, point.equity);
    worst = Math.min(worst, point.equity - peak);
  }

  return (
    <>
      <div className="table-wrap" style={{ padding: 8 }}>
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          width="100%"
          height={HEIGHT}
          role="img"
          aria-label="Equity curve"
        >
          <line
            x1={PAD.left}
            x2={WIDTH - PAD.right}
            y1={y(start)}
            y2={y(start)}
            stroke="var(--border-strong)"
            strokeDasharray="3 3"
          />
          <path d={path} fill="none" stroke={stroke} strokeWidth={1.5} />
          <text x={4} y={y(max) + 4} fill="var(--text-faint)" fontSize={11}>
            {money(max)}
          </text>
          <text x={4} y={y(min) + 4} fill="var(--text-faint)" fontSize={11}>
            {money(min)}
          </text>
          <text
            x={PAD.left}
            y={HEIGHT - 6}
            fill="var(--text-faint)"
            fontSize={11}
          >
            {series.length} sampled points
          </text>
        </svg>
      </div>
      <p className="card-note">
        Start {money(start)} → end {money(end)}. Worst peak-to-trough on these sampled
        points: {money(worst)}. The engine records the exact drawdown on every point; this
        curve is a sample of it and the figure here can only understate it.
      </p>
    </>
  );
}

/** Pull `equity` out of whatever the artefact calls its fields, skipping unusable rows. */
function extract(points: Row[]): { equity: number }[] {
  const series: { equity: number }[] = [];
  for (const point of points) {
    const value = point.equity ?? point.value ?? point.balance;
    if (typeof value === "number" && Number.isFinite(value)) series.push({ equity: value });
  }
  return series;
}

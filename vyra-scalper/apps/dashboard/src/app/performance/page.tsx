"use client";

/**
 * Performance.
 *
 * Gross and net are shown as one table with both columns, never as a single figure with a
 * toggle. The whole platform exists to answer whether an edge survives its costs, and a
 * view that can show the gross column alone is a view that will be screenshotted alone.
 */

import { useEffect, useState } from "react";

import { EquityChart } from "@/components/EquityChart";
import { RunPicker } from "@/components/RunPicker";
import { useApi } from "@/components/useApi";
import {
  BoolBadge,
  GrossNetTable,
  Notice,
  PageHeader,
  QueryState,
  StatCard,
} from "@/components/ui";
import { api } from "@/lib/api";
import { label, money, num, pct } from "@/lib/format";
import type { Performance, RowPage } from "@/lib/types";

export default function PerformancePage() {
  const [runId, setRunId] = useState<string | null>(null);

  // Read ?run= from the URL directly rather than through useSearchParams, which would put
  // the whole page behind a Suspense boundary for one optional query parameter.
  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("run");
    if (requested) setRunId(requested);
  }, []);

  const performance = useApi<Performance | null>(
    () => (runId ? api.performance(runId) : Promise.resolve(null)),
    [runId],
  );
  const equity = useApi<RowPage | null>(
    () => (runId ? api.equity(runId) : Promise.resolve(null)),
    [runId],
  );

  const data = performance.data;

  return (
    <>
      <PageHeader title="Performance">
        Results of a completed run, before and after transaction costs. A strategy is not
        profitable until the net column says so.
      </PageHeader>

      <RunPicker runId={runId} onChange={setRunId} />

      <QueryState loading={performance.loading && !performance.loaded} error={performance.error}>
        {data ? (
          <>
            {data.implausibility_warnings.map((warning) => (
              <Notice key={warning} tone="bad" title="Implausible result">
                {warning}
              </Notice>
            ))}

            <div className="grid">
              <StatCard
                title="Net PnL (after costs)"
                value={money(asNumber(data.net.total_pnl))}
                tone={(asNumber(data.net.total_pnl) ?? 0) < 0 ? "loss" : "profit"}
              />
              <StatCard
                title="Gross PnL (before costs)"
                value={money(asNumber(data.gross.total_pnl))}
                note="not a result on its own"
              />
              <StatCard
                title="Total costs"
                value={money(totalCosts(data.costs))}
                note="commission, exchange fees, spread, slippage and market impact"
              />
              <StatCard
                title="Survives costs"
                value={<BoolBadge value={data.survives_costs} labels={["yes", "no"]} />}
              />
            </div>

            <section className="section">
              <h2 className="section-title">Gross versus net</h2>
              <GrossNetTable gross={data.gross} net={data.net} />
            </section>

            <section className="section">
              <h2 className="section-title">Where the costs went</h2>
              <p className="section-sub">
                Each component is modelled and reported separately, so a strategy killed by
                spread is distinguishable from one killed by commission. The last two rows
                are not amounts — they describe how much of the gross result the costs took,
                and how many times they could multiply before taking all of it.
              </p>
              <div className="grid">
                {Object.entries(data.costs).map(([name, value]) => (
                  <StatCard
                    key={name}
                    title={label(name)}
                    value={renderCost(name, value)}
                    note={COST_NOTES[name]}
                  />
                ))}
              </div>
            </section>

            <section className="section">
              <h2 className="section-title">Equity curve</h2>
              <p className="section-sub">
                {equity.data
                  ? `${equity.data.count} points sampled evenly across ${equity.data.total.toLocaleString()} recorded, so the curve spans the whole run.`
                  : "\u00a0"}
              </p>
              <QueryState loading={equity.loading && !equity.loaded} error={equity.error}>
                <EquityChart points={equity.data?.rows ?? []} />
              </QueryState>
            </section>

            <div className="grid-2">
              <Attribution title="By instrument" values={data.pnl_by_instrument} />
              <Attribution title="By strategy" values={data.pnl_by_strategy} />
              <Attribution title="By regime" values={data.pnl_by_regime} />
            </div>
          </>
        ) : (
          <p className="dim">Select a run.</p>
        )}
      </QueryState>
    </>
  );
}

function Attribution({ title, values }: { title: string; values: Record<string, number> }) {
  const entries = Object.entries(values);
  return (
    <div className="card">
      <p className="card-title">{title} · net</p>
      {entries.length === 0 ? (
        <p className="dim">Not recorded for this run.</p>
      ) : (
        <table>
          <tbody>
            {entries
              .sort((a, b) => a[1] - b[1])
              .map(([name, value]) => (
                <tr key={name}>
                  <td className="mono">{name}</td>
                  <td className={`num ${value < 0 ? "loss" : "profit"}`}>{money(value)}</td>
                </tr>
              ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

/**
 * How each figure in the cost block should be read.
 *
 * The block mixes units: most entries are money, `drag_pct_of_gross` is a fraction, and
 * `headroom` is a multiple. Formatting them all as currency turns a 13.3× headroom into
 * "$13.32", and summing them produces a "total" that is not a cost of anything.
 */
const COST_UNITS: Record<string, "money" | "ratio" | "multiple"> = {
  commission: "money",
  exchange_fees: "money",
  spread: "money",
  slippage: "money",
  market_impact: "money",
  financing: "money",
  drag: "money",
  total: "money",
  drag_pct_of_gross: "ratio",
  headroom: "multiple",
};

const COST_NOTES: Record<string, string> = {
  drag: "gross minus net — the same money, measured from the result",
  total: "the sum of the modelled cost components",
  drag_pct_of_gross: "share of the gross result the costs consumed",
  headroom: "how many times costs could multiply before the gross edge is gone",
};

/** Aggregates that restate the components rather than adding to them. */
const DERIVED_COSTS = new Set(["total", "drag", "drag_pct_of_gross", "headroom"]);

function renderCost(name: string, value: unknown): string {
  const numeric = asNumber(value);
  if (numeric === null) return String(value);
  switch (COST_UNITS[name]) {
    case "ratio":
      return pct(numeric);
    case "multiple":
      return `${numeric.toFixed(1)}×`;
    case "money":
      return money(numeric);
    default:
      // An unrecognised figure is shown as a number without a unit. Guessing "money" would
      // put a currency symbol on something that may not be an amount.
      return num(numeric);
  }
}

/**
 * The total cost of the run.
 *
 * Uses the engine's own `total` when it reports one. Falling back to a sum means adding the
 * components only — adding the derived figures too would double-count the result and mix in
 * a ratio.
 */
function totalCosts(costs: Record<string, unknown>): number {
  const reported = asNumber(costs.total);
  if (reported !== null) return reported;
  return Object.entries(costs).reduce<number>(
    (sum, [name, value]) =>
      DERIVED_COSTS.has(name) ? sum : sum + (typeof value === "number" ? value : 0),
    0,
  );
}

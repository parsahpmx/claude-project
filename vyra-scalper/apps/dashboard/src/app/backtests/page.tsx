"use client";

/**
 * Backtests.
 *
 * Every row carries its reproducibility state and its warnings, because a run whose result
 * hash cannot be reproduced is not evidence of anything, and a run on synthetic data is not
 * evidence about a market.
 */

import Link from "next/link";
import { useState } from "react";

import { useApi } from "@/components/useApi";
import { Badge, Notice, PageHeader, QueryState } from "@/components/ui";
import { api } from "@/lib/api";
import { money, timestamp } from "@/lib/format";
import type { RunDetail, RunList } from "@/lib/types";

export default function BacktestsPage() {
  const runs = useApi<RunList>(() => api.backtests(100), []);
  const [selected, setSelected] = useState<string | null>(null);
  const detail = useApi<RunDetail | null>(
    () => (selected ? api.backtest(selected) : Promise.resolve(null)),
    [selected],
  );

  return (
    <>
      <PageHeader title="Backtests">
        Completed runs on disk. The API does not start runs: a long compute job kicked off by
        an HTTP request is a job whose failure nobody sees, and the runner reports properly
        from the command line.
      </PageHeader>

      <QueryState
        loading={runs.loading && !runs.loaded}
        error={runs.error}
        empty={runs.data?.runs.length === 0}
        emptyMessage="No runs yet. Produce one with scripts/run_backtest.py."
      >
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Run</th>
                <th>Created</th>
                <th>Strategies</th>
                <th>Instruments</th>
                <th>Fill model</th>
                <th className="num">Net PnL</th>
                <th className="num">Trades</th>
                <th>Survives costs</th>
                <th>Reproducible</th>
                <th>Warnings</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {runs.data?.runs.map((run) => (
                <tr key={run.run_id}>
                  <td className="mono">{run.run_id}</td>
                  <td className="faint">{timestamp(run.created_at)}</td>
                  <td className="faint">{run.strategies.join(", ") || "—"}</td>
                  <td className="faint">{run.instruments.join(", ") || "—"}</td>
                  <td>{run.fill_model ?? "—"}</td>
                  <td className={`num ${(run.net_pnl ?? 0) < 0 ? "loss" : "profit"}`}>
                    {money(run.net_pnl)}
                  </td>
                  <td className="num">{run.trade_count ?? "—"}</td>
                  <td>
                    <Badge tone={run.survives_costs ? "good" : "bad"}>
                      {run.survives_costs ? "yes" : "no"}
                    </Badge>
                  </td>
                  <td>
                    <Badge tone={run.reproducible ? "good" : "warn"}>
                      {run.reproducible ? "yes" : "no"}
                    </Badge>
                  </td>
                  <td>
                    {run.warnings.length === 0 ? (
                      <span className="faint">none</span>
                    ) : (
                      <Badge tone="warn">{run.warnings.length}</Badge>
                    )}
                  </td>
                  <td>
                    <div className="row">
                      <button
                        onClick={() => setSelected(selected === run.run_id ? null : run.run_id)}
                      >
                        Manifest
                      </button>
                      <Link
                        className="button"
                        href={`/performance?run=${encodeURIComponent(run.run_id)}`}
                      >
                        Performance
                      </Link>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </QueryState>

      {selected ? (
        <section className="section" style={{ marginTop: 24 }}>
          <h2 className="section-title">
            Manifest · <span className="mono">{selected}</span>
          </h2>
          <p className="section-sub">
            Git commit, config hash, dataset fingerprint and master seed. Without all four a
            run cannot be reproduced, and a result that cannot be reproduced is an anecdote.
          </p>
          <QueryState loading={detail.loading && !detail.loaded} error={detail.error}>
            {detail.data ? (
              <>
                {detail.data.warnings.map((warning) => (
                  <Notice key={warning} tone="warn" title="Warning recorded by the runner">
                    {warning}
                  </Notice>
                ))}
                <pre className="json">{JSON.stringify(detail.data.manifest, null, 2)}</pre>
              </>
            ) : null}
          </QueryState>
        </section>
      ) : null}
    </>
  );
}

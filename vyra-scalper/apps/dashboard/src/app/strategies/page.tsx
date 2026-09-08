"use client";

/**
 * Strategies.
 *
 * The column that matters is **Promoted**, not **Enabled**. Enabled is a line in a config
 * file; promoted means the strategy passed the validation pipeline — walk-forward, Monte
 * Carlo, parameter plateau, cost stress — with every piece of evidence present. Nothing has
 * passed, so nothing is promoted, and the page says that rather than leaving the column
 * looking like an oversight.
 */

import { useState } from "react";

import { useApi } from "@/components/useApi";
import { Badge, Notice, PageHeader, QueryState } from "@/components/ui";
import { api } from "@/lib/api";
import type { Strategy } from "@/lib/types";

export default function StrategiesPage() {
  const strategies = useApi<Strategy[]>(() => api.strategies(), []);
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <>
      <PageHeader title="Strategies">
        Everything configured, with the regimes it is allowed to trade and the data it
        requires.
      </PageHeader>

      <Notice tone="warn" title="Enabled is not promoted">
        A strategy is promoted only after the validation pipeline passes it, and missing
        evidence counts as a failure. None has been promoted, so none of these is cleared
        for capital regardless of what a backtest shows.
      </Notice>

      <QueryState
        loading={strategies.loading && !strategies.loaded}
        error={strategies.error}
        empty={strategies.data?.length === 0}
      >
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Strategy</th>
                <th>Version</th>
                <th>Enabled</th>
                <th>Promoted</th>
                <th>Timeframe</th>
                <th>Instruments</th>
                <th>Allowed regimes</th>
                <th>Needs exchange depth</th>
                <th>Params</th>
              </tr>
            </thead>
            <tbody>
              {strategies.data?.map((strategy) => (
                <tr key={strategy.strategy_id}>
                  <td className="mono">{strategy.strategy_id}</td>
                  <td className="faint">{strategy.version}</td>
                  <td>
                    <Badge>{strategy.enabled ? "enabled" : "disabled"}</Badge>
                  </td>
                  <td>
                    <Badge tone={strategy.promoted ? "good" : "warn"}>
                      {strategy.promoted ? "promoted" : "not promoted"}
                    </Badge>
                  </td>
                  <td className="mono">{strategy.timeframe}</td>
                  <td className="faint">{strategy.instruments.join(", ") || "—"}</td>
                  <td className="faint">{strategy.allowed_regimes.join(", ") || "any"}</td>
                  <td>{strategy.requires_exchange_depth ? "yes" : "no"}</td>
                  <td>
                    <button
                      onClick={() =>
                        setExpanded(expanded === strategy.strategy_id ? null : strategy.strategy_id)
                      }
                    >
                      {Object.keys(strategy.params).length} params
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {expanded ? (
          <section className="section" style={{ marginTop: 20 }}>
            <h2 className="section-title">
              <span className="mono">{expanded}</span> parameters
            </h2>
            <pre className="json">
              {JSON.stringify(
                strategies.data?.find((s) => s.strategy_id === expanded)?.params ?? {},
                null,
                2,
              )}
            </pre>
          </section>
        ) : null}
      </QueryState>
    </>
  );
}

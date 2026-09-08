"use client";

/**
 * Overview.
 *
 * Answers, in order: is trading halted, is the engine healthy, what is configured to run,
 * and what does the most recent evidence say. The last one leads with the *net* figure and
 * with whether the run survived its costs — a dashboard whose headline number is gross PnL
 * teaches the person reading it the wrong thing every time they look at it.
 */

import Link from "next/link";

import { useApi } from "@/components/useApi";
import { BoolBadge, Notice, PageHeader, QueryState, StatCard } from "@/components/ui";
import { api } from "@/lib/api";
import { duration, money, timestamp } from "@/lib/format";
import type { Instrument, RunList, Strategy, SystemStatus } from "@/lib/types";

export default function OverviewPage() {
  const status = useApi<SystemStatus>(() => api.systemStatus(), [], 10_000);
  const markets = useApi<Instrument[]>(() => api.markets(), [], 30_000);
  const strategies = useApi<Strategy[]>(() => api.strategies(), []);
  const runs = useApi<RunList>(() => api.backtests(5), []);

  const latest = runs.data?.runs[0];
  const openMarkets = markets.data?.filter((m) => m.is_open).length ?? 0;
  const enabled = strategies.data?.filter((s) => s.enabled).length ?? 0;
  const promoted = strategies.data?.filter((s) => s.promoted).length ?? 0;

  return (
    <>
      <PageHeader title="Overview">
        What the engine is configured to do, and what the evidence says about it. No live
        trader is attached in this build: everything below describes configuration and
        completed research runs, not open risk.
      </PageHeader>

      {status.data?.warnings.map((warning) => (
        <Notice key={warning} tone="bad" title="System warning">
          {warning}
        </Notice>
      ))}

      <QueryState loading={status.loading && !status.loaded} error={status.error}>
        <div className="grid">
          <StatCard
            title="Engine"
            value={status.data?.health.status ?? "—"}
            note={`v${status.data?.engine_version ?? "—"} · ${status.data?.mode ?? "—"}`}
          />
          <StatCard
            title="Kill switch"
            value={status.data?.kill_switch.state ?? "—"}
            tone={status.data?.kill_switch.is_tripped ? "loss" : undefined}
            note={
              status.data?.kill_switch.is_tripped
                ? "trading halted; it will not clear itself"
                : "new entries allowed"
            }
          />
          <StatCard
            title="Uptime"
            value={duration(status.data?.health.uptime_seconds ?? 0)}
            note={`since ${timestamp(status.data?.health.started_at)}`}
          />
          <StatCard
            title="Markets open"
            value={`${openMarkets} / ${markets.data?.length ?? 0}`}
            note="by session calendar, right now"
          />
          <StatCard
            title="Strategies"
            value={`${enabled} enabled`}
            note={`${promoted} promoted — enabled is not promoted`}
          />
          <StatCard
            title="Completed runs"
            value={status.data?.health.runs_available ?? 0}
            note="backtests on disk"
          />
        </div>
      </QueryState>

      <section className="section">
        <h2 className="section-title">Most recent run</h2>
        <p className="section-sub">
          Headline figure is net of commission, spread, slippage and market impact. A run
          that does not survive its costs is not a result, however large its gross PnL.
        </p>
        <QueryState
          loading={runs.loading && !runs.loaded}
          error={runs.error}
          empty={!latest}
          emptyMessage="No completed runs yet."
        >
          {latest ? (
            <>
              {latest.warnings.map((warning) => (
                <Notice key={warning} tone="warn" title="Run warning">
                  {warning}
                </Notice>
              ))}
              <div className="grid">
                <StatCard
                  title="Net PnL (after costs)"
                  value={money(latest.net_pnl)}
                  tone={(latest.net_pnl ?? 0) < 0 ? "loss" : "profit"}
                  note={`${latest.trade_count ?? 0} trades`}
                />
                <StatCard
                  title="Survives costs"
                  value={
                    <BoolBadge
                      value={latest.survives_costs === true}
                      labels={["yes", "no"]}
                    />
                  }
                  note="net positive after every modelled cost"
                />
                <StatCard
                  title="Reproducible"
                  value={
                    <BoolBadge value={latest.reproducible === true} labels={["yes", "no"]} />
                  }
                  note={latest.result_hash ?? "no result hash recorded"}
                />
                <StatCard
                  title="Fill model"
                  value={latest.fill_model ?? "—"}
                  note={latest.instruments.join(", ") || "—"}
                />
              </div>
              <p>
                <Link href={`/performance?run=${encodeURIComponent(latest.run_id)}`}>
                  Full performance for {latest.run_id} →
                </Link>
              </p>
            </>
          ) : null}
        </QueryState>
      </section>
    </>
  );
}

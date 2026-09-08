"use client";

/**
 * System health.
 *
 * The engine reports its own state; this page renders it and computes nothing. A console
 * that derived "healthy" from a rule of its own would be a second opinion on a question the
 * engine already answers.
 */

import { useApi } from "@/components/useApi";
import { Badge, Notice, PageHeader, QueryState, StatCard } from "@/components/ui";
import { api, API_URL } from "@/lib/api";
import { duration, timestamp } from "@/lib/format";
import type { SystemStatus } from "@/lib/types";

export default function HealthPage() {
  const status = useApi<SystemStatus>(() => api.systemStatus(), [], 5_000);

  return (
    <>
      <PageHeader title="System Health">
        Live state of the API and the engine behind it, refreshed every five seconds.
      </PageHeader>

      {status.data?.warnings.map((warning) => (
        <Notice key={warning} tone="bad" title="System warning">
          {warning}
        </Notice>
      ))}

      <QueryState loading={status.loading && !status.loaded} error={status.error}>
        {status.data ? (
          <>
            <div className="grid">
              <StatCard
                title="Status"
                value={
                  <Badge tone={status.data.health.status === "ok" ? "good" : "bad"}>
                    {status.data.health.status}
                  </Badge>
                }
                note="degraded whenever the kill switch is tripped"
              />
              <StatCard title="Engine version" value={status.data.engine_version} />
              <StatCard title="Mode" value={status.data.mode} />
              <StatCard
                title="Uptime"
                value={duration(status.data.health.uptime_seconds)}
                note={`started ${timestamp(status.data.health.started_at)}`}
              />
              <StatCard title="Instruments loaded" value={status.data.health.instruments} />
              <StatCard title="Runs on disk" value={status.data.health.runs_available} />
            </div>

            <section className="section">
              <h2 className="section-title">Kill switch</h2>
              <div className="table-wrap">
                <table>
                  <tbody>
                    <Cell name="State" value={status.data.kill_switch.state} />
                    <Cell
                      name="Allows new entries"
                      value={status.data.kill_switch.allows_new_entries ? "yes" : "no"}
                    />
                    <Cell
                      name="Emergency policy"
                      value={status.data.kill_switch.emergency_policy}
                    />
                    <Cell name="Trigger" value={status.data.kill_switch.trigger ?? "—"} />
                    <Cell name="Detail" value={status.data.kill_switch.detail ?? "—"} />
                    <Cell
                      name="Tripped at"
                      value={timestamp(status.data.kill_switch.tripped_at)}
                    />
                    <Cell
                      name="Audit records"
                      value={String(status.data.kill_switch.history_count)}
                    />
                  </tbody>
                </table>
              </div>
            </section>

            <section className="section">
              <h2 className="section-title">Identity</h2>
              <p className="section-sub">
                The config hash identifies exactly which configuration produced what you are
                looking at. A run whose manifest carries a different hash was produced by a
                different platform.
              </p>
              <div className="table-wrap">
                <table>
                  <tbody>
                    <Cell name="API" value={API_URL} />
                    <Cell name="Config hash" value={status.data.config_hash} />
                  </tbody>
                </table>
              </div>
            </section>

            <Notice tone="info" title="Not yet instrumented">
              Event-loop latency, feed staleness, broker connectivity and order round-trip
              times are specified but not yet exported. They will appear here when the
              metrics pipeline exists; until then this page does not estimate them.
            </Notice>
          </>
        ) : null}
      </QueryState>
    </>
  );
}

function Cell({ name, value }: { name: string; value: string }) {
  return (
    <tr>
      <td className="dim" style={{ width: 220 }}>
        {name}
      </td>
      <td className="mono">{value}</td>
    </tr>
  );
}

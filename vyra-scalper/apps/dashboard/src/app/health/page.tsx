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
import { duration, label, num, timestamp } from "@/lib/format";
import type { FeedHealth, SystemStatus } from "@/lib/types";

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

            <FeedSection />

            <Notice tone="info" title="Not yet instrumented">
              Event-loop latency, broker connectivity and order round-trip times are
              specified but not yet exported. They will appear here when the metrics
              pipeline exists; until then this page does not estimate them.
            </Notice>
          </>
        ) : null}
      </QueryState>
    </>
  );
}

/**
 * Feed health.
 *
 * Three states are kept apart on purpose. `NOT_ATTACHED` means nothing is subscribed —
 * normal in this build. `STALE` means a socket is open and has stopped delivering, which
 * is the dangerous one: every naive check calls it connected, and the engine would be
 * trading on a price that stopped moving. `UNKNOWN` means the feed could not answer, which
 * is not a passing health check either.
 */
function FeedSection() {
  const feed = useApi<FeedHealth>(() => api.feed(), [], 5_000);
  const state = feed.data?.state ?? "—";
  const bad = state === "STALE" || state === "UNKNOWN" || state === "DISCONNECTED";

  return (
    <section className="section">
      <h2 className="section-title">Market data feed</h2>
      <QueryState loading={feed.loading && !feed.loaded} error={feed.error}>
        {feed.data ? (
          <>
            <div className="grid">
              <StatCard
                title="Feed state"
                value={<Badge tone={bad ? "bad" : feed.data.attached ? "good" : "warn"}>{state}</Badge>}
                tone={bad ? "loss" : undefined}
                note={feed.data.attached ? feed.data.transport : "nothing subscribed"}
              />
              {feed.data.silence_ms !== undefined ? (
                <StatCard
                  title="Silence"
                  value={`${num(feed.data.silence_ms, 0)} ms`}
                  note={
                    feed.data.heartbeat_timeout_ms !== undefined
                      ? `heartbeat timeout ${num(feed.data.heartbeat_timeout_ms, 0)} ms`
                      : undefined
                  }
                />
              ) : null}
              {feed.data.subscribed ? (
                <StatCard
                  title="Subscribed"
                  value={feed.data.subscribed.length}
                  note={feed.data.subscribed.join(", ")}
                />
              ) : null}
            </div>
            {feed.data.note ? (
              <Notice tone={bad ? "bad" : "info"}>{feed.data.note}</Notice>
            ) : null}
            {feed.data.stats ? (
              <div className="table-wrap">
                <table>
                  <tbody>
                    {Object.entries(feed.data.stats).map(([name, value]) => (
                      <Cell key={name} name={label(name)} value={String(value)} />
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </>
        ) : null}
      </QueryState>
    </section>
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

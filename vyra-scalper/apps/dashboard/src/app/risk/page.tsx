"use client";

/**
 * Risk limits.
 *
 * Read-only, and that is a design decision rather than an unfinished feature. The risk
 * engine has absolute authority; an endpoint that let a limit be raised from a browser
 * would be a second path into it, and the one guarantee the platform makes is that there is
 * exactly one.
 */

import { useApi } from "@/components/useApi";
import { Notice, PageHeader, QueryState, StatCard } from "@/components/ui";
import { api } from "@/lib/api";
import { num, pct } from "@/lib/format";
import type { RiskLimits } from "@/lib/types";

export default function RiskPage() {
  const limits = useApi<RiskLimits>(() => api.riskLimits(), []);

  return (
    <>
      <PageHeader title="Risk">
        The limits the risk engine enforces on every signal, before any order is created.
      </PageHeader>

      <Notice tone="info" title="Limits are not editable from here">
        They are configuration, applied at startup and enforced in one place. Changing a
        limit is a config change with a review, not a control on a dashboard — an interface
        that could widen a limit mid-session is an interface that will be used to widen one
        mid-drawdown.
      </Notice>

      <QueryState loading={limits.loading && !limits.loaded} error={limits.error}>
        {limits.data ? (
          <>
            <section className="section">
              <h2 className="section-title">Per trade</h2>
              <div className="grid">
                <StatCard
                  title="Max risk per trade"
                  value={pct(limits.data.max_risk_per_trade_pct)}
                  note="of equity, at the stop"
                />
                <StatCard
                  title="Min stop distance"
                  value={`${num(limits.data.min_stop_distance_ticks)} ticks`}
                  note="sizing divides by this; a tighter stop would size to infinity"
                />
              </div>
            </section>

            <section className="section">
              <h2 className="section-title">Loss limits</h2>
              <p className="section-sub">
                Breaching one of these halts trading. They are cumulative, not alternatives.
              </p>
              <div className="grid">
                <StatCard title="Max daily loss" value={pct(limits.data.max_daily_loss_pct)} />
                <StatCard title="Max weekly loss" value={pct(limits.data.max_weekly_loss_pct)} />
                <StatCard title="Max drawdown" value={pct(limits.data.max_drawdown_pct)} />
                <StatCard
                  title="Max consecutive losses"
                  value={limits.data.max_consecutive_losses}
                />
                <StatCard
                  title="Max trades per session"
                  value={limits.data.max_trades_per_session}
                  note="an over-trading guard, not a target"
                />
              </div>
            </section>

            <section className="section">
              <h2 className="section-title">Exposure</h2>
              <p className="section-sub">
                Expressed as notional over equity. Futures are leveraged instruments: one
                risk-appropriate position is already several times equity in notional terms,
                so these caps sit well above 100% by design. Loss is controlled by the
                per-trade risk limit; these caps bound concentration.
              </p>
              <div className="grid">
                <StatCard
                  title="Per instrument"
                  value={pct(limits.data.max_instrument_exposure_pct, 0)}
                />
                <StatCard
                  title="Portfolio"
                  value={pct(limits.data.max_portfolio_exposure_pct, 0)}
                />
                <StatCard
                  title="Correlated group"
                  value={pct(limits.data.max_correlated_exposure_pct, 0)}
                />
                <StatCard title="Max leverage" value={`${num(limits.data.max_leverage)}×`} />
              </div>
            </section>

            <section className="section">
              <h2 className="section-title">Correlation groups</h2>
              <p className="section-sub">
                Instruments that move together are budgeted together. Four long index
                positions are one position, not four.
              </p>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Group</th>
                      <th>Instruments</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(limits.data.correlation_groups).map(([group, members]) => (
                      <tr key={group}>
                        <td className="mono">{group}</td>
                        <td className="faint">{members.join(", ")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        ) : null}
      </QueryState>
    </>
  );
}

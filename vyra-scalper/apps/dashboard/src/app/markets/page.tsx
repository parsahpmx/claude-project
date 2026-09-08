"use client";

/**
 * Live Markets.
 *
 * Contract specifications and session state, from the engine's own instrument registry —
 * the same objects a strategy sizes against, so what is displayed here and what the risk
 * engine uses cannot drift apart.
 *
 * There is no price on this page. The engine has no live market-data feed attached in this
 * build, and a "last price" invented from a completed backtest would be a number an
 * operator could act on.
 */

import { useApi } from "@/components/useApi";
import { Badge, Notice, PageHeader, QueryState } from "@/components/ui";
import { api } from "@/lib/api";
import { num, timestamp } from "@/lib/format";
import type { Instrument, Sessions } from "@/lib/types";

export default function MarketsPage() {
  const markets = useApi<Instrument[]>(() => api.markets(), [], 30_000);
  const sessions = useApi<Sessions>(() => api.sessions(), [], 30_000);

  return (
    <>
      <PageHeader title="Live Markets">
        Instrument definitions and session state as of {timestamp(sessions.data?.as_of)}.
        Prices are not shown: no market-data feed is attached in this build, and a price
        carried over from a research run is not a live price.
      </PageHeader>

      <Notice tone="info" title="Exchange depth versus broker CFD depth">
        A CFD instrument shows <span className="mono">exchange depth: no</span>. Its book is
        one dealer&apos;s quoting, not centralised liquidity, and strategies that require
        real depth are refused on it rather than run against a proxy.
      </Notice>

      <QueryState
        loading={markets.loading && !markets.loaded}
        error={markets.error}
        empty={markets.data?.length === 0}
      >
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Instrument</th>
                <th>Class</th>
                <th>Session</th>
                <th>State</th>
                <th>Trading date</th>
                <th className="num">Tick size</th>
                <th className="num">Tick value</th>
                <th className="num">Multiplier</th>
                <th className="num">Max spread</th>
                <th>Exchange depth</th>
                <th>Expiry</th>
              </tr>
            </thead>
            <tbody>
              {markets.data?.map((instrument) => {
                const session = sessions.data?.instruments[instrument.instrument_id];
                return (
                  <tr key={instrument.instrument_id}>
                    <td className="mono">{instrument.instrument_id}</td>
                    <td>{instrument.asset_class}</td>
                    <td className="faint">{instrument.session_id}</td>
                    <td>
                      {session ? (
                        <Badge tone={session.is_open ? "good" : undefined}>
                          {session.state}
                          {session.blocked_window ? " · blocked" : ""}
                        </Badge>
                      ) : (
                        <span className="faint">—</span>
                      )}
                    </td>
                    <td className="mono faint">{session?.trading_date ?? "—"}</td>
                    <td className="num">{num(instrument.tick_size, 6)}</td>
                    <td className="num">{num(instrument.tick_value, 4)}</td>
                    <td className="num">{num(instrument.multiplier)}</td>
                    <td className="num">{num(instrument.max_spread_ticks)}</td>
                    <td>
                      <Badge tone={instrument.supports_exchange_depth ? "good" : "warn"}>
                        {instrument.supports_exchange_depth ? "yes" : "no"}
                      </Badge>
                    </td>
                    <td className="faint">
                      {instrument.expiry ? timestamp(instrument.expiry) : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </QueryState>
    </>
  );
}

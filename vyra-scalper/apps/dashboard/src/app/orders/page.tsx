"use client";

/**
 * Orders and fills.
 *
 * Scoped to a completed run, because that is the only place orders exist in this build.
 * Orders and fills are shown as separate tables rather than one merged view: a partial fill
 * is several fills against one order, and flattening them hides how an order actually
 * filled.
 */

import { useState } from "react";

import { RunPicker } from "@/components/RunPicker";
import { useApi } from "@/components/useApi";
import { DataTable, Notice, PageHeader, QueryState } from "@/components/ui";
import { api } from "@/lib/api";
import type { RowPage } from "@/lib/types";

export default function OrdersPage() {
  const [runId, setRunId] = useState<string | null>(null);
  const orders = useApi<RowPage>(
    () => (runId ? api.orders(runId) : Promise.resolve(empty(runId))),
    [runId],
  );
  const fills = useApi<RowPage>(
    () => (runId ? api.fills(runId) : Promise.resolve(empty(runId))),
    [runId],
  );

  return (
    <>
      <PageHeader title="Orders">
        The order and fill ledger of a completed run. No live order flow exists in this
        build; when the trader is attached this page reads the same artefacts from it.
      </PageHeader>

      <RunPicker runId={runId} onChange={setRunId} />

      {truncated(orders.data) || truncated(fills.data) ? (
        <Notice tone="info" title="Showing the first rows only">
          The API bounds a page at {orders.data?.limit ?? 500} rows. This is the beginning of
          the ledger: {orders.data?.count ?? 0} of {(orders.data?.total ?? 0).toLocaleString()}{" "}
          orders and {fills.data?.count ?? 0} of {(fills.data?.total ?? 0).toLocaleString()}{" "}
          fills.
        </Notice>
      ) : null}

      <section className="section">
        <h2 className="section-title">
          Orders ({orders.data?.count ?? 0} of {(orders.data?.total ?? 0).toLocaleString()})
        </h2>
        <QueryState loading={orders.loading && !orders.loaded} error={orders.error}>
          <DataTable rows={orders.data?.rows ?? []} emptyMessage="This run recorded no orders." />
        </QueryState>
      </section>

      <section className="section">
        <h2 className="section-title">
          Fills ({fills.data?.count ?? 0} of {(fills.data?.total ?? 0).toLocaleString()})
        </h2>
        <p className="section-sub">
          One order can produce several fills. Each carries its own price, so the difference
          between the intended and achieved price stays visible.
        </p>
        <QueryState loading={fills.loading && !fills.loaded} error={fills.error}>
          <DataTable rows={fills.data?.rows ?? []} emptyMessage="This run recorded no fills." />
        </QueryState>
      </section>
    </>
  );
}

function empty(runId: string | null): RowPage {
  return { run_id: runId ?? "", count: 0, total: 0, limit: 0, sampled: false, rows: [] };
}

function truncated(page: RowPage | null): boolean {
  return page !== null && page.total > page.count;
}

"use client";

/**
 * Positions.
 *
 * Empty in this build, and it says so rather than showing the closing position of the last
 * backtest. A console that renders a research artefact as a held position is one an
 * operator will eventually flatten against a broker that has nothing open.
 */

import { useApi } from "@/components/useApi";
import { DataTable, NotBuilt, PageHeader, QueryState } from "@/components/ui";
import { api } from "@/lib/api";
import type { Positions } from "@/lib/types";

export default function PositionsPage() {
  const positions = useApi<Positions>(() => api.positions(), [], 5_000);

  return (
    <>
      <PageHeader title="Positions">
        Open positions held by the trader, reconciled against the broker.
      </PageHeader>
      <QueryState loading={positions.loading && !positions.loaded} error={positions.error}>
        {positions.data && positions.data.count === 0 ? (
          <NotBuilt title="No live trader is attached">{positions.data.note}</NotBuilt>
        ) : (
          <DataTable rows={(positions.data?.positions as Record<string, unknown>[]) ?? []} />
        )}
      </QueryState>
    </>
  );
}

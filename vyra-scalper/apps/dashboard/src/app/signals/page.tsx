"use client";

/**
 * Signals and the risk decisions on them.
 *
 * Approvals are shown alongside refusals. A trail containing only refusals cannot
 * demonstrate that a limit was evaluated at all, so the engine records every decision and
 * this page shows every decision.
 */

import { useMemo, useState } from "react";

import { RunPicker } from "@/components/RunPicker";
import { useApi } from "@/components/useApi";
import { DataTable, Notice, PageHeader, QueryState, StatCard } from "@/components/ui";
import { api } from "@/lib/api";
import type { Row, RowPage } from "@/lib/types";

export default function SignalsPage() {
  const [runId, setRunId] = useState<string | null>(null);
  const decisions = useApi<RowPage>(
    () => (runId ? api.signals(runId) : Promise.resolve(empty(runId))),
    [runId],
  );

  const counts = useMemo(() => tally(decisions.data?.rows ?? []), [decisions.data]);

  return (
    <>
      <PageHeader title="Signals">
        A strategy proposes; the risk engine decides. Every decision is recorded — approvals
        included — because a log of refusals alone cannot show that a limit was checked.
      </PageHeader>

      <RunPicker runId={runId} onChange={setRunId} />

      <Notice tone="info" title="A signal carries no quantity">
        Strategies emit direction, entry, stop and confidence. Position size is computed by
        the risk engine from the stop distance and the risk budget, which is why no size
        column appears on a proposal.
      </Notice>

      {decisions.data && decisions.data.total > decisions.data.count ? (
        <Notice tone="info" title="Showing the first rows only">
          {decisions.data.count} of {decisions.data.total.toLocaleString()} recorded
          decisions. The proportions below describe what is shown, not the whole run.
        </Notice>
      ) : null}

      {counts.total > 0 ? (
        <div className="grid">
          {Object.entries(counts.byOutcome).map(([outcome, count]) => (
            <StatCard
              key={outcome}
              title={outcome}
              value={count}
              note={`${((count / counts.total) * 100).toFixed(1)}% of the ${counts.total} decisions shown`}
            />
          ))}
        </div>
      ) : null}

      <QueryState loading={decisions.loading && !decisions.loaded} error={decisions.error}>
        <DataTable
          rows={decisions.data?.rows ?? []}
          emptyMessage="This run recorded no risk decisions."
        />
      </QueryState>
    </>
  );
}

function empty(runId: string | null): RowPage {
  return { run_id: runId ?? "", count: 0, total: 0, limit: 0, sampled: false, rows: [] };
}

/**
 * Count decisions by outcome.
 *
 * The key is discovered rather than assumed: the engine names the field `decision` today,
 * and a page that hardcoded that would show zeroes rather than an error if it were renamed.
 */
function tally(rows: Row[]): { total: number; byOutcome: Record<string, number> } {
  const byOutcome: Record<string, number> = {};
  for (const row of rows) {
    const outcome = row.decision ?? row.outcome ?? row.status;
    if (typeof outcome !== "string") continue;
    byOutcome[outcome] = (byOutcome[outcome] ?? 0) + 1;
  }
  return { total: rows.length, byOutcome };
}

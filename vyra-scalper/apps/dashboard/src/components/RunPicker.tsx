"use client";

/**
 * Chooses which completed run a page is showing.
 *
 * Backtest artefacts are per-run, and a page that silently picked "the latest" would let
 * two screens disagree about which numbers they are describing. The run being displayed is
 * always named on screen.
 */

import { useEffect, useState } from "react";

import { useApi } from "@/components/useApi";
import { Notice } from "@/components/ui";
import { api } from "@/lib/api";
import { timestamp } from "@/lib/format";
import type { RunList } from "@/lib/types";

export function RunPicker({
  runId,
  onChange,
}: {
  runId: string | null;
  onChange: (runId: string) => void;
}) {
  const runs = useApi<RunList>(() => api.backtests(), []);
  const [initialised, setInitialised] = useState(false);

  const first = runs.data?.runs[0];
  useEffect(() => {
    if (!initialised && !runId && first) {
      onChange(first.run_id);
      setInitialised(true);
    }
  }, [initialised, runId, first, onChange]);

  if (runs.error) {
    return (
      <Notice tone="bad" title="Could not list runs">
        {runs.error}
      </Notice>
    );
  }
  if (!runs.data) return <p className="dim">Loading runs…</p>;
  if (runs.data.runs.length === 0) {
    return (
      <Notice tone="warn" title="No completed runs">
        Nothing has been run yet. Produce one with{" "}
        <span className="mono">python -m scripts.run_backtest</span>, and it will appear
        here.
      </Notice>
    );
  }

  return (
    <div className="row" style={{ marginBottom: 16 }}>
      <label htmlFor="run" style={{ margin: 0 }}>
        Run
      </label>
      <select
        id="run"
        value={runId ?? ""}
        onChange={(event) => onChange(event.target.value)}
        style={{ width: "auto", minWidth: 320 }}
      >
        {runs.data.runs.map((run) => (
          <option key={run.run_id} value={run.run_id}>
            {run.run_id} · {timestamp(run.created_at)} · {run.strategies.join(", ") || "—"}
          </option>
        ))}
      </select>
    </div>
  );
}

"use client";

/**
 * The kill switch, on every screen.
 *
 * It is a fixed bar rather than a card on the overview page because the state it reports —
 * whether the platform is allowed to trade — must be readable without navigating anywhere,
 * from whatever page an operator happens to be on when something goes wrong.
 *
 * Both actions are guarded, and the guards are not symmetric:
 *
 * * **Tripping** asks only for a reason, and the button is always live. Halting must never
 *   be the slower path.
 * * **Clearing** requires the operator to type a reason *and* tick an explicit assertion
 *   that the triggering condition is gone. The API refuses the reset otherwise, and this
 *   form makes the assertion a deliberate act rather than a default.
 */

import { useCallback, useState } from "react";

import { useApi } from "@/components/useApi";
import { useAuth } from "@/components/AuthProvider";
import { api, ApiError } from "@/lib/api";
import { timestamp } from "@/lib/format";
import type { KillSwitch } from "@/lib/types";

const REFRESH_MS = 5_000;

export function KillSwitchBanner() {
  const { can } = useAuth();
  const query = useApi<KillSwitch>(() => api.killSwitch(), [], REFRESH_MS);
  const [dialog, setDialog] = useState<"trip" | "reset" | null>(null);

  const state = query.data;
  const tripped = state?.is_tripped ?? false;

  return (
    <>
      <div className="killbar" data-tripped={tripped}>
        <span className="kill-state" data-tripped={tripped}>
          {state ? state.state : query.error ? "UNKNOWN" : "…"}
        </span>
        <span className="kill-detail">
          {query.error ? (
            <span className="loss">
              Kill-switch state unavailable: {query.error}. Treat the platform as halted
              until this is answered.
            </span>
          ) : tripped ? (
            <>
              Trading halted{state?.trigger ? ` — ${state.trigger}` : ""}
              {state?.detail ? `: ${state.detail}` : ""}
              {state?.tripped_at ? ` (${timestamp(state.tripped_at)})` : ""}. It will not
              clear itself.
            </>
          ) : (
            <>
              New entries allowed. Emergency policy on trip:{" "}
              <span className="mono">{state?.emergency_policy ?? "—"}</span>.
            </>
          )}
        </span>
        {can("OPERATOR") ? (
          tripped ? (
            <button onClick={() => setDialog("reset")}>Reset…</button>
          ) : (
            <button data-variant="danger" onClick={() => setDialog("trip")}>
              HALT TRADING
            </button>
          )
        ) : (
          <span className="faint">operator role required to change</span>
        )}
      </div>
      {dialog === "trip" ? (
        <TripDialog
          onClose={() => setDialog(null)}
          onDone={() => {
            setDialog(null);
            query.refresh();
          }}
        />
      ) : null}
      {dialog === "reset" ? (
        <ResetDialog
          onClose={() => setDialog(null)}
          onDone={() => {
            setDialog(null);
            query.refresh();
          }}
        />
      ) : null}
    </>
  );
}

function TripDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await api.tripKillSwitch(reason.trim());
      onDone();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }, [reason, onDone]);

  return (
    <Modal onClose={onClose} title="Halt trading">
      <p className="dim">
        Every strategy stops opening positions immediately. What happens to open positions
        is decided by the configured emergency policy, not by this dialog.
      </p>
      <div className="field">
        <label htmlFor="trip-reason">Reason (recorded in the audit trail)</label>
        <input
          id="trip-reason"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="e.g. market data feed is stale on CME"
          autoFocus
        />
      </div>
      {error ? <p className="loss">{error}</p> : null}
      <div className="row" style={{ justifyContent: "flex-end" }}>
        <button onClick={onClose} disabled={busy}>
          Cancel
        </button>
        <button data-variant="danger" onClick={submit} disabled={busy || !reason.trim()}>
          {busy ? "Halting…" : "Halt trading now"}
        </button>
      </div>
    </Modal>
  );
}

function ResetDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const [cleared, setCleared] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await api.resetKillSwitch(reason.trim(), cleared);
      onDone();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }, [reason, cleared, onDone]);

  return (
    <Modal onClose={onClose} title="Clear the kill switch">
      <p className="dim">
        Recorded against the account you signed in as. The switch refuses a reset that comes
        too soon after the trip, or one where the condition has not been asserted clear —
        that refusal is the point, and this dialog cannot override it.
      </p>
      <div className="field">
        <label htmlFor="reset-reason">What was investigated and resolved</label>
        <input
          id="reset-reason"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="e.g. feed reconnected, gap re-requested and verified"
          autoFocus
        />
      </div>
      <div className="field row">
        <input
          id="reset-cleared"
          type="checkbox"
          checked={cleared}
          onChange={(event) => setCleared(event.target.checked)}
          style={{ width: "auto" }}
        />
        <label htmlFor="reset-cleared" style={{ margin: 0 }}>
          I confirm the condition that halted trading no longer holds.
        </label>
      </div>
      {error ? <p className="loss">{error}</p> : null}
      <div className="row" style={{ justifyContent: "flex-end" }}>
        <button onClick={onClose} disabled={busy}>
          Cancel
        </button>
        <button onClick={submit} disabled={busy || !reason.trim() || !cleared}>
          {busy ? "Clearing…" : "Clear and resume"}
        </button>
      </div>
    </Modal>
  );
}

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="modal-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}

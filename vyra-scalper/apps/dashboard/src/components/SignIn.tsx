"use client";

/**
 * Sign-in.
 *
 * Engine health is shown before sign-in because `/health` is unauthenticated by design,
 * and because "I cannot sign in" and "the engine is down" are different problems that an
 * operator should be able to tell apart at 3am without a token.
 */

import { useState } from "react";

import { useApi } from "@/components/useApi";
import { useAuth } from "@/components/AuthProvider";
import { API_URL, health } from "@/lib/api";
import type { Health } from "@/lib/types";

export function SignIn() {
  const { signIn } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const engine = useApi<Health>(() => health(), []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signIn(username, password);
    } catch {
      // Deliberately not distinguishing an unknown account from a wrong password: the API
      // does not, and repeating a distinction it refuses to make would reintroduce it.
      setError("Incorrect username or password.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="signin">
      <form className="card signin-card" onSubmit={submit}>
        <div className="brand-name" style={{ marginBottom: 2 }}>
          VYRA
        </div>
        <div className="brand-sub" style={{ marginBottom: 18 }}>
          Scalper Engine · Operator Console
        </div>
        <div className="field">
          <label htmlFor="username">Username</label>
          <input
            id="username"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            autoComplete="username"
            autoFocus
          />
        </div>
        <div className="field">
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
          />
        </div>
        {error ? <p className="loss">{error}</p> : null}
        <button type="submit" disabled={busy || !username || !password} style={{ width: "100%" }}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
        <p className="card-note" style={{ marginTop: 14 }}>
          API <span className="mono">{API_URL}</span>
          <br />
          {engine.error ? (
            <span className="loss">Engine unreachable: {engine.error}</span>
          ) : engine.data ? (
            <>
              Engine <span className="mono">{engine.data.status}</span>, kill switch{" "}
              <span className={engine.data.kill_switch === "TRIPPED" ? "loss mono" : "mono"}>
                {engine.data.kill_switch}
              </span>
            </>
          ) : (
            "Checking engine…"
          )}
        </p>
      </form>
    </div>
  );
}

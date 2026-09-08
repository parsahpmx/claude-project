/**
 * The API client.
 *
 * Two decisions worth stating:
 *
 * 1. **The token lives in sessionStorage, never localStorage.** A trading console's
 *    credential should not survive the tab being closed, and localStorage persists
 *    indefinitely across sessions on a shared machine.
 * 2. **A 401 clears the token and returns to the sign-in screen** rather than retrying.
 *    An expired session that silently keeps rendering the last response would show stale
 *    trading state as if it were current.
 */

import type {
  ConfigResponse,
  FeedHealth,
  Health,
  Instrument,
  KillSwitch,
  Performance,
  Positions,
  RiskLimits,
  Row,
  RowPage,
  RunDetail,
  RunList,
  Sessions,
  Strategy,
  SystemStatus,
  TokenResponse,
} from "./types";

const TOKEN_KEY = "vyra.token";
const ROLE_KEY = "vyra.role";
const SUBJECT_KEY = "vyra.subject";

export const API_URL =
  process.env.NEXT_PUBLIC_VYRA_API_URL ?? "http://localhost:8000";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function storedToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.sessionStorage.getItem(TOKEN_KEY);
}

export function storedRole(): string | null {
  if (typeof window === "undefined") return null;
  return window.sessionStorage.getItem(ROLE_KEY);
}

export function storedSubject(): string | null {
  if (typeof window === "undefined") return null;
  return window.sessionStorage.getItem(SUBJECT_KEY);
}

export function clearSession(): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(TOKEN_KEY);
  window.sessionStorage.removeItem(ROLE_KEY);
  window.sessionStorage.removeItem(SUBJECT_KEY);
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = storedToken();
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, { ...init, headers });
  } catch (cause) {
    // A dashboard that renders nothing when the API is down is better than one that
    // renders the last good response and looks live.
    throw new ApiError(0, `cannot reach the API at ${API_URL}: ${String(cause)}`);
  }

  if (response.status === 401) {
    clearSession();
    throw new ApiError(401, "session expired; sign in again");
  }
  if (!response.ok) {
    let detail = `${response.status} ${response.statusText}`;
    try {
      const body = (await response.json()) as { detail?: unknown };
      if (body.detail) detail = String(body.detail);
    } catch {
      // A non-JSON error body is still an error; the status line carries enough.
    }
    throw new ApiError(response.status, detail);
  }
  return (await response.json()) as T;
}

export async function login(username: string, password: string): Promise<TokenResponse> {
  const body = new URLSearchParams({ username, password });
  const response = await fetch(`${API_URL}/auth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!response.ok) {
    throw new ApiError(response.status, "incorrect username or password");
  }
  const token = (await response.json()) as TokenResponse;
  window.sessionStorage.setItem(TOKEN_KEY, token.access_token);
  window.sessionStorage.setItem(ROLE_KEY, token.role);
  window.sessionStorage.setItem(SUBJECT_KEY, username);
  return token;
}

/** Unauthenticated on purpose — the sign-in screen shows engine health before sign-in. */
export async function health(): Promise<Health> {
  const response = await fetch(`${API_URL}/health`);
  if (!response.ok) throw new ApiError(response.status, "health check failed");
  return (await response.json()) as Health;
}

export const api = {
  systemStatus: () => request<SystemStatus>("/system/status"),
  feed: () => request<FeedHealth>("/system/feed"),
  config: (section?: string) =>
    request<ConfigResponse>(`/config${section ? `?section=${encodeURIComponent(section)}` : ""}`),
  riskLimits: () => request<RiskLimits>("/risk/limits"),
  killSwitch: () => request<KillSwitch>("/kill-switch"),
  tripKillSwitch: (reason: string) =>
    request<KillSwitch>("/kill-switch/trip", {
      method: "POST",
      body: JSON.stringify({ reason }),
    }),
  resetKillSwitch: (reason: string, conditionCleared: boolean) =>
    request<KillSwitch>("/kill-switch/reset", {
      method: "POST",
      body: JSON.stringify({ reason, condition_cleared: conditionCleared }),
    }),
  markets: () => request<Instrument[]>("/markets"),
  market: (id: string) => request<Instrument>(`/markets/${id}`),
  strategies: () => request<Strategy[]>("/strategies"),
  sessions: () => request<Sessions>("/sessions"),
  positions: () => request<Positions>("/positions"),
  backtests: (limit = 50) => request<RunList>(`/backtests?limit=${limit}`),
  backtest: (runId: string) => request<RunDetail>(`/backtests/${encodeURIComponent(runId)}`),
  performance: (runId: string) =>
    request<Performance>(`/backtests/${encodeURIComponent(runId)}/performance`),
  equity: (runId: string, limit = 500) =>
    rowsFrom(
      request<Record<string, unknown>>(
        `/backtests/${encodeURIComponent(runId)}/equity?limit=${limit}`,
      ),
      "points",
    ),
  trades: (runId: string, limit = 500) => runRows("/trades", runId, limit, "trades"),
  orders: (runId: string, limit = 500) => runRows("/orders", runId, limit, "orders"),
  fills: (runId: string, limit = 500) => runRows("/fills", runId, limit, "fills"),
  signals: (runId: string, limit = 500) => runRows("/signals", runId, limit, "decisions"),
};

/**
 * Normalise the row endpoints into one shape.
 *
 * Each names its rows differently (`trades`, `orders`, `decisions`, `points`). Collapsing
 * that here keeps every table component identical rather than one per endpoint.
 */
async function rowsFrom(
  pending: Promise<Record<string, unknown>>,
  key: string,
): Promise<RowPage> {
  const body = await pending;
  const rows = (body[key] as Row[] | undefined) ?? [];
  return {
    run_id: String(body.run_id ?? ""),
    count: Number(body.count ?? rows.length),
    // Falling back to the page size rather than to zero: a client that believed there were
    // no rows would tell the operator it is showing everything.
    total: Number(body.total ?? rows.length),
    limit: Number(body.limit ?? 0),
    sampled: Boolean(body.sampled ?? false),
    rows,
  };
}

function runRows(path: string, runId: string, limit: number, key: string): Promise<RowPage> {
  const query = `?run_id=${encodeURIComponent(runId)}&limit=${limit}`;
  return rowsFrom(request<Record<string, unknown>>(`${path}${query}`), key);
}

/**
 * The shapes the API returns.
 *
 * Written by hand against the OpenAPI document rather than generated, so that a field the
 * API stops sending becomes a type error here instead of `undefined` rendered as a number.
 */

export type Role = "VIEWER" | "TRADER" | "OPERATOR" | "ADMIN";

export interface TokenResponse {
  access_token: string;
  token_type: string;
  role: Role;
  expires_in_seconds: number;
}

export interface Health {
  status: string;
  uptime_seconds: number;
  started_at: string;
  config_hash: string;
  instruments: number;
  kill_switch: string;
  runs_available: number;
  feed: string;
}

/** Feed health. Open-ended: each transport reports its own counters. */
export interface FeedHealth {
  attached: boolean;
  state: string;
  note?: string;
  connected?: boolean;
  silence_ms?: number;
  heartbeat_timeout_ms?: number;
  transport?: string;
  subscribed?: string[];
  stats?: Record<string, number>;
  [key: string]: unknown;
}

export interface KillSwitch {
  state: string;
  is_tripped: boolean;
  allows_new_entries: boolean;
  emergency_policy: string;
  trigger: string | null;
  detail: string | null;
  tripped_at: string | null;
  history_count: number;
}

export interface SystemStatus {
  health: Health;
  kill_switch: KillSwitch;
  engine_version: string;
  mode: string;
  config_hash: string;
  warnings: string[];
}

export interface Instrument {
  instrument_id: string;
  symbol: string;
  asset_class: string;
  exchange: string;
  currency: string;
  tick_size: number;
  tick_value: number;
  multiplier: number;
  min_qty: number;
  qty_step: number;
  max_spread_ticks: number;
  session_id: string;
  timezone: string;
  supports_exchange_depth: boolean;
  expiry: string | null;
  is_open: boolean | null;
}

export interface Strategy {
  strategy_id: string;
  version: string;
  enabled: boolean;
  instruments: string[];
  timeframe: string;
  allowed_regimes: string[];
  requires_exchange_depth: boolean;
  params: Record<string, unknown>;
  promoted: boolean;
}

export interface RiskLimits {
  max_risk_per_trade_pct: number;
  min_stop_distance_ticks: number;
  max_daily_loss_pct: number;
  max_weekly_loss_pct: number;
  max_drawdown_pct: number;
  max_consecutive_losses: number;
  max_trades_per_session: number;
  max_instrument_exposure_pct: number;
  max_portfolio_exposure_pct: number;
  max_correlated_exposure_pct: number;
  max_leverage: number;
  correlation_groups: Record<string, string[]>;
}

export interface RunSummary {
  run_id: string;
  created_at: string;
  mode: string | null;
  strategies: string[];
  instruments: string[];
  fill_model: string | null;
  reproducible: boolean | null;
  result_hash: string | null;
  warnings: string[];
  net_pnl: number | null;
  trade_count: number | null;
  survives_costs: boolean | null;
}

export interface RunList {
  runs: RunSummary[];
  count: number;
}

export interface RunDetail {
  run_id: string;
  manifest: Record<string, unknown>;
  metrics: Record<string, unknown>;
  warnings: string[];
}

/** Metric blocks are open-ended: the analytics module adds figures over time. */
export type MetricBlock = Record<string, number | string | boolean | null>;

export interface Performance {
  run_id: string;
  gross: MetricBlock;
  net: MetricBlock;
  costs: MetricBlock;
  survives_costs: boolean;
  implausibility_warnings: string[];
  pnl_by_instrument: Record<string, number>;
  pnl_by_strategy: Record<string, number>;
  pnl_by_regime: Record<string, number>;
}

/** A row of a JSONL artefact. The engine adds fields over time, so it stays open. */
export type Row = Record<string, unknown>;

/**
 * A page of rows from one run artefact.
 *
 * `limit` is echoed back deliberately: a table showing 500 of an unknown number of trades
 * must be able to say so, or a truncated view reads as a complete one.
 */
export interface RowPage {
  run_id: string;
  count: number;
  /** How many rows the artefact holds. `count` rows of `total` are being shown. */
  total: number;
  limit: number;
  /** True when the rows are spread across the artefact rather than taken from its head. */
  sampled: boolean;
  rows: Row[];
}

export interface SessionState {
  session_id: string;
  is_open: boolean;
  state: string;
  trading_date: string;
  blocked_window: boolean;
}

export interface Sessions {
  as_of: string;
  instruments: Record<string, SessionState>;
}

export interface Positions {
  positions: unknown[];
  count: number;
  note: string;
}

export interface ConfigResponse {
  config_hash: string;
  config: Record<string, unknown>;
}

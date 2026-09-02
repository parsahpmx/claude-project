/**
 * Payment metrics.
 *
 * Deliberately small: counters and latency summaries for the events an
 * operator needs in order to notice that payments are going wrong, and
 * nothing else.
 *
 * ── What is NOT recorded, on purpose ─────────────────────────────────────
 * No payment payloads, no signatures, no authorization nonces, no payer
 * addresses, no API secrets. Metrics are the most widely-exported data a
 * service produces — they land in dashboards, third-party APM, and alert
 * bodies — so a signed authorization leaking into a label would be a bearer
 * instrument published to everyone with read access to a dashboard.
 *
 * Labels are therefore bounded to values from a fixed vocabulary: a network,
 * a rejection reason, a protocol. Nothing that varies per payer or per
 * payment is ever a label, which also keeps cardinality finite.
 * ─────────────────────────────────────────────────────────────────────────
 */

export type PaymentCounter =
  | 'challenges_issued'
  | 'authorizations_received'
  | 'authorization_parse_failures'
  | 'authorization_binding_failures'
  | 'authorization_signature_failures'
  | 'authorization_replay_attempts'
  | 'transaction_replay_attempts'
  | 'wrong_amount_attempts'
  | 'wrong_recipient_attempts'
  | 'wrong_network_attempts'
  | 'wrong_asset_attempts'
  | 'verify_success'
  | 'verify_rejected'
  | 'verify_unavailable'
  | 'settle_success'
  | 'settle_failed'
  | 'settle_uncertain'
  | 'payments_confirmed'
  | 'receipts_issued'
  /* Phase 3.5 — reconciliation */
  | 'reconciliation_started'
  | 'reconciliation_confirmed'
  | 'reconciliation_definitive_failure'
  | 'reconciliation_retry'
  /* Ran out of attempts without determining what happened. Alert on this. */
  | 'reconciliation_stuck'
  | 'facilitator_error'
  | 'rpc_error';

export type LatencyMetric = 'facilitator_verify' | 'facilitator_settle' | 'reconciliation_pass';

interface LatencySummary {
  count: number;
  totalMs: number;
  maxMs: number;
}

/**
 * An in-process registry.
 *
 * Per-task, and reset when the task restarts — which is the correct shape for
 * counters that a scraper reads periodically, and the wrong shape for
 * anything that needs to survive a deploy. Nothing here is used for billing
 * or accounting; those live in the database, where they are durable and
 * transactional.
 */
export class PaymentMetrics {
  private readonly counters = new Map<string, number>();
  private readonly latencies = new Map<LatencyMetric, LatencySummary>();

  increment(counter: PaymentCounter, labels: { network?: string; reason?: string } = {}): void {
    const key = this.key(counter, labels);
    this.counters.set(key, (this.counters.get(key) ?? 0) + 1);
  }

  observe(metric: LatencyMetric, milliseconds: number): void {
    const existing = this.latencies.get(metric) ?? { count: 0, totalMs: 0, maxMs: 0 };
    existing.count += 1;
    existing.totalMs += milliseconds;
    existing.maxMs = Math.max(existing.maxMs, milliseconds);
    this.latencies.set(metric, existing);
  }

  /** Time an async operation and record it, whatever the outcome. */
  async time<T>(metric: LatencyMetric, operation: () => Promise<T>): Promise<T> {
    const started = Date.now();
    try {
      return await operation();
    } finally {
      this.observe(metric, Date.now() - started);
    }
  }

  snapshot(): {
    counters: Record<string, number>;
    latencies: Record<string, { count: number; averageMs: number; maxMs: number }>;
  } {
    const latencies: Record<string, { count: number; averageMs: number; maxMs: number }> = {};
    for (const [name, summary] of this.latencies) {
      latencies[name] = {
        count: summary.count,
        averageMs: summary.count === 0 ? 0 : Math.round(summary.totalMs / summary.count),
        maxMs: summary.maxMs,
      };
    }
    return { counters: Object.fromEntries(this.counters), latencies };
  }

  reset(): void {
    this.counters.clear();
    this.latencies.clear();
  }

  private key(counter: PaymentCounter, labels: { network?: string; reason?: string }): string {
    const parts: string[] = [counter];
    if (labels.network) parts.push(`network=${labels.network}`);
    if (labels.reason) parts.push(`reason=${labels.reason}`);
    return parts.join('|');
  }
}

/** The process-wide registry. */
export const paymentMetrics = new PaymentMetrics();

/**
 * Map a verification failure reason to the counter it belongs to.
 *
 * Centralised so that adding a reason cannot silently go uncounted, and so the
 * mapping is reviewable in one place rather than scattered across handlers.
 */
export function countVerificationFailure(reason: string): void {
  switch (reason) {
    case 'WRONG_AMOUNT':
      paymentMetrics.increment('wrong_amount_attempts');
      break;
    case 'WRONG_RECIPIENT':
      paymentMetrics.increment('wrong_recipient_attempts');
      break;
    case 'WRONG_NETWORK':
      paymentMetrics.increment('wrong_network_attempts');
      break;
    case 'WRONG_ASSET':
      paymentMetrics.increment('wrong_asset_attempts');
      break;
    case 'TRANSACTION_ALREADY_USED':
      paymentMetrics.increment('authorization_replay_attempts');
      break;
    default:
      paymentMetrics.increment('authorization_binding_failures', { reason });
  }
}

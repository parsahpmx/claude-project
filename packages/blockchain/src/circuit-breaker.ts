/**
 * Circuit breaker (product rule 70).
 *
 * Guards each RPC provider independently. When a provider starts failing we
 * stop sending it traffic for a cooldown, then let a single probe through to
 * see whether it recovered.
 *
 * Why this matters here specifically: payment verification is on the critical
 * path of a merchant's API request. A provider that is timing out rather than
 * refusing connections will otherwise absorb the full request timeout on every
 * call before failover kicks in, turning one sick provider into latency for
 * every payment. The breaker converts that into an immediate skip.
 *
 * Only reads are protected. Meter402 never submits transactions, so there is
 * no write to retry and rule 70's "do not blindly retry financial writes"
 * caution does not arise.
 */

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerOptions {
  /** Consecutive failures before the circuit opens. */
  readonly failureThreshold: number;
  /** How long to stay open before allowing a probe. */
  readonly resetTimeoutMs: number;
  /** Injectable clock. Tests drive this rather than sleeping. */
  readonly now?: () => number;
}

export class CircuitBreaker {
  private failures = 0;
  private openedAt: number | null = null;
  private halfOpenInFlight = false;

  private readonly failureThreshold: number;
  private readonly resetTimeoutMs: number;
  private readonly now: () => number;

  constructor(options: CircuitBreakerOptions) {
    if (options.failureThreshold < 1) {
      throw new Error('failureThreshold must be at least 1');
    }
    this.failureThreshold = options.failureThreshold;
    this.resetTimeoutMs = options.resetTimeoutMs;
    this.now = options.now ?? Date.now;
  }

  get state(): CircuitState {
    if (this.openedAt === null) {
      return 'CLOSED';
    }
    if (this.now() - this.openedAt >= this.resetTimeoutMs) {
      return 'HALF_OPEN';
    }
    return 'OPEN';
  }

  /**
   * Whether a call may proceed.
   *
   * In HALF_OPEN exactly one probe is admitted. Letting the whole backlog
   * through on recovery would re-overload a provider that is only just coming
   * back, which is how a breaker turns into an oscillator.
   */
  canAttempt(): boolean {
    const state = this.state;
    if (state === 'CLOSED') {
      return true;
    }
    if (state === 'OPEN') {
      return false;
    }
    if (this.halfOpenInFlight) {
      return false;
    }
    this.halfOpenInFlight = true;
    return true;
  }

  recordSuccess(): void {
    this.failures = 0;
    this.openedAt = null;
    this.halfOpenInFlight = false;
  }

  recordFailure(): void {
    this.halfOpenInFlight = false;
    this.failures += 1;
    if (this.failures >= this.failureThreshold) {
      this.openedAt = this.now();
    }
  }

  /** Exposed for /metrics and the admin console's RPC status view. */
  snapshot(): { state: CircuitState; consecutiveFailures: number } {
    return { state: this.state, consecutiveFailures: this.failures };
  }
}

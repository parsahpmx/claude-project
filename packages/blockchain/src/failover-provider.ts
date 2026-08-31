import { CircuitBreaker, type CircuitState } from './circuit-breaker.js';
import { ProviderUnavailableError, type BlockchainProvider, type TransactionReceiptView } from './types.js';

/**
 * Primary/secondary RPC with per-provider circuit breaking (product rule 70).
 *
 * A single RPC vendor must not be a correctness dependency for payments. Public
 * endpoints rate-limit, and managed providers have incidents; either way a
 * merchant's paid endpoint should keep verifying payments.
 *
 * One subtlety worth stating plainly: a `null` receipt is an *answer*, not a
 * failure. If the primary says "I have never heard of this transaction" we
 * return that immediately instead of asking the secondary, because a
 * legitimately-unknown transaction would otherwise cost a full sweep of every
 * provider on every poll of every pending payment. Nodes do lag each other by
 * a block or two, but the caller's retry loop already handles that far more
 * cheaply than a fan-out does.
 */

export interface FailoverProviderOptions {
  readonly failureThreshold?: number;
  readonly resetTimeoutMs?: number;
  readonly now?: () => number;
  /** Called when a provider fails, for logging and alerting. */
  readonly onProviderError?: (providerName: string, error: unknown) => void;
}

export class FailoverBlockchainProvider implements BlockchainProvider {
  readonly chainId: number;
  readonly name: string;

  private readonly providers: readonly BlockchainProvider[];
  private readonly breakers: ReadonlyMap<string, CircuitBreaker>;
  private readonly onProviderError: (providerName: string, error: unknown) => void;

  constructor(providers: readonly BlockchainProvider[], options: FailoverProviderOptions = {}) {
    if (providers.length === 0) {
      throw new Error('FailoverBlockchainProvider requires at least one provider');
    }

    const first = providers[0];
    /* istanbul ignore next -- guarded by the length check above. */
    if (first === undefined) {
      throw new Error('FailoverBlockchainProvider requires at least one provider');
    }

    const mismatched = providers.filter((provider) => provider.chainId !== first.chainId);
    if (mismatched.length > 0) {
      // Mixing chains behind one failover pool would let a Base Sepolia node
      // answer a Base mainnet verification. Refuse at construction.
      throw new Error(
        `All providers must serve the same chain. Expected ${first.chainId}, got ` +
          `${mismatched.map((provider) => `${provider.name}=${provider.chainId}`).join(', ')}.`,
      );
    }

    this.providers = providers;
    this.chainId = first.chainId;
    this.name = `failover(${providers.map((provider) => provider.name).join(',')})`;
    this.onProviderError = options.onProviderError ?? (() => {});

    const breakers = new Map<string, CircuitBreaker>();
    for (const provider of providers) {
      breakers.set(
        provider.name,
        new CircuitBreaker({
          failureThreshold: options.failureThreshold ?? 3,
          resetTimeoutMs: options.resetTimeoutMs ?? 30_000,
          ...(options.now ? { now: options.now } : {}),
        }),
      );
    }
    this.breakers = breakers;
  }

  private async run<T>(operation: string, call: (provider: BlockchainProvider) => Promise<T>): Promise<T> {
    const errors: string[] = [];
    let skipped = 0;

    for (const provider of this.providers) {
      const breaker = this.breakers.get(provider.name);
      if (breaker && !breaker.canAttempt()) {
        skipped += 1;
        continue;
      }

      try {
        const result = await call(provider);
        breaker?.recordSuccess();
        return result;
      } catch (error) {
        breaker?.recordFailure();
        this.onProviderError(provider.name, error);
        errors.push(`${provider.name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    throw new ProviderUnavailableError(
      this.name,
      `All ${this.providers.length} provider(s) failed for ${operation} ` +
        `(${skipped} skipped by an open circuit). ${errors.join('; ')}`,
    );
  }

  async getTransactionReceipt(transactionHash: string): Promise<TransactionReceiptView | null> {
    return this.run('getTransactionReceipt', (provider) =>
      provider.getTransactionReceipt(transactionHash),
    );
  }

  async getBlockNumber(): Promise<bigint> {
    return this.run('getBlockNumber', (provider) => provider.getBlockNumber());
  }

  async healthCheck(): Promise<boolean> {
    for (const provider of this.providers) {
      try {
        if (await provider.healthCheck()) {
          return true;
        }
      } catch {
        // A failing health check is the expected case here, not an exception
        // worth propagating — we only care whether any provider is usable.
      }
    }
    return false;
  }

  /** Per-provider breaker state, surfaced on /metrics and in the admin console. */
  status(): readonly { provider: string; state: CircuitState; consecutiveFailures: number }[] {
    return this.providers.map((provider) => {
      const snapshot = this.breakers.get(provider.name)?.snapshot();
      return {
        provider: provider.name,
        state: snapshot?.state ?? 'CLOSED',
        consecutiveFailures: snapshot?.consecutiveFailures ?? 0,
      };
    });
  }
}

import { describe, expect, it, vi } from 'vitest';
import { CircuitBreaker } from './circuit-breaker.js';
import { FailoverBlockchainProvider } from './failover-provider.js';
import {
  ProviderUnavailableError,
  type BlockchainProvider,
  type TransactionReceiptView,
} from './types.js';

function receipt(): TransactionReceiptView {
  return {
    transactionHash: `0x${'ab'.repeat(32)}`,
    status: 'success',
    blockNumber: 100n,
    blockHash: `0x${'cd'.repeat(32)}`,
    from: '0x3333333333333333333333333333333333333333',
    to: null,
    logs: [],
  };
}

function provider(
  name: string,
  behaviour: {
    receipt?: TransactionReceiptView | null;
    head?: bigint;
    fail?: boolean;
    chainId?: number;
    healthy?: boolean;
  } = {},
): BlockchainProvider & { receiptCalls: number } {
  const instance = {
    chainId: behaviour.chainId ?? 84532,
    name,
    receiptCalls: 0,
    async getTransactionReceipt() {
      instance.receiptCalls += 1;
      if (behaviour.fail) throw new ProviderUnavailableError(name, 'down');
      return behaviour.receipt === undefined ? receipt() : behaviour.receipt;
    },
    async getBlockNumber() {
      if (behaviour.fail) throw new ProviderUnavailableError(name, 'down');
      return behaviour.head ?? 100n;
    },
    async healthCheck() {
      if (behaviour.healthy === undefined) return !behaviour.fail;
      return behaviour.healthy;
    },
  };
  return instance;
}

describe('CircuitBreaker', () => {
  it('starts closed and admits calls', () => {
    const breaker = new CircuitBreaker({ failureThreshold: 3, resetTimeoutMs: 1_000 });
    expect(breaker.state).toBe('CLOSED');
    expect(breaker.canAttempt()).toBe(true);
  });

  it('opens after the configured number of consecutive failures', () => {
    const breaker = new CircuitBreaker({ failureThreshold: 3, resetTimeoutMs: 1_000 });
    breaker.recordFailure();
    breaker.recordFailure();
    expect(breaker.state).toBe('CLOSED');
    breaker.recordFailure();
    expect(breaker.state).toBe('OPEN');
    expect(breaker.canAttempt()).toBe(false);
  });

  it('resets the failure count on any success', () => {
    const breaker = new CircuitBreaker({ failureThreshold: 3, resetTimeoutMs: 1_000 });
    breaker.recordFailure();
    breaker.recordFailure();
    breaker.recordSuccess();
    breaker.recordFailure();
    expect(breaker.state).toBe('CLOSED');
  });

  it('moves to half-open after the cooldown and admits exactly one probe', () => {
    let now = 0;
    const breaker = new CircuitBreaker({
      failureThreshold: 1,
      resetTimeoutMs: 1_000,
      now: () => now,
    });
    breaker.recordFailure();
    expect(breaker.state).toBe('OPEN');

    now = 1_000;
    expect(breaker.state).toBe('HALF_OPEN');
    // Exactly one probe: letting the whole backlog through would re-overload a
    // provider that is only just recovering.
    expect(breaker.canAttempt()).toBe(true);
    expect(breaker.canAttempt()).toBe(false);
  });

  it('closes again when the probe succeeds', () => {
    let now = 0;
    const breaker = new CircuitBreaker({
      failureThreshold: 1,
      resetTimeoutMs: 1_000,
      now: () => now,
    });
    breaker.recordFailure();
    now = 1_000;
    breaker.canAttempt();
    breaker.recordSuccess();
    expect(breaker.state).toBe('CLOSED');
  });

  it('re-opens when the probe fails', () => {
    let now = 0;
    const breaker = new CircuitBreaker({
      failureThreshold: 1,
      resetTimeoutMs: 1_000,
      now: () => now,
    });
    breaker.recordFailure();
    now = 1_000;
    breaker.canAttempt();
    breaker.recordFailure();
    expect(breaker.state).toBe('OPEN');
  });

  it('rejects a nonsensical threshold', () => {
    expect(() => new CircuitBreaker({ failureThreshold: 0, resetTimeoutMs: 1 })).toThrow();
  });
});

describe('FailoverBlockchainProvider', () => {
  it('uses the primary when it is healthy', async () => {
    const primary = provider('primary');
    const secondary = provider('secondary');
    const failover = new FailoverBlockchainProvider([primary, secondary]);

    await failover.getTransactionReceipt('0xabc');
    expect(primary.receiptCalls).toBe(1);
    expect(secondary.receiptCalls).toBe(0);
  });

  it('falls back to the secondary when the primary fails', async () => {
    const primary = provider('primary', { fail: true });
    const secondary = provider('secondary');
    const failover = new FailoverBlockchainProvider([primary, secondary]);

    const result = await failover.getTransactionReceipt('0xabc');
    expect(result).not.toBeNull();
    expect(secondary.receiptCalls).toBe(1);
  });

  it('treats a null receipt as an answer, not a failure', async () => {
    // "I have never heard of this transaction" is a real answer. Fanning out
    // to every provider for it would multiply the cost of polling every
    // pending payment.
    const primary = provider('primary', { receipt: null });
    const secondary = provider('secondary');
    const failover = new FailoverBlockchainProvider([primary, secondary]);

    expect(await failover.getTransactionReceipt('0xabc')).toBeNull();
    expect(secondary.receiptCalls).toBe(0);
  });

  it('throws ProviderUnavailableError when every provider fails', async () => {
    const failover = new FailoverBlockchainProvider([
      provider('primary', { fail: true }),
      provider('secondary', { fail: true }),
    ]);
    await expect(failover.getTransactionReceipt('0xabc')).rejects.toThrow(ProviderUnavailableError);
  });

  it('stops calling a provider once its circuit opens', async () => {
    const primary = provider('primary', { fail: true });
    const secondary = provider('secondary');
    const failover = new FailoverBlockchainProvider([primary, secondary], {
      failureThreshold: 2,
      resetTimeoutMs: 60_000,
    });

    await failover.getTransactionReceipt('0x1');
    await failover.getTransactionReceipt('0x2');
    expect(primary.receiptCalls).toBe(2);

    // Circuit is now open: the third call must skip the primary entirely
    // rather than absorbing its timeout again.
    await failover.getTransactionReceipt('0x3');
    expect(primary.receiptCalls).toBe(2);
    expect(secondary.receiptCalls).toBe(3);
    expect(failover.status()[0]).toMatchObject({ provider: 'primary', state: 'OPEN' });
  });

  it('reports errors through the callback for alerting', async () => {
    const onProviderError = vi.fn();
    const failover = new FailoverBlockchainProvider(
      [provider('primary', { fail: true }), provider('secondary')],
      {
        onProviderError,
      },
    );
    await failover.getTransactionReceipt('0xabc');
    expect(onProviderError).toHaveBeenCalledWith('primary', expect.any(ProviderUnavailableError));
  });

  it('refuses to pool providers serving different chains', () => {
    // A Base Sepolia node answering a Base mainnet verification would be a
    // catastrophic correctness failure, so this is rejected at construction.
    expect(
      () =>
        new FailoverBlockchainProvider([
          provider('primary', { chainId: 84532 }),
          provider('secondary', { chainId: 8453 }),
        ]),
    ).toThrow(/same chain/);
  });

  it('requires at least one provider', () => {
    expect(() => new FailoverBlockchainProvider([])).toThrow(/at least one/);
  });

  it('is healthy when any provider is healthy', async () => {
    const failover = new FailoverBlockchainProvider([
      provider('primary', { fail: true, healthy: false }),
      provider('secondary', { healthy: true }),
    ]);
    expect(await failover.healthCheck()).toBe(true);
  });

  it('is unhealthy when no provider is healthy', async () => {
    const failover = new FailoverBlockchainProvider([
      provider('primary', { fail: true, healthy: false }),
      provider('secondary', { fail: true, healthy: false }),
    ]);
    expect(await failover.healthCheck()).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { err, ok, type Result } from '@meter402/shared';
import {
  determineSettlement,
  type AuthorizationQuery,
  type OracleFailure,
  type SettlementOracle,
} from './settlement-oracle.js';

/**
 * The reconciliation decision function.
 *
 * Every branch is tested because the whole value of this module is that it
 * refuses to guess — and "refuses to guess" is only true if the undetermined
 * branch is genuinely reachable and genuinely distinct from failure.
 */

const QUERY: AuthorizationQuery = {
  chainId: 84532,
  assetAddress: '0x036cbd53842c5426634e7929541ec2318f3dcf7e',
  payerAddress: '0x70997970c51812dc3a010c7d01b50e0d17dc79c8',
  authorizationNonce: `0x${'a'.repeat(64)}`,
};

const TX = `0x${'b'.repeat(64)}`;

function oracle(options: {
  used?: Result<boolean, OracleFailure>;
  transaction?: Result<string | null, OracleFailure>;
}): SettlementOracle {
  return {
    async authorizationUsed() {
      return options.used ?? ok(false);
    },
    async findSettlementTransaction() {
      return options.transaction ?? ok(TX);
    },
  };
}

const base = {
  query: QUERY,
  recipientAddress: '0x209693bc6afc0c5328ba36faf03c514ef312287c',
  amountMinorUnits: 30_000n,
};

describe('determineSettlement', () => {
  it('reports SETTLED when the authorization was consumed', async () => {
    const result = await determineSettlement(oracle({ used: ok(true) }), {
      ...base,
      validBefore: new Date(Date.now() + 60_000),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({ outcome: 'SETTLED', transactionHash: TX });
  });

  it('still reports SETTLED when the transaction cannot be located', async () => {
    /*
     * `authorizationState` is the authoritative fact. A missing transaction
     * hash — pruned logs, a lagging indexer — costs provenance, not money, so
     * the payment is still confirmed.
     */
    const result = await determineSettlement(oracle({ used: ok(true), transaction: ok(null) }), {
      ...base,
      validBefore: new Date(Date.now() + 60_000),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({ outcome: 'SETTLED', transactionHash: null });
  });

  it('still reports SETTLED when the transaction lookup itself fails', async () => {
    const result = await determineSettlement(
      oracle({
        used: ok(true),
        transaction: err({ kind: 'UNAVAILABLE', message: 'log range unavailable' }),
      }),
      { ...base, validBefore: new Date(Date.now() + 60_000) },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.outcome).toBe('SETTLED');
  });

  it('reports NEVER_SETTLED only once the authorization can no longer be used', async () => {
    const result = await determineSettlement(oracle({ used: ok(false) }), {
      ...base,
      validBefore: new Date(Date.now() - 1000),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({ outcome: 'NEVER_SETTLED' });
  });

  it('reports UNDETERMINED while an unused authorization is still valid', async () => {
    /*
     * The decisive case. The authorization has not been used *yet*, and anyone
     * holding it can still submit it. Calling this a failure would let a
     * payment that is about to succeed be marked failed.
     */
    const result = await determineSettlement(oracle({ used: ok(false) }), {
      ...base,
      validBefore: new Date(Date.now() + 60_000),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.outcome).toBe('UNDETERMINED');
  });

  it('reports UNDETERMINED when there is no deadline to reason about', async () => {
    const result = await determineSettlement(oracle({ used: ok(false) }), {
      ...base,
      validBefore: null,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.outcome).toBe('UNDETERMINED');
  });

  it('fails rather than concluding anything when the chain is unreachable', async () => {
    const result = await determineSettlement(
      oracle({ used: err({ kind: 'UNAVAILABLE', message: 'rpc down' }) }),
      { ...base, validBefore: new Date(Date.now() - 1000) },
    );

    // An unreachable chain past the deadline must NOT become NEVER_SETTLED.
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('UNAVAILABLE');
  });

  it('treats the deadline boundary as still-valid rather than expired', async () => {
    const validBefore = new Date();
    const result = await determineSettlement(oracle({ used: ok(false) }), {
      ...base,
      validBefore,
      now: validBefore,
    });

    // Exactly at the boundary the authorization is not yet past it, so the
    // safe answer is undetermined rather than final.
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.outcome).toBe('UNDETERMINED');
  });
});

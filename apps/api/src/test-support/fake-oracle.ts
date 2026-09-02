import { createHash } from 'node:crypto';
import { err, ok, type Result } from '@meter402/shared';
import type { AuthorizationQuery, OracleFailure, SettlementOracle } from '@meter402/blockchain';

/**
 * A controllable settlement oracle, for reconciliation tests.
 *
 * Stands in for the chain so that the three outcomes reconciliation must
 * distinguish — settled, definitively never settled, and genuinely unknown —
 * can each be produced on demand. Provoking those against a real testnet would
 * mean waiting out an authorization deadline and deliberately breaking an RPC.
 *
 * As with `FakeFacilitator`: this proves Meter402 reacts correctly to each
 * answer. It does not prove anything about a real chain.
 */
export class FakeSettlementOracle implements SettlementOracle {
  readonly authorizationQueries: AuthorizationQuery[] = [];

  /** What the token contract's `authorizationState` should report. */
  used: boolean | 'UNAVAILABLE' = false;
  /**
   * Seed for the transaction that consumed the authorization.
   *
   * Not returned directly — see `hashFor`, which derives a distinct hash per
   * authorization from it.
   */
  transactionHash: string | null = null;
  private readonly pinnedHashes = new Map<string, string>();
  transactionLookup: 'FOUND' | 'NOT_FOUND' | 'UNAVAILABLE' = 'FOUND';

  async authorizationUsed(query: AuthorizationQuery): Promise<Result<boolean, OracleFailure>> {
    this.authorizationQueries.push(query);
    if (this.used === 'UNAVAILABLE') {
      return err({ kind: 'UNAVAILABLE', message: 'rpc unreachable' });
    }
    return ok(this.used);
  }

  async findSettlementTransaction(
    query: AuthorizationQuery,
  ): Promise<Result<string | null, OracleFailure>> {
    if (this.transactionLookup === 'UNAVAILABLE') {
      return err({ kind: 'UNAVAILABLE', message: 'log range unavailable' });
    }
    if (this.transactionLookup === 'NOT_FOUND') {
      return ok(null);
    }
    /*
     * One transaction per authorization, mirroring the chain: an EIP-3009
     * authorization is consumed by exactly one transfer, and no two
     * authorizations share one. Returning a single hash for every query would
     * make the transaction-replay guard reject every settlement after the
     * first — a correct rejection of a situation that cannot occur.
     */
    return ok(this.hashFor(query.authorizationNonce));
  }

  private hashFor(nonce: string): string | null {
    if (this.transactionHash === null) return null;
    const pinned = this.pinnedHashes.get(nonce.toLowerCase());
    if (pinned) return pinned;

    /*
     * Derived from the seed and the nonce so it is deterministic within a run
     * and distinct between authorizations.
     */
    const derived = `0x${createHash('sha256')
      .update(`${this.transactionHash}:${nonce.toLowerCase()}`)
      .digest('hex')}`;
    this.pinnedHashes.set(nonce.toLowerCase(), derived);
    return derived;
  }

  /** The chain says the transfer happened, at this transaction. */
  settled(transactionHash: string): void {
    this.used = true;
    this.transactionHash = transactionHash;
    this.transactionLookup = 'FOUND';
  }

  /**
   * Pin the exact hash reported for one authorization.
   *
   * For the tests that assert on the recorded hash rather than merely on the
   * outcome.
   */
  settledAt(authorizationNonce: string, transactionHash: string): void {
    this.settled(transactionHash);
    this.pinnedHashes.set(authorizationNonce.toLowerCase(), transactionHash);
  }

  /** The authorization was never consumed. */
  neverSettled(): void {
    this.used = false;
    this.transactionHash = null;
  }

  unavailable(): void {
    this.used = 'UNAVAILABLE';
  }
}

import { err, ok, type Result } from '@meter402/shared';

/**
 * The settlement oracle.
 *
 * Answers one question definitively: **did this signed authorization actually
 * move money?**
 *
 * ── Why the chain, and not the facilitator ───────────────────────────────
 * When a `/settle` response is lost, asking the facilitator again is the
 * obvious move and the wrong one. It is the party whose answer we already
 * failed to receive, it may itself be the thing that is broken, and — worst —
 * asking it to settle again risks a second transaction. The chain has no such
 * problems: it is the authority on whether the transfer happened, it cannot be
 * made to do it twice by being asked, and reading it is free of side effects.
 *
 * ── Why EIP-3009 makes this exact rather than heuristic ──────────────────
 * EIP-3009 exposes `authorizationState(authorizer, nonce) -> bool`. The token
 * contract sets it when a `transferWithAuthorization` succeeds, and the same
 * nonce can never be used twice. So:
 *
 *   used = true            the transfer happened. Definitive.
 *   used = false, now > validBefore
 *                          the authorization has expired unused and can never
 *                          be used again. Definitively no transfer. Also
 *                          definitive.
 *   used = false, still valid
 *                          undetermined — it may yet settle. Retry later.
 *
 * There is no fourth case in which we invent an answer. That is the whole
 * point: reconciliation determines what already happened, it does not decide
 * what should have happened.
 */

/** `authorizationState(address,bytes32)` — the EIP-3009 replay-state getter. */
export const EIP3009_AUTHORIZATION_STATE_ABI = [
  {
    type: 'function',
    name: 'authorizationState',
    stateMutability: 'view',
    inputs: [
      { name: 'authorizer', type: 'address' },
      { name: 'nonce', type: 'bytes32' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const;

export interface AuthorizationQuery {
  readonly chainId: number;
  readonly assetAddress: string;
  readonly payerAddress: string;
  readonly authorizationNonce: string;
}

export interface OracleFailure {
  /**
   * `UNAVAILABLE` means we could not reach the chain — retryable, and
   * emphatically not evidence of anything. `UNSUPPORTED` means we cannot ask
   * this question on this chain at all, which is a configuration bug.
   */
  readonly kind: 'UNAVAILABLE' | 'UNSUPPORTED';
  readonly message: string;
}

/**
 * What reconciliation concluded. Deliberately three-valued: `UNDETERMINED` is
 * a first-class answer, not an error, and collapsing it into either of the
 * others is the mistake this whole module exists to avoid.
 */
export type SettlementDetermination =
  | { readonly outcome: 'SETTLED'; readonly transactionHash: string | null }
  | { readonly outcome: 'NEVER_SETTLED' }
  | { readonly outcome: 'UNDETERMINED'; readonly reason: string };

export interface SettlementOracle {
  /** True when the token contract has consumed this authorization nonce. */
  authorizationUsed(query: AuthorizationQuery): Promise<Result<boolean, OracleFailure>>;

  /**
   * Best-effort lookup of the transaction that consumed the authorization.
   *
   * Returns null when the transfer is known to have happened but the specific
   * transaction cannot be located — which is a real possibility if the log
   * range has been pruned. Reconciliation still confirms the payment in that
   * case: `authorizationState` is the authoritative fact, and a missing hash
   * is missing provenance rather than missing money.
   */
  findSettlementTransaction(
    query: AuthorizationQuery & { recipientAddress: string; amountMinorUnits: bigint },
  ): Promise<Result<string | null, OracleFailure>>;
}

export interface DetermineInput {
  readonly query: AuthorizationQuery;
  readonly recipientAddress: string;
  readonly amountMinorUnits: bigint;
  /** The authorization's `validBefore`, as a Date. */
  readonly validBefore: Date | null;
  readonly now?: Date;
}

/**
 * Turn an oracle reading into a determination.
 *
 * A pure decision function over the oracle's answers, so every branch —
 * including the ones that are impractical to provoke against a real chain — is
 * reachable from a unit test.
 */
export async function determineSettlement(
  oracle: SettlementOracle,
  input: DetermineInput,
): Promise<Result<SettlementDetermination, OracleFailure>> {
  const now = input.now ?? new Date();

  const used = await oracle.authorizationUsed(input.query);
  if (!used.ok) {
    // Could not reach the chain. That is not evidence of anything.
    return err(used.error);
  }

  if (used.value) {
    /*
     * The authorization was consumed, so the transfer happened. Try to name
     * the transaction for the receipt; failing to find it does not change the
     * conclusion, only the provenance we can record.
     */
    const transaction = await oracle.findSettlementTransaction({
      ...input.query,
      recipientAddress: input.recipientAddress,
      amountMinorUnits: input.amountMinorUnits,
    });
    return ok({
      outcome: 'SETTLED',
      transactionHash: transaction.ok ? transaction.value : null,
    });
  }

  /*
   * Unused. Whether that is final depends entirely on the deadline: before it,
   * the authorization can still be submitted by anyone holding it.
   */
  if (input.validBefore && now.getTime() > input.validBefore.getTime()) {
    return ok({ outcome: 'NEVER_SETTLED' });
  }

  return ok({
    outcome: 'UNDETERMINED',
    reason: input.validBefore
      ? `Authorization is unused but still valid until ${input.validBefore.toISOString()}.`
      : 'Authorization is unused and has no known deadline.',
  });
}

import { and, eq } from 'drizzle-orm';
import { newId } from '@meter402/shared';
import type { QueryExecutor } from './client.js';
import { paymentAuthorizations } from './schema/settlement.js';

/**
 * Replay protection for signed, pre-settlement payment authorizations.
 *
 * This is the sibling of `DrizzleReplayGuard`, and the two protect different
 * windows of the same payment:
 *
 *   DrizzleReplayGuard          one settlement transaction, one payment
 *   DrizzleAuthorizationGuard   one signed authorization, one payment request
 *
 * The second is not redundant. An EIP-3009 authorization is a bearer
 * instrument: signed by the payer, valid until `validBefore`, and replayable
 * by anyone who observes it. The transaction guard cannot help here, because
 * before settlement there is no transaction hash to claim — so without this
 * table an attacker could present one captured authorization against many
 * payment requests concurrently, and every one of them would verify.
 *
 * The claim is a single `INSERT ... ON CONFLICT DO NOTHING`. Atomic: either
 * this transaction owns the authorization or somebody else already does.
 * There is no window between checking and claiming, because there is no check.
 */

export interface AuthorizationClaim {
  readonly paymentRequestId: string;
  readonly protocol: string;
  readonly protocolVersion: number;
  readonly scheme: string;
  readonly chainId: number;
  readonly assetAddress: string;
  readonly payerAddress: string;
  readonly authorizationNonce: string;
  readonly validAfter?: Date | null;
  readonly validBefore?: Date | null;
  readonly facilitator?: string | null;
}

export type AuthorizationClaimResult =
  | { readonly claimed: true }
  | { readonly claimed: false; readonly existingPaymentRequestId: string };

export class DrizzleAuthorizationGuard {
  constructor(
    private readonly db: QueryExecutor,
    private readonly organizationId: string,
  ) {}

  async claim(input: AuthorizationClaim): Promise<AuthorizationClaimResult> {
    /*
     * Normalised before claiming. Addresses and nonces arrive from a client in
     * whatever casing it chose; two spellings of one authorization must not be
     * able to occupy two rows and walk straight past the constraint.
     */
    const assetAddress = input.assetAddress.toLowerCase();
    const payerAddress = input.payerAddress.toLowerCase();
    const authorizationNonce = input.authorizationNonce.toLowerCase();

    const inserted = await this.db
      .insert(paymentAuthorizations)
      .values({
        id: newId('paymentAuthorization'),
        organizationId: this.organizationId,
        paymentRequestId: input.paymentRequestId,
        protocol: input.protocol,
        protocolVersion: input.protocolVersion,
        scheme: input.scheme,
        chainId: input.chainId,
        assetAddress,
        payerAddress,
        authorizationNonce,
        validAfter: input.validAfter ?? null,
        validBefore: input.validBefore ?? null,
        facilitator: input.facilitator ?? null,
      })
      .onConflictDoNothing({
        target: [
          paymentAuthorizations.chainId,
          paymentAuthorizations.assetAddress,
          paymentAuthorizations.payerAddress,
          paymentAuthorizations.authorizationNonce,
        ],
      })
      .returning({ id: paymentAuthorizations.id });

    if (inserted.length > 0) {
      return { claimed: true };
    }

    /*
     * We lost the race. Read who won — purely to report it. The read happens
     * only after the insert has already failed, so it cannot reintroduce the
     * check-then-write gap the insert exists to close.
     *
     * Deliberately NOT scoped to this organization: the constraint is global
     * because an authorization is global. If another tenant claimed it, this
     * caller must still be refused, so the lookup has to be able to see it.
     */
    const existing = await this.db
      .select({ paymentRequestId: paymentAuthorizations.paymentRequestId })
      .from(paymentAuthorizations)
      .where(
        and(
          eq(paymentAuthorizations.chainId, input.chainId),
          eq(paymentAuthorizations.assetAddress, assetAddress),
          eq(paymentAuthorizations.payerAddress, payerAddress),
          eq(paymentAuthorizations.authorizationNonce, authorizationNonce),
        ),
      )
      .limit(1);

    const owner = existing[0]?.paymentRequestId;
    if (owner === undefined) {
      /*
       * The insert conflicted but the row is gone. Should be unreachable —
       * these rows are never deleted while a payment request references them.
       * Fail closed: an unknown owner makes the caller reject the payment,
       * which is the safe direction.
       */
      return { claimed: false, existingPaymentRequestId: '<unknown>' };
    }
    return { claimed: false, existingPaymentRequestId: owner };
  }
}

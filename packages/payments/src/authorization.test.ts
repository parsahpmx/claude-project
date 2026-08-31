import { describe, expect, it, vi } from 'vitest';
import { MerchantEnvironment, Money, USDC_BASE_SEPOLIA, err, ok } from '@meter402/shared';
import { authorizePayment } from './authorization.js';
import { PaymentStatus } from './status.js';
import { createPaymentRequest, type PaymentRequest } from './payment-request.js';
import type { PaymentProof } from './protocol.js';
import {
  verificationFailure,
  type ReplayGuard,
  type ReplayClaimResult,
  type SettlementVerifier,
  type VerificationFailure,
  type VerifiedTransfer,
} from './verification.js';

const MERCHANT_WALLET = '0x1111111111111111111111111111111111111111';
const ATTACKER_WALLET = '0x2222222222222222222222222222222222222222';
const AGENT_WALLET = '0x3333333333333333333333333333333333333333';
const TX_HASH = `0x${'ab'.repeat(32)}`;

const ISSUED_AT = new Date('2026-01-01T00:00:00.000Z');
const WITHIN_WINDOW = new Date('2026-01-01T00:01:00.000Z');
const AFTER_WINDOW = new Date('2026-01-01T00:10:00.000Z');

function buildRequest(overrides: Partial<PaymentRequest> = {}): PaymentRequest {
  const base = createPaymentRequest({
    organizationId: 'org_test',
    projectId: 'prj_test',
    endpointId: 'ep_test',
    environment: MerchantEnvironment.Test,
    amount: Money.fromDecimalString('0.03', 'USDC', 6),
    asset: USDC_BASE_SEPOLIA,
    recipientAddress: MERCHANT_WALLET,
    ttlSeconds: 300,
    now: ISSUED_AT,
  });
  return { ...base, status: PaymentStatus.ChallengeIssued, ...overrides };
}

function buildTransfer(overrides: Partial<VerifiedTransfer> = {}): VerifiedTransfer {
  return {
    transactionHash: TX_HASH,
    chainId: USDC_BASE_SEPOLIA.chainId,
    tokenAddress: USDC_BASE_SEPOLIA.address,
    from: AGENT_WALLET,
    to: MERCHANT_WALLET,
    minorUnits: 30_000n,
    blockNumber: 1_000n,
    blockHash: `0x${'cd'.repeat(32)}`,
    confirmations: 5,
    logIndex: 0,
    observedAt: WITHIN_WINDOW,
    ...overrides,
  };
}

function verifierReturning(
  result: VerifiedTransfer | VerificationFailure,
): SettlementVerifier & { calls: number } {
  const verifier = {
    calls: 0,
    async verifyTransfer() {
      verifier.calls += 1;
      return 'reason' in result ? err(result) : ok(result);
    },
  };
  return verifier;
}

function guardReturning(result: ReplayClaimResult): ReplayGuard & { calls: number } {
  const guard = {
    calls: 0,
    async claim() {
      guard.calls += 1;
      return result;
    },
  };
  return guard;
}

const CLAIMED: ReplayClaimResult = { claimed: true };

function proof(overrides: Partial<PaymentProof> = {}): PaymentProof {
  return {
    protocol: 'x402',
    transactionHash: TX_HASH,
    payer: AGENT_WALLET,
    nonce: null,
    raw: {},
    ...overrides,
  };
}

async function authorize(options: {
  request?: PaymentRequest;
  proof?: PaymentProof;
  verifier?: SettlementVerifier;
  replayGuard?: ReplayGuard;
  now?: Date;
  requiredConfirmations?: number;
}) {
  return authorizePayment({
    request: options.request ?? buildRequest(),
    proof: options.proof ?? proof(),
    verifier: options.verifier ?? verifierReturning(buildTransfer()),
    replayGuard: options.replayGuard ?? guardReturning(CLAIMED),
    requiredConfirmations: options.requiredConfirmations ?? 3,
    now: options.now ?? WITHIN_WINDOW,
  });
}

describe('authorizePayment — success', () => {
  it('authorises a correct payment and marks it CONFIRMED', async () => {
    const result = await authorize({});
    expect(result.decision).toBe('AUTHORIZED');
    expect(result.nextStatus).toBe(PaymentStatus.Confirmed);
    expect(result.transfer?.transactionHash).toBe(TX_HASH);
    expect(result.failure).toBeNull();
  });

  it('accepts an overpayment', async () => {
    // Agents may round up to avoid a shortfall from a stale quote. Refusing an
    // overpayment would strand the money, so >= is the rule.
    const verifier = verifierReturning(buildTransfer({ minorUnits: 50_000n }));
    const result = await authorize({ verifier });
    expect(result.decision).toBe('AUTHORIZED');
  });

  it('accepts an address that differs only in checksum casing', async () => {
    // RPCs and merchant config disagree on EIP-55 casing constantly. Treating
    // that as a wrong recipient would reject valid payments.
    const verifier = verifierReturning(buildTransfer({ to: MERCHANT_WALLET.toUpperCase() }));
    const result = await authorize({ verifier });
    expect(result.decision).toBe('AUTHORIZED');
  });

  it('is idempotent when the same transaction is re-presented for the same request', async () => {
    const guard = guardReturning({ claimed: false, existingPaymentRequestId: 'SELF' });
    const request = buildRequest();
    const result = await authorizePayment({
      request,
      proof: proof(),
      verifier: verifierReturning(buildTransfer()),
      replayGuard: {
        async claim() {
          return { claimed: false, existingPaymentRequestId: request.id };
        },
      },
      requiredConfirmations: 3,
      now: WITHIN_WINDOW,
    });
    expect(result.decision).toBe('AUTHORIZED');
    expect(guard.calls).toBe(0);
  });

  it('returns success without re-verifying an already CONFIRMED request', async () => {
    // A retry of a call that was already paid for must succeed without
    // charging again.
    const verifier = verifierReturning(buildTransfer());
    const result = await authorize({
      request: buildRequest({ status: PaymentStatus.Confirmed }),
      verifier,
    });
    expect(result.decision).toBe('AUTHORIZED');
    expect(verifier.calls).toBe(0);
  });
});

describe('authorizePayment — rejections required by product rule 160', () => {
  it('rejects a payment sent to the wrong recipient', async () => {
    const verifier = verifierReturning(buildTransfer({ to: ATTACKER_WALLET }));
    const result = await authorize({ verifier });
    expect(result.decision).toBe('REJECTED');
    expect(result.failure?.reason).toBe('WRONG_RECIPIENT');
    expect(result.nextStatus).toBe(PaymentStatus.Failed);
  });

  it('rejects an underpayment', async () => {
    const verifier = verifierReturning(buildTransfer({ minorUnits: 29_999n }));
    const result = await authorize({ verifier });
    expect(result.decision).toBe('REJECTED');
    expect(result.failure?.reason).toBe('WRONG_AMOUNT');
    expect(result.failure?.details).toMatchObject({ expected: '30000', observed: '29999' });
  });

  it('rejects a transfer observed on the wrong network', async () => {
    const verifier = verifierReturning(buildTransfer({ chainId: 8453 }));
    const result = await authorize({ verifier });
    expect(result.decision).toBe('REJECTED');
    expect(result.failure?.reason).toBe('WRONG_NETWORK');
  });

  it('rejects a transfer of the wrong token', async () => {
    const verifier = verifierReturning(
      buildTransfer({ tokenAddress: '0x9999999999999999999999999999999999999999' }),
    );
    const result = await authorize({ verifier });
    expect(result.decision).toBe('REJECTED');
    expect(result.failure?.reason).toBe('WRONG_ASSET');
  });

  it('rejects an expired payment request', async () => {
    const result = await authorize({ now: AFTER_WINDOW });
    expect(result.decision).toBe('REJECTED');
    expect(result.failure?.reason).toBe('REQUEST_EXPIRED');
    expect(result.nextStatus).toBe(PaymentStatus.Expired);
  });

  it('rejects a transaction already used by a different payment request', async () => {
    const guard = guardReturning({ claimed: false, existingPaymentRequestId: 'preq_someone_else' });
    const result = await authorize({ replayGuard: guard });
    expect(result.decision).toBe('REJECTED');
    expect(result.failure?.reason).toBe('TRANSACTION_ALREADY_USED');
  });

  it('rejects a reverted transaction', async () => {
    const verifier = verifierReturning(
      verificationFailure('TRANSACTION_REVERTED', 'Transaction reverted on chain.'),
    );
    const result = await authorize({ verifier });
    expect(result.decision).toBe('REJECTED');
    expect(result.nextStatus).toBe(PaymentStatus.Failed);
  });
});

describe('authorizePayment — proof validation', () => {
  it.each([
    ['not-hex', 'non-hex string'],
    ['0x1234', 'too short'],
    [`0x${'ab'.repeat(33)}`, 'too long'],
    ['', 'empty'],
    [`0x${'ab'.repeat(31)}zz`, 'invalid hex characters'],
  ])('rejects a malformed transaction hash %s (%s)', async (hash) => {
    const verifier = verifierReturning(buildTransfer());
    const result = await authorize({ proof: proof({ transactionHash: hash }), verifier });
    expect(result.decision).toBe('REJECTED');
    expect(result.failure?.reason).toBe('MALFORMED_PROOF');
    // A malformed proof must never reach an RPC provider: it would turn a
    // cheap forged request into an expensive upstream call.
    expect(verifier.calls).toBe(0);
  });

  it('rejects a proof carrying a nonce from a different challenge', async () => {
    const verifier = verifierReturning(buildTransfer());
    const result = await authorize({ proof: proof({ nonce: 'SOMEONE_ELSES_NONCE' }), verifier });
    expect(result.decision).toBe('REJECTED');
    expect(result.failure?.reason).toBe('MALFORMED_PROOF');
    expect(verifier.calls).toBe(0);
  });

  it('accepts a proof echoing the correct nonce', async () => {
    const request = buildRequest();
    const result = await authorize({ request, proof: proof({ nonce: request.nonce }) });
    expect(result.decision).toBe('AUTHORIZED');
  });
});

describe('authorizePayment — degraded infrastructure must not fail a payment', () => {
  it('holds a payment PENDING when the RPC provider is unavailable', async () => {
    // Product rule 149. Marking this FAILED would tell an agent that already
    // paid that it did not, inviting a double payment.
    const verifier = verifierReturning(
      verificationFailure('PROVIDER_UNAVAILABLE', 'All RPC providers failed.'),
    );
    const result = await authorize({ verifier });
    expect(result.decision).toBe('PENDING');
    expect(result.nextStatus).toBe(PaymentStatus.Pending);
  });

  it('holds a payment PENDING when the transaction is not visible yet', async () => {
    const verifier = verifierReturning(
      verificationFailure('TRANSACTION_NOT_FOUND', 'Not yet indexed.'),
    );
    const result = await authorize({ verifier });
    expect(result.decision).toBe('PENDING');
    expect(result.nextStatus).toBe(PaymentStatus.Pending);
  });

  it('moves to CONFIRMING while below the finality threshold', async () => {
    const verifier = verifierReturning(
      verificationFailure('INSUFFICIENT_CONFIRMATIONS', '1 of 3 confirmations.', {
        confirmations: 1,
        required: 3,
      }),
    );
    const result = await authorize({ verifier });
    expect(result.decision).toBe('PENDING');
    expect(result.nextStatus).toBe(PaymentStatus.Confirming);
  });

  it('does not claim the transaction hash when verification fails', async () => {
    // Claiming before verification would let an attacker burn a legitimate
    // transaction hash by submitting it against a request it does not satisfy.
    const guard = guardReturning(CLAIMED);
    await authorize({
      verifier: verifierReturning(buildTransfer({ to: ATTACKER_WALLET })),
      replayGuard: guard,
    });
    expect(guard.calls).toBe(0);
  });
});

describe('authorizePayment — request lifecycle guards', () => {
  it.each([PaymentStatus.Failed, PaymentStatus.Expired, PaymentStatus.Cancelled])(
    'refuses to accept payment into a %s request',
    async (status) => {
      const verifier = verifierReturning(buildTransfer());
      const result = await authorize({ request: buildRequest({ status }), verifier });
      expect(result.decision).toBe('REJECTED');
      expect(result.failure?.reason).toBe('REQUEST_NOT_PAYABLE');
      expect(verifier.calls).toBe(0);
    },
  );

  it('does not enforce expiry once a transaction is already in flight', async () => {
    // Submitted before the deadline, still confirming after it. The agent has
    // already paid; expiring here would take the money without serving.
    const result = await authorize({
      request: buildRequest({ status: PaymentStatus.Submitted }),
      now: AFTER_WINDOW,
    });
    expect(result.decision).toBe('AUTHORIZED');
  });

  it('does not call the chain for an expired request', async () => {
    const verifier = verifierReturning(buildTransfer());
    await authorize({ now: AFTER_WINDOW, verifier });
    expect(verifier.calls).toBe(0);
  });

  it('passes the configured confirmation threshold through to the verifier', async () => {
    const verifyTransfer = vi.fn().mockResolvedValue(ok(buildTransfer()));
    await authorizePayment({
      request: buildRequest(),
      proof: proof(),
      verifier: { verifyTransfer },
      replayGuard: guardReturning(CLAIMED),
      requiredConfirmations: 12,
      now: WITHIN_WINDOW,
    });
    expect(verifyTransfer).toHaveBeenCalledWith(
      expect.objectContaining({ requiredConfirmations: 12 }),
    );
  });

  it('asks the chain only about values taken from the payment request', async () => {
    // Rule 27: the agent supplies a transaction hash and nothing else. Every
    // other field in the verification call must come from our own record.
    const verifyTransfer = vi.fn().mockResolvedValue(ok(buildTransfer()));
    const request = buildRequest();
    await authorizePayment({
      request,
      proof: proof({ payer: ATTACKER_WALLET }),
      verifier: { verifyTransfer },
      replayGuard: guardReturning(CLAIMED),
      requiredConfirmations: 3,
      now: WITHIN_WINDOW,
    });
    expect(verifyTransfer).toHaveBeenCalledWith({
      transactionHash: TX_HASH,
      chainId: request.chainId,
      tokenAddress: request.assetAddress,
      expectedRecipient: request.recipientAddress,
      expectedMinorUnits: request.amountMinorUnits,
      requiredConfirmations: 3,
    });
  });
});

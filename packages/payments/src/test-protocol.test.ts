import { describe, expect, it } from 'vitest';
import {
  Meter402Error,
  MerchantEnvironment,
  Money,
  USDC_BASE_MAINNET,
  USDC_BASE_SEPOLIA,
} from '@meter402/shared';
import { createPaymentRequest, type PaymentRequest } from './payment-request.js';
import { PaymentStatus } from './status.js';
import {
  SimulatedSettlementVerifier,
  TEST_PAYMENT_HEADER,
  TestPaymentProtocolAdapter,
  assertSimulatableRequest,
  deriveSimulatedReference,
} from './test-protocol.js';
import type { ReplayClaimResult, ReplayGuard } from './verification.js';

const SECRET = 'a'.repeat(64);
const OTHER_SECRET = 'b'.repeat(64);
const MERCHANT = '0x1111111111111111111111111111111111111111';
const AGENT = '0x3333333333333333333333333333333333333333';
const ISSUED_AT = new Date('2026-01-01T00:00:00.000Z');
const WITHIN = new Date('2026-01-01T00:01:00.000Z');
const AFTER = new Date('2026-01-01T00:10:00.000Z');

const adapter = new TestPaymentProtocolAdapter();

function buildRequest(overrides: Partial<PaymentRequest> = {}): PaymentRequest {
  const base = createPaymentRequest({
    organizationId: 'org_test',
    projectId: 'prj_test',
    endpointId: 'ep_test',
    environment: MerchantEnvironment.Test,
    amount: Money.fromDecimalString('0.03', 'USDC', 6),
    asset: USDC_BASE_SEPOLIA,
    recipientAddress: MERCHANT,
    ttlSeconds: 300,
    now: ISSUED_AT,
  });
  return { ...base, status: PaymentStatus.ChallengeIssued, ...overrides };
}

function liveRequest(): PaymentRequest {
  const base = createPaymentRequest({
    organizationId: 'org_test',
    projectId: 'prj_test',
    environment: MerchantEnvironment.Live,
    amount: Money.fromDecimalString('0.03', 'USDC', 6),
    asset: USDC_BASE_MAINNET,
    recipientAddress: MERCHANT,
    ttlSeconds: 300,
    now: ISSUED_AT,
  });
  return { ...base, status: PaymentStatus.ChallengeIssued };
}

function encodeProof(payload: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
}

const CLAIMED: ReplayGuard = {
  async claim(): Promise<ReplayClaimResult> {
    return { claimed: true };
  },
};

describe('deriveSimulatedReference', () => {
  it('produces a 32-byte hex reference indistinguishable in shape from a tx hash', () => {
    const request = buildRequest();
    expect(deriveSimulatedReference(SECRET, request.id, request.nonce)).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it('is deterministic, which is what makes completion idempotent', () => {
    const request = buildRequest();
    const first = deriveSimulatedReference(SECRET, request.id, request.nonce);
    const second = deriveSimulatedReference(SECRET, request.id, request.nonce);
    expect(first).toBe(second);
  });

  it('differs per payment request', () => {
    const a = buildRequest();
    const b = buildRequest();
    expect(deriveSimulatedReference(SECRET, a.id, a.nonce)).not.toBe(
      deriveSimulatedReference(SECRET, b.id, b.nonce),
    );
  });

  it('is unforgeable without the server secret', () => {
    // The request ID and nonce are both public — they are in the challenge.
    // Without keying, "complete the payment" would reduce to computing a hash
    // of two values the agent already holds.
    const request = buildRequest();
    expect(deriveSimulatedReference(SECRET, request.id, request.nonce)).not.toBe(
      deriveSimulatedReference(OTHER_SECRET, request.id, request.nonce),
    );
  });

  it('refuses a secret too short to be safe', () => {
    expect(() => deriveSimulatedReference('short', 'preq_1', 'nonce')).toThrow(Meter402Error);
  });
});

describe('TestPaymentProtocolAdapter.createChallenge', () => {
  it('describes a TEST payment', () => {
    const challenge = adapter.createChallenge(buildRequest());
    expect(challenge).toMatchObject({
      protocol: 'test',
      scheme: 'simulated',
      amountMinorUnits: '30000',
      recipient: MERCHANT,
      chain: { id: 84532, slug: 'base-sepolia' },
    });
    expect(challenge.metadata).toMatchObject({ simulated: true });
  });

  it('refuses outright to describe a LIVE payment request', () => {
    // Structural confinement: a misrouted adapter cannot produce a challenge
    // the TEST simulator would then be willing to settle.
    try {
      adapter.createChallenge(liveRequest());
      expect.unreachable('expected the TEST adapter to refuse a LIVE request');
    } catch (error) {
      expect((error as Meter402Error).code).toBe('SIMULATOR_LIVE_FORBIDDEN');
      expect((error as Meter402Error).httpStatus).toBe(403);
    }
  });

  it('sends the amount as a string, never a JSON number', () => {
    expect(typeof adapter.createChallenge(buildRequest()).amountMinorUnits).toBe('string');
  });
});

describe('TestPaymentProtocolAdapter.buildChallengeResponse', () => {
  const response = adapter.buildChallengeResponse(adapter.createChallenge(buildRequest()));

  it('is a 402 that forbids caching', () => {
    expect(response.status).toBe(402);
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it('uses a protocol-neutral body rather than the x402 accepts shape', () => {
    // Phase 2 must not freeze the product around a wire format whose
    // conformance is still unverified.
    const body = response.body as Record<string, unknown>;
    expect(body).not.toHaveProperty('accepts');
    expect(body).not.toHaveProperty('x402Version');
    expect(body['payment']).toMatchObject({ protocol: 'test', simulated: true });
  });

  it('tells the developer how to complete and retry', () => {
    const body = response.body as { instructions: Record<string, string> };
    expect(body.instructions['complete']).toContain('/complete');
    expect(body.instructions['retryWith']).toContain(TEST_PAYMENT_HEADER);
  });
});

describe('TestPaymentProtocolAdapter.parsePaymentProof', () => {
  it('decodes a well-formed proof', () => {
    const result = adapter.parsePaymentProof({
      headers: {
        [TEST_PAYMENT_HEADER]: encodeProof({
          paymentRequestId: 'preq_1',
          reference: `0x${'ab'.repeat(32)}`,
          payer: AGENT,
        }),
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.transactionHash).toBe(`0x${'ab'.repeat(32)}`);
    expect(result.value.payer).toBe(AGENT);
  });

  it('accepts the header in any casing', () => {
    const result = adapter.parsePaymentProof({
      headers: {
        'Meter402-Payment': encodeProof({ paymentRequestId: 'preq_1', reference: '0xabc' }),
      },
    });
    expect(result.ok).toBe(true);
  });

  it('rejects duplicated headers', () => {
    const encoded = encodeProof({ paymentRequestId: 'preq_1', reference: '0xabc' });
    const result = adapter.parsePaymentProof({
      headers: { [TEST_PAYMENT_HEADER]: [encoded, encoded] },
    });
    expect(result.ok).toBe(false);
  });

  it.each([
    ['', 'empty'],
    ['not base64!!', 'invalid base64'],
    [Buffer.from('not json').toString('base64'), 'not JSON'],
    [Buffer.from('[1,2,3]').toString('base64'), 'JSON array'],
    [encodeProof({ reference: '0xabc' }), 'missing paymentRequestId'],
    [encodeProof({ paymentRequestId: 'preq_1' }), 'missing reference'],
    [encodeProof({ paymentRequestId: 'preq_1', reference: 42 }), 'non-string reference'],
  ])('rejects %s (%s)', (header) => {
    const result = adapter.parsePaymentProof({ headers: { [TEST_PAYMENT_HEADER]: header } });
    expect(result.ok).toBe(false);
  });

  it('rejects a missing header', () => {
    expect(adapter.parsePaymentProof({ headers: {} }).ok).toBe(false);
  });

  it('rejects an oversized header', () => {
    const result = adapter.parsePaymentProof({
      headers: { [TEST_PAYMENT_HEADER]: 'A'.repeat(20_000) },
    });
    expect(result.ok).toBe(false);
  });

  it('does not pollute Object.prototype', () => {
    adapter.parsePaymentProof({
      headers: {
        [TEST_PAYMENT_HEADER]: encodeProof({
          paymentRequestId: 'preq_1',
          reference: '0xabc',
          __proto__: { polluted: 'yes' },
        }),
      },
    });
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
  });
});

describe('TestPaymentProtocolAdapter.validatePaymentProof', () => {
  const request = buildRequest();
  const challenge = adapter.createChallenge(request);

  it('accepts a matching proof', () => {
    const result = adapter.validatePaymentProof(
      {
        protocol: 'test',
        transactionHash: '0xabc',
        payer: null,
        nonce: request.nonce,
        raw: { paymentRequestId: request.id, reference: '0xabc' },
      },
      challenge,
    );
    expect(result.ok).toBe(true);
  });

  it('rejects a proof minted for a different payment request', () => {
    // The substitution attack: a paid request's proof presented against an
    // unpaid one.
    const result = adapter.validatePaymentProof(
      {
        protocol: 'test',
        transactionHash: '0xabc',
        payer: null,
        nonce: null,
        raw: { paymentRequestId: 'preq_someone_elses', reference: '0xabc' },
      },
      challenge,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.reason).toBe('MALFORMED_PROOF');
  });

  it('rejects a proof carrying another challenge nonce', () => {
    const result = adapter.validatePaymentProof(
      {
        protocol: 'test',
        transactionHash: '0xabc',
        payer: null,
        nonce: 'SOMEONE_ELSES_NONCE',
        raw: { paymentRequestId: request.id },
      },
      challenge,
    );
    expect(result.ok).toBe(false);
  });

  it('rejects a proof from another protocol', () => {
    const result = adapter.validatePaymentProof(
      { protocol: 'x402', transactionHash: '0xabc', payer: null, nonce: null, raw: {} },
      challenge,
    );
    expect(result.ok).toBe(false);
  });
});

describe('SimulatedSettlementVerifier', () => {
  const request = buildRequest();
  const reference = deriveSimulatedReference(SECRET, request.id, request.nonce);

  it('reports a settlement matching the payment request', async () => {
    const verifier = new SimulatedSettlementVerifier(reference, AGENT);
    const result = await verifier.verifyTransfer({
      transactionHash: reference,
      chainId: request.chainId,
      tokenAddress: request.assetAddress,
      expectedRecipient: request.recipientAddress,
      expectedMinorUnits: request.amountMinorUnits,
      requiredConfirmations: 1,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.minorUnits).toBe(30_000n);
    expect(result.value.to).toBe(MERCHANT);
    expect(result.value.from).toBe(AGENT);
  });

  it('refuses a reference the simulator never issued', async () => {
    // This is the non-trivial check: it makes "the agent must actually have
    // completed the TEST payment" enforceable rather than assumed.
    const verifier = new SimulatedSettlementVerifier(reference, AGENT);
    const result = await verifier.verifyTransfer({
      transactionHash: `0x${'ff'.repeat(32)}`,
      chainId: request.chainId,
      tokenAddress: request.assetAddress,
      expectedRecipient: request.recipientAddress,
      expectedMinorUnits: request.amountMinorUnits,
      requiredConfirmations: 1,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.reason).toBe('TRANSACTION_NOT_FOUND');
  });
});

describe('the TEST adapter drives the real authorization pipeline', () => {
  it('authorizes a correctly simulated payment', async () => {
    const request = buildRequest();
    const reference = deriveSimulatedReference(SECRET, request.id, request.nonce);

    const authorization = await adapter.verifyPayment({
      request,
      proof: {
        protocol: 'test',
        transactionHash: reference,
        payer: AGENT,
        nonce: request.nonce,
        raw: { paymentRequestId: request.id, reference },
      },
      verifier: new SimulatedSettlementVerifier(reference, AGENT),
      replayGuard: CLAIMED,
      requiredConfirmations: 1,
      now: WITHIN,
    });

    expect(authorization.decision).toBe('AUTHORIZED');
    expect(authorization.nextStatus).toBe(PaymentStatus.Confirmed);
  });

  it('still enforces expiry — the real check, not a simulated one', async () => {
    const request = buildRequest();
    const reference = deriveSimulatedReference(SECRET, request.id, request.nonce);

    const authorization = await adapter.verifyPayment({
      request,
      proof: {
        protocol: 'test',
        transactionHash: reference,
        payer: AGENT,
        nonce: request.nonce,
        raw: { paymentRequestId: request.id, reference },
      },
      verifier: new SimulatedSettlementVerifier(reference, AGENT),
      replayGuard: CLAIMED,
      requiredConfirmations: 1,
      now: AFTER,
    });

    expect(authorization.decision).toBe('REJECTED');
    expect(authorization.failure?.reason).toBe('REQUEST_EXPIRED');
  });

  it('still enforces replay protection — the real guard', async () => {
    const request = buildRequest();
    const reference = deriveSimulatedReference(SECRET, request.id, request.nonce);

    const authorization = await adapter.verifyPayment({
      request,
      proof: {
        protocol: 'test',
        transactionHash: reference,
        payer: AGENT,
        nonce: request.nonce,
        raw: { paymentRequestId: request.id, reference },
      },
      verifier: new SimulatedSettlementVerifier(reference, AGENT),
      replayGuard: {
        async claim() {
          return { claimed: false, existingPaymentRequestId: 'preq_someone_else' };
        },
      },
      requiredConfirmations: 1,
      now: WITHIN,
    });

    expect(authorization.decision).toBe('REJECTED');
    expect(authorization.failure?.reason).toBe('TRANSACTION_ALREADY_USED');
  });

  it('treats a re-presented reference for the same request as idempotent success', async () => {
    const request = buildRequest();
    const reference = deriveSimulatedReference(SECRET, request.id, request.nonce);

    const authorization = await adapter.verifyPayment({
      request,
      proof: {
        protocol: 'test',
        transactionHash: reference,
        payer: AGENT,
        nonce: request.nonce,
        raw: { paymentRequestId: request.id, reference },
      },
      verifier: new SimulatedSettlementVerifier(reference, AGENT),
      replayGuard: {
        async claim() {
          return { claimed: false, existingPaymentRequestId: request.id };
        },
      },
      requiredConfirmations: 1,
      now: WITHIN,
    });

    expect(authorization.decision).toBe('AUTHORIZED');
  });

  it('rejects a forged reference', async () => {
    const request = buildRequest();
    const genuine = deriveSimulatedReference(SECRET, request.id, request.nonce);
    const forged = deriveSimulatedReference(OTHER_SECRET, request.id, request.nonce);

    const authorization = await adapter.verifyPayment({
      request,
      proof: {
        protocol: 'test',
        transactionHash: forged,
        payer: AGENT,
        nonce: request.nonce,
        raw: { paymentRequestId: request.id, reference: forged },
      },
      verifier: new SimulatedSettlementVerifier(genuine, AGENT),
      replayGuard: CLAIMED,
      requiredConfirmations: 1,
      now: WITHIN,
    });

    // Retryable rather than fatal: from the pipeline's perspective this is
    // "no such settlement", which is exactly right.
    expect(authorization.decision).toBe('PENDING');
    expect(authorization.failure?.reason).toBe('TRANSACTION_NOT_FOUND');
  });
});

describe('assertSimulatableRequest', () => {
  it('permits a live TEST request', () => {
    expect(() => assertSimulatableRequest(buildRequest(), WITHIN)).not.toThrow();
  });

  it('refuses a LIVE payment request', () => {
    try {
      assertSimulatableRequest(liveRequest(), WITHIN);
      expect.unreachable('expected the simulator guard to refuse a LIVE request');
    } catch (error) {
      expect((error as Meter402Error).code).toBe('SIMULATOR_LIVE_FORBIDDEN');
    }
  });

  it('refuses an expired request', () => {
    try {
      assertSimulatableRequest(buildRequest(), AFTER);
      expect.unreachable('expected the simulator guard to refuse an expired request');
    } catch (error) {
      expect((error as Meter402Error).code).toBe('PAYMENT_EXPIRED');
    }
  });
});

describe('receipt metadata', () => {
  it('marks the settlement as simulated prominently', () => {
    const request = buildRequest();
    const metadata = adapter.createReceiptMetadata({
      request,
      transfer: {
        transactionHash: `0x${'ab'.repeat(32)}`,
        chainId: request.chainId,
        tokenAddress: request.assetAddress,
        from: AGENT,
        to: MERCHANT,
        minorUnits: 30_000n,
        blockNumber: 0n,
        blockHash: `0x${'0'.repeat(64)}`,
        confirmations: 1,
        logIndex: 0,
        observedAt: WITHIN,
      },
    });
    // A receipt that does not say it is simulated is one somebody eventually
    // reconciles as real revenue.
    expect(metadata['simulated']).toBe(true);
    expect(metadata['protocol']).toBe('test');
    expect(metadata['amountMinorUnits']).toBe('30000');
  });
});

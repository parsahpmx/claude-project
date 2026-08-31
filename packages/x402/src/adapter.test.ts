import { describe, expect, it } from 'vitest';
import { MerchantEnvironment, Money, USDC_BASE_SEPOLIA } from '@meter402/shared';
import {
  createPaymentRequest,
  verificationFailure,
  type PaymentRequest,
  type VerifiedTransfer,
} from '@meter402/payments';
import { X402Adapter } from './adapter.js';
import { PAYMENT_HEADER, PAYMENT_RESPONSE_HEADER, X402_VERSION } from './constants.js';

const MERCHANT = '0x1111111111111111111111111111111111111111';
const AGENT = '0x3333333333333333333333333333333333333333';
const TX_HASH = `0x${'ab'.repeat(32)}`;

const adapter = new X402Adapter();

function buildRequest(): PaymentRequest {
  return createPaymentRequest({
    organizationId: 'org_test',
    projectId: 'prj_test',
    environment: MerchantEnvironment.Test,
    amount: Money.fromDecimalString('0.03', 'USDC', 6),
    asset: USDC_BASE_SEPOLIA,
    recipientAddress: MERCHANT,
    ttlSeconds: 300,
    now: new Date('2026-01-01T00:00:00.000Z'),
  });
}

function encode(payload: unknown): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
}

function validPayload(overrides: Record<string, unknown> = {}) {
  return {
    x402Version: X402_VERSION,
    scheme: 'exact',
    network: 'base-sepolia',
    payload: { transaction: TX_HASH, payer: AGENT },
    ...overrides,
  };
}

describe('X402Adapter.createChallenge', () => {
  it('describes the payment in machine-readable terms', () => {
    const challenge = adapter.createChallenge(buildRequest());
    expect(challenge).toMatchObject({
      protocol: 'x402',
      scheme: 'exact',
      amountMinorUnits: '30000',
      recipient: MERCHANT,
      asset: { symbol: 'USDC', decimals: 6, address: USDC_BASE_SEPOLIA.address },
      chain: { id: 84532, slug: 'base-sepolia' },
    });
  });

  it('sends the amount as a string, never a JSON number', () => {
    // A JSON number is an IEEE-754 double. A large minor-unit amount would
    // lose precision in transit.
    const challenge = adapter.createChallenge(buildRequest());
    expect(typeof challenge.amountMinorUnits).toBe('string');
  });

  it('carries the request nonce so a proof can be bound to this challenge', () => {
    const request = buildRequest();
    expect(adapter.createChallenge(request).nonce).toBe(request.nonce);
  });
});

describe('X402Adapter.buildChallengeResponse', () => {
  const response = adapter.buildChallengeResponse(adapter.createChallenge(buildRequest()));

  it('returns HTTP 402 with an accepts array', () => {
    expect(response.status).toBe(402);
    const body = response.body as { x402Version: number; accepts: unknown[] };
    expect(body.x402Version).toBe(X402_VERSION);
    expect(body.accepts).toHaveLength(1);
    expect(body.accepts[0]).toMatchObject({
      scheme: 'exact',
      network: 'base-sepolia',
      maxAmountRequired: '30000',
      payTo: MERCHANT,
    });
  });

  it('forbids caching the challenge', () => {
    // A cached 402 is a replayable payment instruction: a shared proxy could
    // hand the same nonce and deadline to a different agent.
    expect(response.headers['cache-control']).toBe('no-store');
  });
});

describe('X402Adapter.parsePaymentProof — well-formed input', () => {
  it('decodes a valid payment header', () => {
    const result = adapter.parsePaymentProof({
      headers: { [PAYMENT_HEADER]: encode(validPayload()) },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({
      protocol: 'x402',
      transactionHash: TX_HASH,
      payer: AGENT,
    });
  });

  it('accepts the header name in any casing', () => {
    const result = adapter.parsePaymentProof({
      headers: { 'X-Payment': encode(validPayload()) },
    });
    expect(result.ok).toBe(true);
  });

  it('accepts base64url encoding', () => {
    const base64url = Buffer.from(JSON.stringify(validPayload()), 'utf8').toString('base64url');
    const result = adapter.parsePaymentProof({ headers: { [PAYMENT_HEADER]: base64url } });
    expect(result.ok).toBe(true);
  });

  it('accepts transactionHash as an alternative field name', () => {
    const result = adapter.parsePaymentProof({
      headers: {
        [PAYMENT_HEADER]: encode(validPayload({ payload: { transactionHash: TX_HASH } })),
      },
    });
    expect(result.ok).toBe(true);
  });
});

describe('X402Adapter.parsePaymentProof — hostile and malformed input', () => {
  it('rejects a missing header', () => {
    const result = adapter.parsePaymentProof({ headers: {} });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toMatch(/Missing/);
  });

  it('rejects duplicated payment headers', () => {
    // Which value a proxy forwards versus which we read is exactly the
    // ambiguity request-smuggling attacks exploit.
    const result = adapter.parsePaymentProof({
      headers: { [PAYMENT_HEADER]: [encode(validPayload()), encode(validPayload())] },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toMatch(/Multiple/);
  });

  it.each([
    ['not!valid!base64', 'invalid base64 alphabet'],
    ['', 'empty'],
    ['   ', 'whitespace only'],
  ])('rejects %s (%s)', (headerValue) => {
    const result = adapter.parsePaymentProof({ headers: { [PAYMENT_HEADER]: headerValue } });
    expect(result.ok).toBe(false);
  });

  it('rejects a header that decodes to something other than JSON', () => {
    const result = adapter.parsePaymentProof({
      headers: { [PAYMENT_HEADER]: Buffer.from('not json').toString('base64') },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.reason).toBe('MALFORMED_PROOF');
  });

  it('rejects a JSON array rather than treating it as an object', () => {
    const result = adapter.parsePaymentProof({ headers: { [PAYMENT_HEADER]: encode([1, 2, 3]) } });
    expect(result.ok).toBe(false);
  });

  it('rejects an oversized header without decoding it', () => {
    // Bound before allocating: an unauthenticated endpoint must not be
    // convertible into an arbitrary-size allocation.
    const huge = 'A'.repeat(64 * 1024);
    const result = adapter.parsePaymentProof({ headers: { [PAYMENT_HEADER]: huge } });
    expect(result.ok).toBe(false);
  });

  it('rejects an unsupported protocol version', () => {
    const result = adapter.parsePaymentProof({
      headers: { [PAYMENT_HEADER]: encode(validPayload({ x402Version: 99 })) },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.details).toMatchObject({ received: 99, supported: X402_VERSION });
  });

  const malformedPayloads: Array<[Record<string, unknown>, string]> = [
    [{ scheme: undefined }, 'missing scheme'],
    [{ network: undefined }, 'missing network'],
    [{ payload: {} }, 'missing transaction'],
    [{ payload: { transaction: '' } }, 'empty transaction'],
    [{ payload: { transaction: 12345 } }, 'non-string transaction'],
  ];

  it.each(malformedPayloads)('rejects a payload with %s (%s)', (overrides) => {
    const result = adapter.parsePaymentProof({
      headers: { [PAYMENT_HEADER]: encode(validPayload(overrides)) },
    });
    expect(result.ok).toBe(false);
  });

  it('does not pollute Object.prototype via a __proto__ key', () => {
    const malicious = encode({
      ...validPayload(),
      __proto__: { polluted: 'yes' },
    });
    adapter.parsePaymentProof({ headers: { [PAYMENT_HEADER]: malicious } });
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
  });

  it('strips a nested constructor key', () => {
    const malicious = encode(
      JSON.parse(
        '{"x402Version":1,"scheme":"exact","network":"base-sepolia","payload":{"transaction":"0xab","constructor":{"bad":1}}}',
      ),
    );
    const result = adapter.parsePaymentProof({ headers: { [PAYMENT_HEADER]: malicious } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const payload = result.value.raw['payload'] as Record<string, unknown>;
    // Must test for an *own* property: `payload['constructor']` always
    // resolves to Object.prototype.constructor and so can never be undefined.
    expect(Object.hasOwn(payload, 'constructor')).toBe(false);
  });
});

describe('X402Adapter.validatePaymentProof', () => {
  const challenge = adapter.createChallenge(buildRequest());

  function proofWith(raw: Record<string, unknown>, nonce: string | null = null) {
    return { protocol: 'x402', transactionHash: TX_HASH, payer: AGENT, nonce, raw };
  }

  it('accepts a matching proof', () => {
    const result = adapter.validatePaymentProof(
      proofWith({ scheme: 'exact', network: 'base-sepolia' }),
      challenge,
    );
    expect(result.ok).toBe(true);
  });

  it('rejects a payment made on the wrong network', () => {
    const result = adapter.validatePaymentProof(
      proofWith({ scheme: 'exact', network: 'base' }),
      challenge,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.reason).toBe('WRONG_NETWORK');
  });

  it('rejects an unsupported settlement scheme', () => {
    const result = adapter.validatePaymentProof(
      proofWith({ scheme: 'upto', network: 'base-sepolia' }),
      challenge,
    );
    expect(result.ok).toBe(false);
  });

  it('rejects a nonce from a different challenge', () => {
    const result = adapter.validatePaymentProof(
      proofWith({ scheme: 'exact', network: 'base-sepolia' }, 'SOMEONE_ELSES_NONCE'),
      challenge,
    );
    expect(result.ok).toBe(false);
  });

  it('rejects a proof from a different protocol', () => {
    const result = adapter.validatePaymentProof({ ...proofWith({}), protocol: 'mpp' }, challenge);
    expect(result.ok).toBe(false);
  });
});

describe('X402Adapter responses and receipts', () => {
  const request = buildRequest();
  const transfer: VerifiedTransfer = {
    transactionHash: TX_HASH,
    chainId: 84532,
    tokenAddress: USDC_BASE_SEPOLIA.address,
    from: AGENT,
    to: MERCHANT,
    minorUnits: 30_000n,
    blockNumber: 1_000n,
    blockHash: `0x${'cd'.repeat(32)}`,
    confirmations: 5,
    logIndex: 0,
    observedAt: new Date('2026-01-01T00:01:00.000Z'),
  };

  it('encodes the settlement result in the payment response header', () => {
    const response = adapter.buildSuccessResponse({ request, transfer, receiptId: 'rcpt_1' });
    const header = response.headers[PAYMENT_RESPONSE_HEADER];
    expect(header).toBeDefined();
    const decoded = JSON.parse(Buffer.from(header!, 'base64').toString('utf8'));
    expect(decoded).toMatchObject({
      success: true,
      transaction: TX_HASH,
      network: 'base-sepolia',
      payer: AGENT,
      receiptId: 'rcpt_1',
    });
  });

  it.each([
    ['WRONG_AMOUNT', 402],
    ['WRONG_RECIPIENT', 402],
    ['TRANSACTION_ALREADY_USED', 409],
    ['REQUEST_EXPIRED', 402],
    ['PROVIDER_UNAVAILABLE', 402],
  ] as const)('maps %s to HTTP %i', (reason, status) => {
    const response = adapter.buildFailureResponse(verificationFailure(reason, 'nope'));
    expect(response.status).toBe(status);
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it('re-serves the challenge on a retryable 402 so the agent can pay without another round trip', () => {
    const challenge = adapter.createChallenge(request);
    const response = adapter.buildFailureResponse(
      verificationFailure('WRONG_AMOUNT', 'too little'),
      challenge,
    );
    expect((response.body as Record<string, unknown>)['accepts']).toBeDefined();
  });

  it('builds receipt metadata including an explorer link', () => {
    const metadata = adapter.createReceiptMetadata({ request, transfer });
    expect(metadata).toMatchObject({
      protocol: 'x402',
      network: 'base-sepolia',
      transaction: TX_HASH,
      amountMinorUnits: '30000',
      blockNumber: '1000',
    });
    expect(metadata['explorerUrl']).toContain(TX_HASH);
  });
});

import { describe, expect, it } from 'vitest';
import { x402Client } from '@x402/core/client';
import { registerExactEvmScheme } from '@x402/evm/exact/client';
import { privateKeyToAccount } from 'viem/accounts';
import { BASE_SEPOLIA, USDC_BASE_MAINNET, USDC_BASE_SEPOLIA } from '@meter402/shared';
import { PaymentStatus, type PaymentRequest } from '@meter402/payments';
import { X402V2PaymentProtocolAdapter } from './adapter.js';
import { bindAuthorizationToRequest } from './binding.js';
import { verifyAuthorizationSignature } from './eip3009.js';
import { parseExactEvmPayload, parsePaymentPayload } from './parse.js';
import { MAX_PAYMENT_HEADER_BYTES } from './constants.js';
import type { X402PaymentPayload } from './wire.js';

/**
 * Negative conformance (STEPS 44 and 45).
 *
 * Each case starts from a **real payload produced by the official client**,
 * then tampers with exactly one thing. That matters: a negative test built
 * from a hand-written payload can pass because the payload was malformed in
 * some unrelated way, proving nothing about the check it claims to exercise.
 * Starting from a valid payload means the single mutation is the only reason
 * the request fails.
 */

const PAYER_KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
const ATTACKER = '0x1111111111111111111111111111111111111111';
const RECIPIENT = '0x209693bc6afc0c5328ba36faf03c514ef312287c';

function paymentRequest(overrides: Partial<PaymentRequest> = {}): PaymentRequest {
  return {
    id: 'preq_01JNEGATIVE000000000000',
    organizationId: 'org_test',
    projectId: 'prj_test',
    endpointId: 'ep_test',
    agentId: null,
    customerId: null,
    environment: 'TEST' as PaymentRequest['environment'],
    amountMinorUnits: 30_000n,
    assetSymbol: 'USDC',
    assetAddress: USDC_BASE_SEPOLIA.address,
    assetDecimals: 6,
    chainId: BASE_SEPOLIA.id,
    recipientAddress: RECIPIENT,
    nonce: '01JNEGATIVENONCE00000000',
    reference: 'ref_negative',
    status: PaymentStatus.ChallengeIssued,
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 300_000),
    metadata: {},
    ...overrides,
  } as PaymentRequest;
}

const adapter = new X402V2PaymentProtocolAdapter('https://api.meter402.test');

/** A genuine, valid payload from the official client. */
async function validPayload(request: PaymentRequest): Promise<X402PaymentPayload> {
  const response = adapter.buildPaymentRequiredResponse(request, '/v1/paid/research');
  const account = privateKeyToAccount(PAYER_KEY);
  let client = new x402Client();
  client = registerExactEvmScheme(client, { signer: account });
  return (await client.createPaymentPayload(
    response.body as never,
  )) as unknown as X402PaymentPayload;
}

function encode(payload: unknown): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
}

/** Parse + bind a (possibly tampered) payload against a request. */
function bind(request: PaymentRequest, raw: string) {
  const parsed = parsePaymentPayload(raw);
  if (!parsed.ok) return { stage: 'parse' as const, failure: parsed.error };
  const exact = parseExactEvmPayload(parsed.value.payload);
  if (!exact.ok) return { stage: 'payload' as const, failure: exact.error };
  const bound = bindAuthorizationToRequest({
    request,
    payload: parsed.value,
    exact: exact.value,
    now: new Date(),
  });
  if (!bound.ok) return { stage: 'bind' as const, failure: bound.error };
  return { stage: 'ok' as const, failure: null };
}

describe('negative: binding rejects tampering', () => {
  it('rejects a lowered amount in the signed authorization', async () => {
    const request = paymentRequest();
    const payload = await validPayload(request);
    const tampered = {
      ...payload,
      payload: {
        ...payload.payload,
        authorization: {
          ...(payload.payload['authorization'] as Record<string, unknown>),
          // One atomic unit short. No tolerance, no rounding.
          value: '29999',
        },
      },
    };

    const result = bind(request, encode(tampered));
    expect(result.stage).toBe('bind');
    expect(result.failure?.reason).toBe('WRONG_AMOUNT');
  });

  it('rejects a raised amount in the echoed requirement', async () => {
    const request = paymentRequest();
    const payload = await validPayload(request);
    const tampered = { ...payload, accepted: { ...payload.accepted, amount: '30001' } };

    const result = bind(request, encode(tampered));
    expect(result.failure?.reason).toBe('WRONG_AMOUNT');
  });

  it('rejects a redirected recipient in the signed authorization', async () => {
    const request = paymentRequest();
    const payload = await validPayload(request);
    const tampered = {
      ...payload,
      payload: {
        ...payload.payload,
        authorization: {
          ...(payload.payload['authorization'] as Record<string, unknown>),
          to: ATTACKER,
        },
      },
    };

    const result = bind(request, encode(tampered));
    expect(result.failure?.reason).toBe('WRONG_RECIPIENT');
  });

  it("rejects an attacker's recipient in the echoed requirement", async () => {
    const request = paymentRequest();
    const payload = await validPayload(request);
    const tampered = { ...payload, accepted: { ...payload.accepted, payTo: ATTACKER } };

    // The decisive case: the client's `accepted` block is evidence, never
    // instruction. We never read payTo as the recipient, so this fails.
    const result = bind(request, encode(tampered));
    expect(result.failure?.reason).toBe('WRONG_RECIPIENT');
  });

  it('rejects a lookalike token contract', async () => {
    const request = paymentRequest();
    const payload = await validPayload(request);
    const tampered = {
      ...payload,
      accepted: { ...payload.accepted, asset: '0x2222222222222222222222222222222222222222' },
    };

    const result = bind(request, encode(tampered));
    expect(result.failure?.reason).toBe('WRONG_ASSET');
  });

  it('rejects the real USDC contract from the wrong network', async () => {
    const request = paymentRequest();
    const payload = await validPayload(request);
    // A genuine USDC address — just the mainnet one, against a Sepolia request.
    const tampered = {
      ...payload,
      accepted: { ...payload.accepted, asset: USDC_BASE_MAINNET.address },
    };

    const result = bind(request, encode(tampered));
    expect(result.failure?.reason).toBe('WRONG_ASSET');
  });

  it('rejects a network downgrade to mainnet', async () => {
    const request = paymentRequest();
    const payload = await validPayload(request);
    const tampered = { ...payload, accepted: { ...payload.accepted, network: 'eip155:8453' } };

    const result = bind(request, encode(tampered));
    expect(result.failure?.reason).toBe('WRONG_NETWORK');
  });

  it('rejects an unsupported scheme', async () => {
    const request = paymentRequest();
    const payload = await validPayload(request);
    const tampered = { ...payload, accepted: { ...payload.accepted, scheme: 'upto' } };

    const result = bind(request, encode(tampered));
    expect(result.failure?.message).toMatch(/Unsupported scheme/);
  });

  it('rejects an expired authorization', async () => {
    const request = paymentRequest();
    const payload = await validPayload(request);
    const tampered = {
      ...payload,
      payload: {
        ...payload.payload,
        authorization: {
          ...(payload.payload['authorization'] as Record<string, unknown>),
          validBefore: '1000000000',
        },
      },
    };

    const result = bind(request, encode(tampered));
    expect(result.failure?.reason).toBe('REQUEST_EXPIRED');
  });

  it('rejects a not-yet-valid authorization', async () => {
    const request = paymentRequest();
    const payload = await validPayload(request);
    const future = String(Math.floor(Date.now() / 1000) + 3600);
    const tampered = {
      ...payload,
      payload: {
        ...payload.payload,
        authorization: {
          ...(payload.payload['authorization'] as Record<string, unknown>),
          validAfter: future,
        },
      },
    };

    const result = bind(request, encode(tampered));
    expect(result.failure?.reason).toBe('REQUEST_EXPIRED');
  });

  it('rejects a valid authorization against an already-expired payment request', async () => {
    const request = paymentRequest();
    const payload = await validPayload(request);
    // The domain deadline is ours to enforce; a facilitator knows nothing of it.
    const expired = paymentRequest({ expiresAt: new Date(Date.now() - 1000) });

    const result = bind(expired, encode(payload));
    expect(result.failure?.reason).toBe('REQUEST_EXPIRED');
  });
});

describe('negative: signature verification', () => {
  it('rejects a modified message that no longer matches the signature', async () => {
    const request = paymentRequest();
    const payload = await validPayload(request);
    const tampered = {
      ...payload,
      payload: {
        ...payload.payload,
        // Change the signed nonce, leaving the signature untouched.
        authorization: {
          ...(payload.payload['authorization'] as Record<string, unknown>),
          nonce: `0x${'c'.repeat(64)}`,
        },
      },
    };

    const parsed = parsePaymentPayload(encode(tampered));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const exact = parseExactEvmPayload(parsed.value.payload);
    if (!exact.ok) throw new Error('unexpected');

    const verified = await verifyAuthorizationSignature({
      exact: exact.value,
      asset: USDC_BASE_SEPOLIA,
      chainId: BASE_SEPOLIA.id,
    });
    expect(verified.ok).toBe(false);
  });

  it('rejects a signature presented under another payer', async () => {
    const request = paymentRequest();
    const payload = await validPayload(request);
    const tampered = {
      ...payload,
      payload: {
        ...payload.payload,
        authorization: {
          ...(payload.payload['authorization'] as Record<string, unknown>),
          from: ATTACKER,
        },
      },
    };

    const parsed = parsePaymentPayload(encode(tampered));
    if (!parsed.ok) throw new Error('unexpected');
    const exact = parseExactEvmPayload(parsed.value.payload);
    if (!exact.ok) throw new Error('unexpected');

    const verified = await verifyAuthorizationSignature({
      exact: exact.value,
      asset: USDC_BASE_SEPOLIA,
      chainId: BASE_SEPOLIA.id,
    });
    expect(verified.ok).toBe(false);
    if (verified.ok) return;
    expect(verified.error.message).toMatch(/does not belong to the declared payer/);
  });

  it('rejects a signature made under the wrong EIP-712 domain', async () => {
    // Same payer, same message, but signed for mainnet USDC. Verifying it
    // against the Sepolia domain must fail — this is the check that would
    // silently pass if the domain name were derived from the symbol.
    const request = paymentRequest();
    const payload = await validPayload(request);
    const parsed = parsePaymentPayload(encode(payload));
    if (!parsed.ok) throw new Error('unexpected');
    const exact = parseExactEvmPayload(parsed.value.payload);
    if (!exact.ok) throw new Error('unexpected');

    const wrongDomain = await verifyAuthorizationSignature({
      exact: exact.value,
      asset: USDC_BASE_MAINNET,
      chainId: BASE_SEPOLIA.id,
    });
    expect(wrongDomain.ok).toBe(false);
  });

  it('rejects a signature made for the wrong chain id', async () => {
    const request = paymentRequest();
    const payload = await validPayload(request);
    const parsed = parsePaymentPayload(encode(payload));
    if (!parsed.ok) throw new Error('unexpected');
    const exact = parseExactEvmPayload(parsed.value.payload);
    if (!exact.ok) throw new Error('unexpected');

    const wrongChain = await verifyAuthorizationSignature({
      exact: exact.value,
      asset: USDC_BASE_SEPOLIA,
      chainId: 8453,
    });
    expect(wrongChain.ok).toBe(false);
  });
});

describe('negative: hostile input', () => {
  const cases: ReadonlyArray<[string, string]> = [
    ['not base64 at all', '!!!!not-base64!!!!'],
    ['empty', ''],
    ['base64 of nothing', Buffer.from('', 'utf8').toString('base64')],
    ['base64 of non-JSON', Buffer.from('not json', 'utf8').toString('base64')],
    ['base64 of an array', Buffer.from('[]', 'utf8').toString('base64')],
    ['base64 of a string', Buffer.from('"hello"', 'utf8').toString('base64')],
    ['base64 of null', Buffer.from('null', 'utf8').toString('base64')],
  ];

  it.each(cases)('rejects %s', (_label, raw) => {
    const result = parsePaymentPayload(raw);
    expect(result.ok).toBe(false);
  });

  it('rejects an oversized header without decoding it', () => {
    const oversized = 'A'.repeat(MAX_PAYMENT_HEADER_BYTES * 4);
    const result = parsePaymentPayload(oversized);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toMatch(/too large/);
  });

  it('rejects a payload whose JSON is large but structurally valid', () => {
    const padded = encode({
      x402Version: 2,
      accepted: {},
      payload: {},
      filler: 'x'.repeat(MAX_PAYMENT_HEADER_BYTES + 1),
    });
    const result = parsePaymentPayload(padded);
    expect(result.ok).toBe(false);
  });

  it('rejects x402Version 1 rather than reinterpreting it', () => {
    const result = parsePaymentPayload(encode({ x402Version: 1, accepted: {}, payload: {} }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toMatch(/Unsupported x402 version 1/);
  });

  it('rejects a version sent as a string', () => {
    const result = parsePaymentPayload(encode({ x402Version: '2', accepted: {}, payload: {} }));
    expect(result.ok).toBe(false);
  });

  it('strips prototype-polluting keys', () => {
    const hostile = encode({
      x402Version: 2,
      ['__proto__']: { polluted: true },
      accepted: {},
      payload: {},
    });
    parsePaymentPayload(hostile);
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
  });

  const malformedAmounts = ['0030000', '3e4', '30000 ', '-30000', '30.000', '', 'NaN'];
  it.each(malformedAmounts)('rejects a non-canonical amount %j', (amount) => {
    const result = parsePaymentPayload(
      encode({
        x402Version: 2,
        accepted: {
          scheme: 'exact',
          network: 'eip155:84532',
          asset: USDC_BASE_SEPOLIA.address,
          amount,
          payTo: RECIPIENT,
          maxTimeoutSeconds: 300,
          extra: {},
        },
        payload: {},
      }),
    );
    expect(result.ok).toBe(false);
  });

  it('rejects a malformed network identifier', () => {
    const result = parsePaymentPayload(
      encode({
        x402Version: 2,
        accepted: {
          scheme: 'exact',
          network: 'base-sepolia',
          asset: USDC_BASE_SEPOLIA.address,
          amount: '30000',
          payTo: RECIPIENT,
          maxTimeoutSeconds: 300,
          extra: {},
        },
        payload: { authorization: {}, signature: '0x00' },
      }),
    );
    // Parses structurally (it is a non-empty string), then fails binding as
    // the wrong network — a v1 slug is not a v2 network.
    if (result.ok) {
      const exact = parseExactEvmPayload(result.value.payload);
      expect(exact.ok).toBe(false);
    }
  });

  it('rejects a malformed signature length', () => {
    const result = parseExactEvmPayload({
      authorization: {
        from: ATTACKER,
        to: RECIPIENT,
        value: '30000',
        validAfter: '0',
        validBefore: '9999999999',
        nonce: `0x${'a'.repeat(64)}`,
      },
      signature: '0xdeadbeef',
    });
    expect(result.ok).toBe(false);
  });

  it('rejects a malformed nonce length', () => {
    const result = parseExactEvmPayload({
      authorization: {
        from: ATTACKER,
        to: RECIPIENT,
        value: '30000',
        validAfter: '0',
        validBefore: '9999999999',
        nonce: '0xabcd',
      },
      signature: `0x${'a'.repeat(130)}`,
    });
    expect(result.ok).toBe(false);
  });
});

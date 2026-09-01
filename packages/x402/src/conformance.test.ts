import { describe, expect, it } from 'vitest';
import { x402Client } from '@x402/core/client';
import { registerExactEvmScheme } from '@x402/evm/exact/client';
import { getDefaultAsset } from '@x402/evm';
import {
  decodePaymentRequiredHeader,
  decodePaymentResponseHeader,
  encodePaymentSignatureHeader,
} from '@x402/core/http';
import { privateKeyToAccount } from 'viem/accounts';
import {
  BASE_MAINNET,
  BASE_SEPOLIA,
  USDC_BASE_MAINNET,
  USDC_BASE_SEPOLIA,
  normalizeAddress,
} from '@meter402/shared';
import { PaymentStatus, type PaymentRequest } from '@meter402/payments';
import { X402V2PaymentProtocolAdapter } from './adapter.js';
import { bindAuthorizationToRequest } from './binding.js';
import { verifyAuthorizationSignature } from './eip3009.js';
import { parseExactEvmPayload, parsePaymentPayload } from './parse.js';
import { PAYMENT_REQUIRED_HEADER, PAYMENT_RESPONSE_HEADER, X402_VERSION } from './constants.js';

/**
 * x402 v2 conformance, against the official reference implementation.
 *
 * The rule this file exists to honour (STEP 43): **Meter402 must not validate
 * itself.** Nothing here is checked against a fixture Meter402 produced. The
 * assertions are:
 *
 *   • the official `@x402/core` decoder accepts our `PAYMENT-REQUIRED`
 *   • the official client *chooses* our requirement and signs it
 *   • our parser accepts the payload that official client produced
 *   • our binding accepts it against the PaymentRequest it was quoted from
 *   • the official decoder accepts our `PAYMENT-RESPONSE`
 *
 * Signing is local cryptography, so this runs offline and is a genuine
 * independent-client interoperability test. What it cannot cover — a real
 * facilitator and real Base Sepolia settlement — is recorded as an open gate
 * in docs/X402_V2_CONFORMANCE_PLAN.md rather than simulated and called done.
 */

const PAYER_KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
const RECIPIENT = '0x209693bc6afc0c5328ba36faf03c514ef312287c';
const RESOURCE_BASE = 'https://api.meter402.test';

function paymentRequest(overrides: Partial<PaymentRequest> = {}): PaymentRequest {
  return {
    id: 'preq_01JCONFORMANCE0000000000',
    organizationId: 'org_test',
    projectId: 'prj_test',
    endpointId: 'ep_test',
    agentId: null,
    customerId: null,
    environment: 'TEST' as PaymentRequest['environment'],
    // 0.03 USDC at 6 decimals.
    amountMinorUnits: 30_000n,
    assetSymbol: 'USDC',
    assetAddress: USDC_BASE_SEPOLIA.address,
    assetDecimals: 6,
    chainId: BASE_SEPOLIA.id,
    recipientAddress: RECIPIENT,
    nonce: '01JCONFORMANCENONCE00000',
    reference: 'ref_conformance',
    status: PaymentStatus.ChallengeIssued,
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 300_000),
    metadata: {},
    ...overrides,
  } as PaymentRequest;
}

const adapter = new X402V2PaymentProtocolAdapter(RESOURCE_BASE);

/** Drive the official client end to end against our 402. */
async function officialClientPays(request: PaymentRequest) {
  const response = adapter.buildPaymentRequiredResponse(request, '/v1/paid/research');

  // The official decoder must accept our header — not our own decoder.
  const header = response.headers[PAYMENT_REQUIRED_HEADER];
  expect(header).toBeTypeOf('string');
  const decoded = decodePaymentRequiredHeader(header as string);

  const account = privateKeyToAccount(PAYER_KEY);
  let client = new x402Client();
  client = registerExactEvmScheme(client, { signer: account });

  // The official client selects a requirement and signs it. If our `accepts`
  // were malformed or used v1 field names, this throws.
  const payload = await client.createPaymentPayload(decoded);
  return { response, decoded, payload, payer: account.address };
}

describe('x402 v2 conformance — official client interoperability', () => {
  it('the official decoder accepts our PAYMENT-REQUIRED', async () => {
    const { decoded } = await officialClientPays(paymentRequest());

    expect(decoded.x402Version).toBe(X402_VERSION);
    expect(decoded.accepts).toHaveLength(1);
    const requirement = decoded.accepts[0]!;
    expect(requirement.scheme).toBe('exact');
    expect(requirement.network).toBe('eip155:84532');
    // Amount as an atomic string, never a JSON number.
    expect(requirement.amount).toBe('30000');
    expect(typeof requirement.amount).toBe('string');
    expect(normalizeAddress(requirement.payTo)).toBe(RECIPIENT);
    expect(normalizeAddress(requirement.asset)).toBe(USDC_BASE_SEPOLIA.address);
  });

  it('advertises the EIP-712 domain the token actually signs under', async () => {
    const { decoded } = await officialClientPays(paymentRequest());
    const extra = decoded.accepts[0]!.extra as Record<string, unknown>;

    // Cross-checked against the reference implementation's own asset table.
    const official = getDefaultAsset('eip155:84532');
    expect(extra['name']).toBe(official.name);
    expect(extra['version']).toBe(official.version);
    // And it is "USDC" on Sepolia, NOT the mainnet contract's "USD Coin".
    expect(extra['name']).toBe('USDC');
  });

  it('our registry agrees with the reference implementation on both networks', () => {
    const sepolia = getDefaultAsset('eip155:84532');
    const mainnet = getDefaultAsset('eip155:8453');

    expect(normalizeAddress(sepolia.asset)).toBe(USDC_BASE_SEPOLIA.address);
    expect(normalizeAddress(mainnet.asset)).toBe(USDC_BASE_MAINNET.address);
    expect(sepolia.decimals).toBe(USDC_BASE_SEPOLIA.decimals);
    expect(mainnet.decimals).toBe(USDC_BASE_MAINNET.decimals);

    // The domain names genuinely differ between the two deployments.
    expect(USDC_BASE_SEPOLIA.eip712.name).toBe(sepolia.name);
    expect(USDC_BASE_MAINNET.eip712.name).toBe(mainnet.name);
    expect(USDC_BASE_SEPOLIA.eip712.name).not.toBe(USDC_BASE_MAINNET.eip712.name);
  });

  it('our parser accepts a payload produced by the official client', async () => {
    const { payload } = await officialClientPays(paymentRequest());
    const encoded = encodePaymentSignatureHeader(payload);

    const parsed = parsePaymentPayload(encoded);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    expect(parsed.value.x402Version).toBe(2);
    expect(parsed.value.accepted.amount).toBe('30000');
  });

  it('binds an official client payload to the payment request it was quoted from', async () => {
    const request = paymentRequest();
    const { payload } = await officialClientPays(request);
    const parsed = parsePaymentPayload(encodePaymentSignatureHeader(payload));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const exact = parseExactEvmPayload(parsed.value.payload);
    expect(exact.ok).toBe(true);
    if (!exact.ok) return;

    const bound = bindAuthorizationToRequest({
      request,
      payload: parsed.value,
      exact: exact.value,
      now: new Date(),
    });
    expect(bound.ok).toBe(true);
  });

  it('recovers the payer from a signature the official client produced', async () => {
    const request = paymentRequest();
    const { payload, payer } = await officialClientPays(request);
    const parsed = parsePaymentPayload(encodePaymentSignatureHeader(payload));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const exact = parseExactEvmPayload(parsed.value.payload);
    expect(exact.ok).toBe(true);
    if (!exact.ok) return;

    const recovered = await verifyAuthorizationSignature({
      exact: exact.value,
      asset: USDC_BASE_SEPOLIA,
      chainId: BASE_SEPOLIA.id,
    });

    expect(recovered.ok).toBe(true);
    if (!recovered.ok) return;
    // Independently signed by viem's account, independently recovered by ours.
    expect(normalizeAddress(recovered.value)).toBe(normalizeAddress(payer));
  });

  it('the official decoder accepts our PAYMENT-RESPONSE', () => {
    const request = paymentRequest();
    const response = adapter.buildSuccessResponse({
      request,
      transfer: {
        transactionHash: `0x${'a'.repeat(64)}`,
        chainId: BASE_SEPOLIA.id,
        tokenAddress: USDC_BASE_SEPOLIA.address,
        from: '0x70997970c51812dc3a010c7d01b50e0d17dc79c8',
        to: RECIPIENT,
        minorUnits: 30_000n,
        blockNumber: 1n,
        blockHash: `0x${'b'.repeat(64)}`,
        confirmations: 1,
        logIndex: 0,
        observedAt: new Date(),
      },
      receiptId: 'rcpt_conformance',
    });

    const settle = decodePaymentResponseHeader(response.headers[PAYMENT_RESPONSE_HEADER] as string);
    expect(settle.success).toBe(true);
    expect(settle.network).toBe('eip155:84532');
    expect(settle.transaction).toBe(`0x${'a'.repeat(64)}`);
  });

  it('signs against Base mainnet only when the request says mainnet', async () => {
    // Guards the domain-name trap: a mainnet request must advertise
    // "USD Coin", and a signature made under it must recover correctly.
    const request = paymentRequest({
      chainId: BASE_MAINNET.id,
      assetAddress: USDC_BASE_MAINNET.address,
    });
    const { decoded, payload, payer } = await officialClientPays(request);
    expect(decoded.accepts[0]!.network).toBe('eip155:8453');
    expect((decoded.accepts[0]!.extra as Record<string, unknown>)['name']).toBe('USD Coin');

    const parsed = parsePaymentPayload(encodePaymentSignatureHeader(payload));
    if (!parsed.ok) throw new Error('parse failed');
    const exact = parseExactEvmPayload(parsed.value.payload);
    if (!exact.ok) throw new Error('exact parse failed');

    const recovered = await verifyAuthorizationSignature({
      exact: exact.value,
      asset: USDC_BASE_MAINNET,
      chainId: BASE_MAINNET.id,
    });
    expect(recovered.ok).toBe(true);
    if (!recovered.ok) return;
    expect(normalizeAddress(recovered.value)).toBe(normalizeAddress(payer));
  });
});

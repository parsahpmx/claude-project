import { randomBytes } from 'node:crypto';
import { expect } from 'vitest';
import { x402Client } from '@x402/core/client';
import { registerExactEvmScheme } from '@x402/evm/exact/client';
import { decodePaymentRequiredHeader, encodePaymentSignatureHeader } from '@x402/core/http';
import { privateKeyToAccount } from 'viem/accounts';
import {
  call,
  createTestApiKey,
  createTestEndpoint,
  createTestOrganization,
  createTestProject,
  type Harness,
} from './harness.js';

/**
 * The uncertain settlement, as a shared fixture.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * Several suites need a payment in the state Phase 3.5 exists to repair: the
 * facilitator settled, money moved, and Meter402 never saw the response.
 *
 * It is produced genuinely rather than by writing a row by hand — a real
 * x402 client signs a real authorization, the real gate runs, and the
 * facilitator reports the settle call as unreachable *after* recording that it
 * settled. That is the actual shape of a lost response, and it exercises the
 * real enqueue path in the real transaction. A hand-written PENDING row would
 * test the assertions and nothing else.
 * ─────────────────────────────────────────────────────────────────────────
 */

const PAYER_KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
const MERCHANT_WALLET = '0x209693bc6afc0c5328ba36faf03c514ef312287c';

/*
 * A distinct transaction hash for every fixture, every run.
 *
 * The transaction-replay guard is deliberately global — `UNIQUE (chain_id,
 * transaction_hash)` across the whole table, so one transaction can settle at
 * most one payment request anywhere in the system. That is the property being
 * relied on, so the tests must not fight it: a hard-coded hash would be
 * claimed by the first run and then rejected as already-used by every run
 * afterwards against the same database, failing the test for a reason that has
 * nothing to do with reconciliation.
 */
const RUN = randomBytes(8).toString('hex');
let hashCounter = 0;
export function fakeSettlementTx(): string {
  hashCounter += 1;
  return `0x${RUN}${hashCounter.toString(16).padStart(8, '0')}`.padEnd(66, '0');
}

export interface Merchant {
  readonly projectId: string;
  readonly endpointPath: string;
  readonly keySecret: string;
  readonly ownerToken: string;
}

export async function createMerchant(harness: Harness, label: string): Promise<Merchant> {
  const app = harness.app;
  const org = await createTestOrganization(app, label);
  const projectId = await createTestProject(app, org.organizationId, org.owner.token, label);

  await call(app, {
    method: 'PUT',
    url: `/v1/organizations/${org.organizationId}/settlement`,
    token: org.owner.token,
    payload: { projectId, chainId: 84532, asset: 'USDC', recipientAddress: MERCHANT_WALLET },
  });

  const endpoint = await createTestEndpoint(app, projectId, org.owner.token, {
    path: `/${label}-research`,
    settlementProtocol: 'x402',
  });
  const key = await createTestApiKey(app, projectId, org.owner.token, {
    environment: 'TEST',
    scopes: ['payments:read', 'payments:write'],
  });

  return {
    projectId,
    endpointPath: endpoint.path,
    keySecret: key.secret,
    ownerToken: org.owner.token,
  };
}

/**
 * Drive a payment to the uncertain state, exactly as production would.
 *
 * The facilitator "settles" (so a transaction genuinely exists) and then
 * reports the call as timed out, which is the real-world shape of a lost
 * response.
 */
export async function createUncertainSettlement(harness: Harness, label: string) {
  const merchant = await createMerchant(harness, label);

  const unpaid = await harness.app.inject({
    method: 'POST',
    url: `/v1/paid${merchant.endpointPath}`,
    headers: { authorization: `Bearer ${merchant.keySecret}` },
  });
  const required = decodePaymentRequiredHeader(unpaid.headers['payment-required'] as string);

  const account = privateKeyToAccount(PAYER_KEY);
  let client = new x402Client();
  client = registerExactEvmScheme(client, { signer: account });
  const payload = await client.createPaymentPayload(required);
  const header = encodePaymentSignatureHeader(payload);

  // The settle call is made and then reported as unreachable.
  harness.facilitator!.settleResult = 'UNAVAILABLE';
  const response = await harness.app.inject({
    method: 'POST',
    url: `/v1/paid${merchant.endpointPath}`,
    headers: {
      authorization: `Bearer ${merchant.keySecret}`,
      'payment-signature': header,
    },
  });
  harness.facilitator!.settleResult = 'SUCCESS';

  // The payer is told not to pay again, never that they failed to pay.
  expect(response.statusCode).toBe(402);
  expect(response.json().error).toMatchObject({ code: 'PAYMENT_NOT_CONFIRMED' });

  const paymentRequestId = (required.resource.url.split('preq=')[1] ?? '').trim();
  expect(paymentRequestId).toMatch(/^preq_/);

  return { merchant, paymentRequestId, payer: account.address };
}

export interface UncertainSettlement {
  readonly merchant: Merchant;
  readonly paymentRequestId: string;
  readonly payer: string;
}

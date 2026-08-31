import { describe, expect, it } from 'vitest';
import {
  EnvironmentChainMismatchError,
  MerchantEnvironment,
  Money,
  USDC_BASE_MAINNET,
  USDC_BASE_SEPOLIA,
} from '@meter402/shared';
import {
  createPaymentRequest,
  isExpired,
  paymentRequestAmount,
  secondsUntilExpiry,
} from './payment-request.js';
import { PaymentStatus } from './status.js';

const NOW = new Date('2026-01-01T00:00:00.000Z');
const RECIPIENT = '0x1111111111111111111111111111111111111111';

function base(overrides: Record<string, unknown> = {}) {
  return {
    organizationId: 'org_test',
    projectId: 'prj_test',
    environment: MerchantEnvironment.Test,
    amount: Money.fromDecimalString('0.03', 'USDC', 6),
    asset: USDC_BASE_SEPOLIA,
    recipientAddress: RECIPIENT,
    ttlSeconds: 300,
    now: NOW,
    ...overrides,
  } as Parameters<typeof createPaymentRequest>[0];
}

describe('createPaymentRequest', () => {
  it('creates a request in CREATED with an expiry derived from the TTL', () => {
    const request = createPaymentRequest(base());
    expect(request.status).toBe(PaymentStatus.Created);
    expect(request.expiresAt.toISOString()).toBe('2026-01-01T00:05:00.000Z');
    expect(request.amountMinorUnits).toBe(30_000n);
  });

  it('mints a unique nonce per request so a proof cannot be replayed across challenges', () => {
    const first = createPaymentRequest(base());
    const second = createPaymentRequest(base());
    expect(first.nonce).not.toBe(second.nonce);
    expect(first.id).not.toBe(second.id);
  });

  it('round-trips the amount back to a typed Money', () => {
    const request = createPaymentRequest(base());
    expect(paymentRequestAmount(request).toDecimalString()).toBe('0.030000');
  });

  it('refuses to let a TEST project transact on mainnet', () => {
    // Product rule 14, enforced structurally rather than by convention.
    expect(() =>
      createPaymentRequest(
        base({ asset: USDC_BASE_MAINNET, environment: MerchantEnvironment.Test }),
      ),
    ).toThrow(EnvironmentChainMismatchError);
  });

  it('refuses to let a LIVE project transact on a testnet', () => {
    expect(() =>
      createPaymentRequest(
        base({ asset: USDC_BASE_SEPOLIA, environment: MerchantEnvironment.Live }),
      ),
    ).toThrow(EnvironmentChainMismatchError);
  });

  it('rejects an amount whose currency does not match the asset', () => {
    expect(() =>
      createPaymentRequest(base({ amount: Money.fromDecimalString('1.00', 'EURC', 6) })),
    ).toThrow(/does not match asset/);
  });

  it('rejects an amount whose precision does not match the asset', () => {
    expect(() =>
      createPaymentRequest(base({ amount: Money.fromMinorUnits(1n, 'USDC', 18) })),
    ).toThrow(/does not match USDC/);
  });

  it('rejects a zero or negative amount', () => {
    expect(() => createPaymentRequest(base({ amount: Money.zero('USDC', 6) }))).toThrow(
      /greater than zero/,
    );
    expect(() =>
      createPaymentRequest(base({ amount: Money.fromDecimalString('-1', 'USDC', 6) })),
    ).toThrow(/greater than zero/);
  });

  it.each([0, 5, 29, 3601, 86_400])('rejects an out-of-range TTL of %i seconds', (ttlSeconds) => {
    expect(() => createPaymentRequest(base({ ttlSeconds }))).toThrow(/TTL must be between/);
  });
});

describe('expiry', () => {
  it('is not expired inside the window', () => {
    const request = createPaymentRequest(base());
    expect(isExpired(request, new Date('2026-01-01T00:04:59.000Z'))).toBe(false);
    expect(secondsUntilExpiry(request, new Date('2026-01-01T00:04:00.000Z'))).toBe(60);
  });

  it('is expired exactly at the boundary', () => {
    // Inclusive: at expiresAt the challenge is over. An off-by-one here is a
    // free request.
    const request = createPaymentRequest(base());
    expect(isExpired(request, new Date('2026-01-01T00:05:00.000Z'))).toBe(true);
  });

  it('clamps the countdown at zero rather than going negative', () => {
    const request = createPaymentRequest(base());
    expect(secondsUntilExpiry(request, new Date('2026-01-01T01:00:00.000Z'))).toBe(0);
  });
});

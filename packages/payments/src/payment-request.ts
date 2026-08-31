import {
  Money,
  Meter402Error,
  assertChainAllowedForEnvironment,
  newId,
  ulid,
  type MerchantEnvironment,
  type TokenAsset,
} from '@meter402/shared';
import { PaymentStatus } from './status.js';

/**
 * A PaymentRequest is the merchant's statement of what must be paid: amount,
 * asset, chain, recipient, and a deadline. It is created before the challenge
 * is served and is the record every later verification step is checked
 * against.
 *
 * Amounts are stored as `bigint` minor units. The decimals are carried
 * alongside so the value can be rendered without consulting a registry, and so
 * a historical payment still renders correctly if an asset's registry entry
 * ever changes.
 */
export interface PaymentRequest {
  readonly id: string;
  readonly organizationId: string;
  readonly projectId: string;
  readonly endpointId: string | null;
  readonly agentId: string | null;
  readonly customerId: string | null;
  readonly environment: MerchantEnvironment;

  readonly amountMinorUnits: bigint;
  readonly assetSymbol: string;
  readonly assetAddress: string;
  readonly assetDecimals: number;
  readonly chainId: number;
  readonly recipientAddress: string;

  /**
   * Single-use random value binding a challenge to this request. It is echoed
   * in the challenge so a proof cannot be replayed against a different
   * request that happens to share an amount and recipient.
   */
  readonly nonce: string;
  /** Short human-facing reference shown in dashboards and receipts. */
  readonly reference: string;

  readonly status: PaymentStatus;
  readonly createdAt: Date;
  readonly expiresAt: Date;
  readonly metadata: Readonly<Record<string, unknown>>;
}

export interface CreatePaymentRequestInput {
  readonly organizationId: string;
  readonly projectId: string;
  readonly endpointId?: string | null;
  readonly agentId?: string | null;
  readonly customerId?: string | null;
  readonly environment: MerchantEnvironment;
  readonly amount: Money;
  readonly asset: TokenAsset;
  readonly recipientAddress: string;
  readonly ttlSeconds: number;
  readonly now?: Date;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export const MIN_TTL_SECONDS = 30;
export const MAX_TTL_SECONDS = 3600;

export function createPaymentRequest(input: CreatePaymentRequestInput): PaymentRequest {
  const now = input.now ?? new Date();

  // A TEST project must never produce an instruction to pay a mainnet address.
  assertChainAllowedForEnvironment(input.asset.chainId, input.environment);

  if (input.amount.currency !== input.asset.symbol) {
    throw new Meter402Error(
      'VALIDATION_FAILED',
      `Amount currency ${input.amount.currency} does not match asset ${input.asset.symbol}.`,
    );
  }
  if (input.amount.decimals !== input.asset.decimals) {
    throw new Meter402Error(
      'VALIDATION_FAILED',
      `Amount precision (${input.amount.decimals}) does not match ${input.asset.symbol} (${input.asset.decimals}).`,
    );
  }
  if (!input.amount.isPositive()) {
    throw new Meter402Error('VALIDATION_FAILED', 'Payment amount must be greater than zero.');
  }
  if (input.ttlSeconds < MIN_TTL_SECONDS || input.ttlSeconds > MAX_TTL_SECONDS) {
    throw new Meter402Error(
      'VALIDATION_FAILED',
      `Challenge TTL must be between ${MIN_TTL_SECONDS} and ${MAX_TTL_SECONDS} seconds.`,
    );
  }

  return {
    id: newId('paymentRequest'),
    organizationId: input.organizationId,
    projectId: input.projectId,
    endpointId: input.endpointId ?? null,
    agentId: input.agentId ?? null,
    customerId: input.customerId ?? null,
    environment: input.environment,
    amountMinorUnits: input.amount.minorUnits,
    assetSymbol: input.asset.symbol,
    assetAddress: input.asset.address,
    assetDecimals: input.asset.decimals,
    chainId: input.asset.chainId,
    recipientAddress: input.recipientAddress,
    nonce: ulid(),
    reference: ulid().slice(0, 12),
    status: PaymentStatus.Created,
    createdAt: now,
    expiresAt: new Date(now.getTime() + input.ttlSeconds * 1000),
    metadata: input.metadata ?? {},
  };
}

/** Reconstruct the typed amount from stored columns. */
export function paymentRequestAmount(request: PaymentRequest): Money {
  return Money.fromMinorUnits(request.amountMinorUnits, request.assetSymbol, request.assetDecimals);
}

export function isExpired(request: PaymentRequest, now: Date = new Date()): boolean {
  return now.getTime() >= request.expiresAt.getTime();
}

export function secondsUntilExpiry(request: PaymentRequest, now: Date = new Date()): number {
  return Math.max(0, Math.ceil((request.expiresAt.getTime() - now.getTime()) / 1000));
}

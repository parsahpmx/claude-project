import { describe, expect, it } from 'vitest';
import { ALL_PAYMENT_STATUSES } from '@meter402/payments';
import { paymentStatusEnum } from './schema/enums.js';
import { blockchainTransactions, payments, paymentRequests } from './schema/payments.js';
import { apiKeys } from './schema/api-keys.js';

/**
 * Schema invariants that would otherwise only fail in production.
 *
 * These are cheap unit tests over the schema definition — no database
 * required. The drift test in particular guards a failure mode that is
 * genuinely hard to catch by review: the domain enum and the database enum
 * living in different files and slowly diverging.
 */

describe('payment status enum', () => {
  it('matches the domain state machine exactly', () => {
    // If someone adds a status to PaymentStatus without a migration, writing
    // that status fails at the database at runtime. This makes it fail here.
    expect([...paymentStatusEnum.enumValues].sort()).toEqual([...ALL_PAYMENT_STATUSES].sort());
  });
});

describe('replay protection', () => {
  it('declares chain_id and transaction_hash on blockchain_transactions', () => {
    // The UNIQUE index over these two columns is the platform's replay
    // protection. Renaming either column without updating the constraint would
    // silently remove it.
    expect(blockchainTransactions.chainId.name).toBe('chain_id');
    expect(blockchainTransactions.transactionHash.name).toBe('transaction_hash');
    expect(blockchainTransactions.transactionHash.notNull).toBe(true);
    expect(blockchainTransactions.chainId.notNull).toBe(true);
  });
});

describe('money columns', () => {
  const moneyColumns = [
    paymentRequests.amountMinorUnits,
    payments.grossAmountMinorUnits,
    payments.platformFeeMinorUnits,
    payments.networkFeeMinorUnits,
    payments.netAmountMinorUnits,
  ];

  it('are numeric, never a floating-point type', () => {
    for (const column of moneyColumns) {
      expect(column.getSQLType()).toMatch(/^numeric/);
      expect(column.getSQLType()).not.toMatch(/real|double|float/i);
    }
  });

  it('carry enough precision for a full uint256 with no fractional scale', () => {
    // uint256 max is ~1.16e77, so 78 digits. Scale must be 0 because the value
    // is already in minor units.
    for (const column of moneyColumns) {
      expect(column.getSQLType()).toBe('numeric(78, 0)');
    }
  });

  it('records asset decimals alongside every stored amount', () => {
    // Without the decimals, a stored amount is ambiguous the moment an asset's
    // registry entry changes.
    expect(paymentRequests.assetDecimals).toBeDefined();
    expect(payments.assetDecimals).toBeDefined();
  });
});

describe('tenancy', () => {
  it('scopes every tenant-owned table by organization_id', () => {
    for (const table of [paymentRequests, payments, blockchainTransactions, apiKeys]) {
      expect(table.organizationId).toBeDefined();
      expect(table.organizationId.notNull).toBe(true);
    }
  });
});

describe('api keys', () => {
  it('has no column capable of holding a plaintext secret', () => {
    const columnNames = Object.values(apiKeys).flatMap((value) =>
      typeof value === 'object' && value !== null && 'name' in value
        ? [String((value as { name: unknown }).name)]
        : [],
    );
    expect(columnNames).toContain('key_hash');
    expect(columnNames).not.toContain('secret');
    expect(columnNames).not.toContain('key');
    expect(columnNames).not.toContain('plaintext');
  });
});

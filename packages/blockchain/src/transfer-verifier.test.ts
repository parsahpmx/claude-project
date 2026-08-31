import { describe, expect, it } from 'vitest';
import type { TransferVerificationRequest } from '@meter402/payments';
import { ERC20_TRANSFER_TOPIC } from './erc20.js';
import { Erc20SettlementVerifier } from './transfer-verifier.js';
import {
  ProviderUnavailableError,
  type BlockchainProvider,
  type LogView,
  type TransactionReceiptView,
} from './types.js';

const CHAIN_ID = 84532;
const TOKEN = '0x036cbd53842c5426634e7929541ec2318f3dcf7e';
const OTHER_TOKEN = '0x9999999999999999999999999999999999999999';
const MERCHANT = '0x1111111111111111111111111111111111111111';
const ATTACKER = '0x2222222222222222222222222222222222222222';
const AGENT = '0x3333333333333333333333333333333333333333';
const TX_HASH = `0x${'ab'.repeat(32)}`;

function topicFor(address: string): string {
  return `0x${'0'.repeat(24)}${address.slice(2).toLowerCase()}`;
}

function valueData(value: bigint): string {
  return `0x${value.toString(16).padStart(64, '0')}`;
}

function transferLog(
  options: { token?: string; to?: string; value?: bigint; logIndex?: number } = {},
): LogView {
  return {
    address: options.token ?? TOKEN,
    topics: [ERC20_TRANSFER_TOPIC, topicFor(AGENT), topicFor(options.to ?? MERCHANT)],
    data: valueData(options.value ?? 30_000n),
    logIndex: options.logIndex ?? 0,
  };
}

function receipt(overrides: Partial<TransactionReceiptView> = {}): TransactionReceiptView {
  return {
    transactionHash: TX_HASH,
    status: 'success',
    blockNumber: 1_000n,
    blockHash: `0x${'cd'.repeat(32)}`,
    from: AGENT,
    to: TOKEN,
    logs: [transferLog()],
    ...overrides,
  };
}

interface FakeOptions {
  receipt?: TransactionReceiptView | null;
  head?: bigint;
  chainId?: number;
  receiptError?: unknown;
  headError?: unknown;
}

function fakeProvider(options: FakeOptions = {}): BlockchainProvider {
  return {
    chainId: options.chainId ?? CHAIN_ID,
    name: 'fake',
    async getTransactionReceipt() {
      if (options.receiptError) throw options.receiptError;
      return options.receipt === undefined ? receipt() : options.receipt;
    },
    async getBlockNumber() {
      if (options.headError) throw options.headError;
      return options.head ?? 1_005n;
    },
    async healthCheck() {
      return true;
    },
  };
}

function request(overrides: Partial<TransferVerificationRequest> = {}): TransferVerificationRequest {
  return {
    transactionHash: TX_HASH,
    chainId: CHAIN_ID,
    tokenAddress: TOKEN,
    expectedRecipient: MERCHANT,
    expectedMinorUnits: 30_000n,
    requiredConfirmations: 3,
    ...overrides,
  };
}

async function verify(options: FakeOptions = {}, req: Partial<TransferVerificationRequest> = {}) {
  return new Erc20SettlementVerifier(fakeProvider(options)).verifyTransfer(request(req));
}

describe('Erc20SettlementVerifier — accepting a valid payment', () => {
  it('verifies a correct transfer', async () => {
    const result = await verify();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({
      transactionHash: TX_HASH,
      chainId: CHAIN_ID,
      to: MERCHANT,
      from: AGENT,
      minorUnits: 30_000n,
      confirmations: 6,
    });
  });

  it('accepts an overpayment', async () => {
    const result = await verify({ receipt: receipt({ logs: [transferLog({ value: 50_000n })] }) });
    expect(result.ok).toBe(true);
  });

  it('sums multiple transfers to the merchant in one transaction', async () => {
    // Routers and smart accounts legitimately split a payment. The question is
    // whether the merchant received the asking price, not whether one log did.
    const result = await verify({
      receipt: receipt({
        logs: [
          transferLog({ value: 10_000n, logIndex: 0 }),
          transferLog({ value: 20_000n, logIndex: 1 }),
        ],
      }),
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.minorUnits).toBe(30_000n);
  });

  it('ignores unrelated transfers in the same transaction', async () => {
    const result = await verify({
      receipt: receipt({
        logs: [
          transferLog({ token: OTHER_TOKEN, value: 999_999n, logIndex: 0 }),
          transferLog({ to: ATTACKER, value: 999_999n, logIndex: 1 }),
          transferLog({ value: 30_000n, logIndex: 2 }),
        ],
      }),
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.minorUnits).toBe(30_000n);
  });

  it('accepts exactly the required number of confirmations', async () => {
    // Boundary: block 1000 with head 1002 is three confirmations inclusive.
    const result = await verify({ head: 1_002n }, { requiredConfirmations: 3 });
    expect(result.ok).toBe(true);
  });
});

describe('Erc20SettlementVerifier — rejecting invalid payments', () => {
  it('reports WRONG_ASSET when the correct recipient was paid in another token', async () => {
    const result = await verify({
      receipt: receipt({ logs: [transferLog({ token: OTHER_TOKEN })] }),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.reason).toBe('WRONG_ASSET');
  });

  it('reports WRONG_RECIPIENT when the correct token went to another address', async () => {
    const result = await verify({ receipt: receipt({ logs: [transferLog({ to: ATTACKER })] }) });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.reason).toBe('WRONG_RECIPIENT');
  });

  it('reports WRONG_AMOUNT on an underpayment, down to a single minor unit', async () => {
    const result = await verify({ receipt: receipt({ logs: [transferLog({ value: 29_999n })] }) });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.reason).toBe('WRONG_AMOUNT');
    expect(result.error.details).toMatchObject({ expected: '30000', observed: '29999' });
  });

  it('rejects a reverted transaction even when its logs look right', async () => {
    const result = await verify({ receipt: receipt({ status: 'reverted' }) });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.reason).toBe('TRANSACTION_REVERTED');
  });

  it('refuses to verify against a provider serving a different chain', async () => {
    const result = await verify({ chainId: 8453 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.reason).toBe('WRONG_NETWORK');
  });

  it('does not count a spoofed non-standard Transfer log', async () => {
    // A hostile token can emit anything. A log with a non-zero address padding
    // must not be read as a transfer to the merchant.
    const spoofed: LogView = {
      address: TOKEN,
      topics: [ERC20_TRANSFER_TOPIC, topicFor(AGENT), `0x${'0'.repeat(23)}1${MERCHANT.slice(2)}`],
      data: valueData(30_000n),
      logIndex: 0,
    };
    const result = await verify({ receipt: receipt({ logs: [spoofed] }) });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.reason).toBe('WRONG_ASSET');
  });

  it('rejects a transaction with no transfers at all', async () => {
    const result = await verify({ receipt: receipt({ logs: [] }) });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.reason).toBe('WRONG_ASSET');
  });
});

describe('Erc20SettlementVerifier — retryable conditions', () => {
  it('reports TRANSACTION_NOT_FOUND for an unknown transaction', async () => {
    const result = await verify({ receipt: null });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.reason).toBe('TRANSACTION_NOT_FOUND');
  });

  it('reports INSUFFICIENT_CONFIRMATIONS below the threshold', async () => {
    const result = await verify({ head: 1_000n }, { requiredConfirmations: 3 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.reason).toBe('INSUFFICIENT_CONFIRMATIONS');
    expect(result.error.details).toMatchObject({ confirmations: 1, required: 3 });
  });

  it('treats a lagging replica as zero confirmations rather than a negative count', async () => {
    // Load-balanced RPC pools really do serve a head behind a receipt they
    // just returned. Negative arithmetic here would underflow the comparison.
    const result = await verify({ head: 990n });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.reason).toBe('INSUFFICIENT_CONFIRMATIONS');
    expect(result.error.details).toMatchObject({ confirmations: 0 });
  });

  it('reports PROVIDER_UNAVAILABLE when the receipt lookup throws', async () => {
    const result = await verify({
      receiptError: new ProviderUnavailableError('fake', 'connection reset'),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.reason).toBe('PROVIDER_UNAVAILABLE');
    expect(result.error.message).toContain('connection reset');
  });

  it('reports PROVIDER_UNAVAILABLE when the head lookup throws', async () => {
    const result = await verify({ headError: new Error('gateway timeout') });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.reason).toBe('PROVIDER_UNAVAILABLE');
  });

  it('never reports a provider outage as a payer error', async () => {
    // The distinction matters: telling an agent its valid payment was invalid
    // because our RPC blinked invites a double payment.
    const result = await verify({ receiptError: new Error('boom') });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(['WRONG_AMOUNT', 'WRONG_RECIPIENT', 'WRONG_ASSET', 'MALFORMED_PROOF']).not.toContain(
      result.error.reason,
    );
  });
});

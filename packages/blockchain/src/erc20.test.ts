import { describe, expect, it } from 'vitest';
import { ERC20_TRANSFER_TOPIC, decodeTransferLog, decodeTransfers } from './erc20.js';
import type { LogView } from './types.js';

const TOKEN = '0x036cbd53842c5426634e7929541ec2318f3dcf7e';
const FROM = '0x3333333333333333333333333333333333333333';
const TO = '0x1111111111111111111111111111111111111111';

function topicFor(address: string): string {
  return `0x${'0'.repeat(24)}${address.slice(2).toLowerCase()}`;
}

function valueData(value: bigint): string {
  return `0x${value.toString(16).padStart(64, '0')}`;
}

function transferLog(overrides: Partial<LogView> = {}): LogView {
  return {
    address: TOKEN,
    topics: [ERC20_TRANSFER_TOPIC, topicFor(FROM), topicFor(TO)],
    data: valueData(30_000n),
    logIndex: 0,
    ...overrides,
  };
}

describe('decodeTransferLog — valid logs', () => {
  it('decodes a canonical ERC-20 Transfer', () => {
    expect(decodeTransferLog(transferLog())).toEqual({
      tokenAddress: TOKEN,
      from: FROM,
      to: TO,
      value: 30_000n,
      logIndex: 0,
    });
  });

  it('is insensitive to hex casing from different RPC providers', () => {
    const decoded = decodeTransferLog(
      transferLog({
        address: TOKEN.toUpperCase(),
        topics: [
          ERC20_TRANSFER_TOPIC.toUpperCase(),
          topicFor(FROM).toUpperCase(),
          topicFor(TO).toUpperCase(),
        ],
        data: valueData(30_000n).toUpperCase(),
      }),
    );
    expect(decoded?.value).toBe(30_000n);
    expect(decoded?.to).toBe(TO);
  });

  it('decodes a zero-value transfer', () => {
    expect(decodeTransferLog(transferLog({ data: valueData(0n) }))?.value).toBe(0n);
  });

  it('decodes the maximum uint256 without precision loss', () => {
    const max = 2n ** 256n - 1n;
    expect(decodeTransferLog(transferLog({ data: valueData(max) }))?.value).toBe(max);
  });
});

describe('decodeTransferLog — logs that must be rejected', () => {
  it('ignores a log with a different event signature', () => {
    // An Approval log carries the same argument shape. Counting one as a
    // payment would let an agent get served for approving a spend it never made.
    expect(
      decodeTransferLog(
        transferLog({ topics: [`0x${'11'.repeat(32)}`, topicFor(FROM), topicFor(TO)] }),
      ),
    ).toBeNull();
  });

  it.each([
    [[ERC20_TRANSFER_TOPIC, topicFor(FROM)], 'two topics'],
    [[ERC20_TRANSFER_TOPIC], 'one topic'],
    [[ERC20_TRANSFER_TOPIC, topicFor(FROM), topicFor(TO), topicFor(TO)], 'four topics'],
    [[], 'no topics'],
  ])('ignores a log with %s (%s)', (topics) => {
    expect(decodeTransferLog(transferLog({ topics }))).toBeNull();
  });

  it('rejects an address topic with a non-zero padding prefix', () => {
    // This is the interesting one. A 32-byte topic whose high 12 bytes are
    // non-zero is not an address. If we ignored the padding and read only the
    // low 20 bytes, a crafted log could alias the merchant's address and be
    // counted as a payment to them.
    const spoofed = `0x${'0'.repeat(23)}1${TO.slice(2)}`;
    expect(decodeTransferLog(transferLog({ topics: [ERC20_TRANSFER_TOPIC, topicFor(FROM), spoofed] }))).toBeNull();
  });

  it.each([
    ['0x', 'empty data'],
    [`0x${'0'.repeat(63)}`, 'one hex digit short'],
    [`0x${'0'.repeat(128)}`, 'two words instead of one'],
    ['not-hex-at-all', 'non-hex'],
    [`0x${'z'.repeat(64)}`, 'invalid hex characters'],
  ])('rejects a log whose data is %s (%s)', (data) => {
    expect(decodeTransferLog(transferLog({ data }))).toBeNull();
  });

  it('rejects a malformed topic that is not 32 bytes', () => {
    expect(
      decodeTransferLog(transferLog({ topics: [ERC20_TRANSFER_TOPIC, topicFor(FROM), '0x1234'] })),
    ).toBeNull();
  });
});

describe('decodeTransfers', () => {
  it('keeps the transfers and discards unrelated logs', () => {
    const logs: LogView[] = [
      { address: TOKEN, topics: [`0x${'99'.repeat(32)}`], data: '0x', logIndex: 0 },
      transferLog({ logIndex: 1 }),
      { address: TOKEN, topics: [], data: '0x', logIndex: 2 },
      transferLog({ logIndex: 3, data: valueData(70_000n) }),
    ];
    const decoded = decodeTransfers(logs);
    expect(decoded).toHaveLength(2);
    expect(decoded.map((transfer) => transfer.value)).toEqual([30_000n, 70_000n]);
  });

  it('returns an empty list for a transaction with no logs', () => {
    expect(decodeTransfers([])).toEqual([]);
  });
});

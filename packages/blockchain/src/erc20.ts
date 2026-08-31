/**
 * ERC-20 Transfer log decoding.
 *
 * Written by hand rather than delegated to an ABI decoder, for two reasons:
 *
 *  1. This is the point where an attacker-influenced blob becomes a monetary
 *    amount. The parsing rules should be readable in full, on one screen, by
 *    whoever reviews the payment path.
 *  2. A general ABI decoder is permissive by design — it will happily decode a
 *    log with unexpected topic counts or oversized data. Here every deviation
 *    from the canonical ERC-20 Transfer shape is rejected rather than
 *    interpreted, because a non-standard "Transfer" is exactly what a token
 *    designed to spoof a payment would emit.
 *
 * Canonical event:
 *     Transfer(address indexed from, address indexed to, uint256 value)
 *   topics[0] = keccak256("Transfer(address,address,uint256)")
 *   topics[1] = from, left-padded to 32 bytes
 *   topics[2] = to,   left-padded to 32 bytes
 *   data      = value, exactly one 32-byte word
 */

import type { LogView } from './types.js';

/** keccak256("Transfer(address,address,uint256)") */
export const ERC20_TRANSFER_TOPIC =
  '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

export interface DecodedTransfer {
  readonly tokenAddress: string;
  readonly from: string;
  readonly to: string;
  readonly value: bigint;
  readonly logIndex: number;
}

const TOPIC_LENGTH = 66; // '0x' + 64 hex characters
const HEX_WORD = /^0x[0-9a-f]{64}$/;

/**
 * Extract a 20-byte address from a 32-byte topic.
 *
 * The first 12 bytes must be zero. A non-zero prefix means the value is not an
 * address, and accepting it would let a crafted log masquerade as a transfer
 * to the merchant by aliasing the low 20 bytes.
 */
function addressFromTopic(topic: string): string | null {
  if (topic.length !== TOPIC_LENGTH || !HEX_WORD.test(topic)) {
    return null;
  }
  const padding = topic.slice(2, 26);
  if (padding !== '0'.repeat(24)) {
    return null;
  }
  return `0x${topic.slice(26)}`;
}

/**
 * Decode a single log as an ERC-20 Transfer, or return null if it is not one.
 *
 * Returning null rather than throwing is deliberate: a transaction legitimately
 * contains many logs we do not care about, and a non-Transfer log is not an
 * error condition.
 */
export function decodeTransferLog(log: LogView): DecodedTransfer | null {
  const normalized = log.topics.map((topic) => topic.toLowerCase());

  if (normalized.length !== 3) {
    return null;
  }
  if (normalized[0] !== ERC20_TRANSFER_TOPIC) {
    return null;
  }

  const from = addressFromTopic(normalized[1] ?? '');
  const to = addressFromTopic(normalized[2] ?? '');
  if (from === null || to === null) {
    return null;
  }

  // Exactly one 32-byte word. A longer payload is not a standard Transfer, and
  // silently reading only its first word would let a crafted token hide a
  // different value behind the one we check.
  const data = log.data.toLowerCase();
  if (!HEX_WORD.test(data)) {
    return null;
  }

  return {
    tokenAddress: log.address.toLowerCase(),
    from,
    to,
    value: BigInt(data),
    logIndex: log.logIndex,
  };
}

/** Decode every ERC-20 Transfer in a receipt's logs, discarding the rest. */
export function decodeTransfers(logs: readonly LogView[]): readonly DecodedTransfer[] {
  const transfers: DecodedTransfer[] = [];
  for (const log of logs) {
    const decoded = decodeTransferLog(log);
    if (decoded !== null) {
      transfers.push(decoded);
    }
  }
  return transfers;
}

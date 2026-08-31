/**
 * The blockchain access boundary.
 *
 * `BlockchainProvider` is deliberately tiny — three read methods. Payment
 * verification needs a transaction receipt and a chain head, and nothing else.
 * Keeping the interface this small means:
 *
 *  - The verification logic can be tested against a hand-built receipt with no
 *    network, no fixtures, and no mocking framework.
 *  - Adding Solana later means implementing three methods, not reimplementing
 *    an RPC client's whole surface.
 *  - There is no method here that can move funds. Meter402 verifies payments;
 *    it never holds or sends them, which keeps custody out of the threat model
 *    entirely (see docs/THREAT_MODEL.md).
 */

export type TransactionStatus = 'success' | 'reverted';

export interface LogView {
  readonly address: string;
  readonly topics: readonly string[];
  readonly data: string;
  readonly logIndex: number;
}

export interface TransactionReceiptView {
  readonly transactionHash: string;
  readonly status: TransactionStatus;
  readonly blockNumber: bigint;
  readonly blockHash: string;
  readonly from: string;
  readonly to: string | null;
  readonly logs: readonly LogView[];
}

export interface BlockchainProvider {
  /** Which chain this provider speaks for. Checked against every request. */
  readonly chainId: number;
  /** Human-readable label used in logs and health reporting. */
  readonly name: string;

  /** Resolves to null when the transaction is not known to this node. */
  getTransactionReceipt(transactionHash: string): Promise<TransactionReceiptView | null>;

  getBlockNumber(): Promise<bigint>;

  /** Cheap liveness probe used by the failover provider and /ready. */
  healthCheck(): Promise<boolean>;
}

/**
 * Raised when a provider itself is unreachable or misbehaving, as distinct
 * from the chain giving us an answer we do not like. The two must not be
 * conflated: the first is our problem and retryable, the second is the
 * caller's and final.
 */
export class ProviderUnavailableError extends Error {
  constructor(
    readonly providerName: string,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'ProviderUnavailableError';
  }
}

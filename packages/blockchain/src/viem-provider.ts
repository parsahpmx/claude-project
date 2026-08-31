import { createPublicClient, http, type Chain, type PublicClient } from 'viem';
import { base, baseSepolia } from 'viem/chains';
import { BASE_MAINNET, BASE_SEPOLIA } from '@meter402/shared';
import {
  ProviderUnavailableError,
  type BlockchainProvider,
  type TransactionReceiptView,
} from './types.js';

/**
 * viem-backed provider for Base.
 *
 * This is the only file in the payment path that talks to the network, and it
 * does nothing but translate: RPC shapes in, our `TransactionReceiptView` out.
 * All judgement about whether a payment is valid happens in
 * `Erc20SettlementVerifier` against that neutral shape, which is what keeps
 * verification testable without a chain.
 */

const CHAINS_BY_ID: Readonly<Record<number, Chain>> = {
  [BASE_MAINNET.id]: base,
  [BASE_SEPOLIA.id]: baseSepolia,
};

export interface ViemProviderOptions {
  readonly chainId: number;
  readonly rpcUrl: string;
  /** Label used in logs, breaker state, and health output. */
  readonly name: string;
  readonly timeoutMs?: number;
}

/**
 * viem signals "no such transaction" with a typed error rather than a null
 * return. We match on the error name instead of importing the class: the
 * import would couple us to viem's internal export surface across minor
 * versions, and this predicate is exercised by a unit test either way.
 */
function isReceiptNotFound(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const name = (error as { name?: unknown }).name;
  return name === 'TransactionReceiptNotFoundError';
}

export class ViemBlockchainProvider implements BlockchainProvider {
  readonly chainId: number;
  readonly name: string;

  private readonly client: PublicClient;

  constructor(options: ViemProviderOptions) {
    const chain = CHAINS_BY_ID[options.chainId];
    if (!chain) {
      throw new Error(
        `Unsupported chain ${options.chainId}. Supported: ${Object.keys(CHAINS_BY_ID).join(', ')}.`,
      );
    }

    this.chainId = options.chainId;
    this.name = options.name;
    this.client = createPublicClient({
      chain,
      transport: http(options.rpcUrl, {
        timeout: options.timeoutMs ?? 10_000,
        // One retry absorbs a transient blip; beyond that the failover
        // provider should move on rather than compounding latency on a
        // merchant's critical path.
        retryCount: 1,
      }),
    });
  }

  async getTransactionReceipt(transactionHash: string): Promise<TransactionReceiptView | null> {
    try {
      const receipt = await this.client.getTransactionReceipt({
        hash: transactionHash as `0x${string}`,
      });

      return {
        transactionHash: receipt.transactionHash,
        status: receipt.status,
        blockNumber: receipt.blockNumber,
        blockHash: receipt.blockHash,
        from: receipt.from,
        to: receipt.to ?? null,
        logs: receipt.logs.map((log) => ({
          address: log.address,
          topics: log.topics,
          data: log.data,
          // A mined receipt always carries a log index; the null case exists in
          // viem's type only for pending logs, which cannot appear here.
          logIndex: log.logIndex ?? 0,
        })),
      };
    } catch (error) {
      if (isReceiptNotFound(error)) {
        return null;
      }
      throw new ProviderUnavailableError(
        this.name,
        `getTransactionReceipt failed: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
  }

  async getBlockNumber(): Promise<bigint> {
    try {
      return await this.client.getBlockNumber();
    } catch (error) {
      throw new ProviderUnavailableError(
        this.name,
        `getBlockNumber failed: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.client.getBlockNumber();
      return true;
    } catch {
      return false;
    }
  }
}

/** Exported for direct unit testing of the not-found predicate. */
export const __testing = { isReceiptNotFound };

import { createPublicClient, http, type Chain, type PublicClient } from 'viem';
import { base, baseSepolia } from 'viem/chains';
import { BASE_MAINNET, BASE_SEPOLIA } from '@meter402/shared';
import {
  ProviderUnavailableError,
  type BlockchainProvider,
  type TransactionReceiptView,
} from './types.js';
import { err, ok, type Result } from '@meter402/shared';
import {
  EIP3009_AUTHORIZATION_STATE_ABI,
  type AuthorizationQuery,
  type OracleFailure,
  type SettlementOracle,
} from './settlement-oracle.js';

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

/**
 * A settlement oracle backed by a viem public client.
 *
 * Reads `authorizationState` from the token contract — the EIP-3009 replay
 * flag — and searches `Transfer` logs for the transaction that consumed it.
 * Both are read-only: reconciliation determines what already happened and can
 * never itself move money.
 */
export class ViemSettlementOracle implements SettlementOracle {
  private readonly client: PublicClient;

  constructor(
    private readonly chainId: number,
    rpcUrl: string,
    options: { timeoutMs?: number; lookbackBlocks?: bigint } = {},
  ) {
    const chain = CHAINS_BY_ID[chainId];
    if (!chain) {
      throw new Error(`Unsupported chain ${chainId} for settlement oracle.`);
    }
    this.client = createPublicClient({
      chain,
      transport: http(rpcUrl, { timeout: options.timeoutMs ?? 10_000, retryCount: 1 }),
    });
    this.lookbackBlocks = options.lookbackBlocks ?? 50_000n;
  }

  private readonly lookbackBlocks: bigint;

  async authorizationUsed(query: AuthorizationQuery): Promise<Result<boolean, OracleFailure>> {
    if (query.chainId !== this.chainId) {
      return err({
        kind: 'UNSUPPORTED',
        message: `Oracle is bound to chain ${this.chainId}, asked about ${query.chainId}.`,
      });
    }

    try {
      const used = await this.client.readContract({
        address: query.assetAddress as `0x${string}`,
        abi: EIP3009_AUTHORIZATION_STATE_ABI,
        functionName: 'authorizationState',
        args: [query.payerAddress as `0x${string}`, query.authorizationNonce as `0x${string}`],
      });
      return ok(Boolean(used));
    } catch (error) {
      /*
       * Unreachable node, reverted call, contract without EIP-3009. All map to
       * UNAVAILABLE rather than to "not used": an error is not evidence that
       * the transfer did not happen, and treating it as such is precisely the
       * mistake that would mark a settled payment as failed.
       */
      return err({
        kind: 'UNAVAILABLE',
        message: error instanceof Error ? error.message : 'authorizationState read failed',
      });
    }
  }

  async findSettlementTransaction(
    query: AuthorizationQuery & { recipientAddress: string; amountMinorUnits: bigint },
  ): Promise<Result<string | null, OracleFailure>> {
    try {
      const latest = await this.client.getBlockNumber();
      const fromBlock = latest > this.lookbackBlocks ? latest - this.lookbackBlocks : 0n;

      const logs = await this.client.getLogs({
        address: query.assetAddress as `0x${string}`,
        event: {
          type: 'event',
          name: 'Transfer',
          inputs: [
            { name: 'from', type: 'address', indexed: true },
            { name: 'to', type: 'address', indexed: true },
            { name: 'value', type: 'uint256', indexed: false },
          ],
        },
        args: {
          from: query.payerAddress as `0x${string}`,
          to: query.recipientAddress as `0x${string}`,
        },
        fromBlock,
        toBlock: latest,
      });

      // Match on the exact amount too: a payer may have several transfers to
      // the same recipient, and only the one for this amount is ours.
      const match = logs.find((log) => log.args.value === query.amountMinorUnits);
      return ok(match?.transactionHash ?? null);
    } catch (error) {
      return err({
        kind: 'UNAVAILABLE',
        message: error instanceof Error ? error.message : 'log search failed',
      });
    }
  }
}

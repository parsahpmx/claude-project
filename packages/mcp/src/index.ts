import type { Meter402, Meter402Context } from '@meter402/sdk';
import { isMeter402SdkError } from '@meter402/sdk';

/**
 * @meter402/mcp — paid MCP tools.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *     const server = new McpServer({ name: 'research', version: '1.0.0' });
 *
 *     server.tool(
 *       'deep_research',
 *       'Research a topic in depth.',
 *       { topic: z.string() },
 *       paidTool(meter, { price: '0.05' }, async ({ topic }, payment) => ({
 *         content: [{ type: 'text', text: await research(topic) }],
 *       })),
 *     );
 * ─────────────────────────────────────────────────────────────────────────
 *
 * ### Why this is a wrapper and not an engine
 *
 * MCP is a different transport, not a different payment problem. A tool call
 * that costs money needs the same price snapshot, the same exactly-once
 * settlement, the same replay protection and the same receipt as an HTTP
 * request — so it goes through `/v1/authorize` like everything else, and this
 * file is only the shape adapter.
 *
 * Building a second payment path for MCP would mean two implementations of
 * exactly-once, which is two chances to get it wrong and one guarantee that
 * they will eventually disagree.
 *
 * ### How an MCP client pays
 *
 * MCP has no 402. It has structured tool results, so an unpaid call returns
 * one that *says* payment is required and carries the challenge — the caller
 * pays out of band and calls the tool again with the proof.
 *
 * That is a deliberately conservative mapping. It does not invent protocol,
 * it degrades safely (a client that ignores the payment result simply sees an
 * error), and the money path underneath is byte-for-byte the HTTP one.
 */

export interface PaidToolOptions {
  /** What this tool costs, as a decimal string: `'0.05'`. */
  readonly price?: string;
  /**
   * The Meter402 endpoint backing this tool.
   *
   * Defaults to `/mcp/tools/<name>`, so a tool is registered like any other
   * route and the same endpoint registry, pricing rules and receipts apply.
   */
  readonly path?: string;
  /** Tool name, used to derive the default path. */
  readonly name?: string;
}

/** What an MCP tool handler receives about the payment that bought the call. */
export type ToolPayment = Meter402Context;

/**
 * The subset of an MCP tool result this package constructs.
 *
 * Structural rather than imported, so this package does not depend on a
 * specific MCP SDK version — the shape has been stable and the dependency
 * would not be.
 */
export interface McpToolResult {
  readonly content: ReadonlyArray<{ readonly type: 'text'; readonly text: string }>;
  readonly isError?: boolean;
  /** Machine-readable, for a client that knows how to pay. */
  readonly _meta?: Readonly<Record<string, unknown>>;
}

export type PaidToolHandler<Args> = (
  args: Args,
  payment: ToolPayment,
  extra?: unknown,
) => Promise<McpToolResult> | McpToolResult;

/**
 * Where an MCP client puts payment proof.
 *
 * A reserved argument rather than a transport header, because MCP tool calls
 * do not carry per-call headers. Underscore-prefixed so it does not collide
 * with a tool's own schema.
 */
export const PAYMENT_ARGUMENT = '_meter402Payment';

export function paidTool<Args extends Record<string, unknown>>(
  meter: Meter402,
  options: PaidToolOptions,
  handler: PaidToolHandler<Args>,
): (args: Args, extra?: unknown) => Promise<McpToolResult> {
  const path = options.path ?? `/mcp/tools/${options.name ?? 'tool'}`;

  return async function paidToolHandler(args: Args, extra?: unknown): Promise<McpToolResult> {
    const proof =
      typeof args[PAYMENT_ARGUMENT] === 'string' ? String(args[PAYMENT_ARGUMENT]) : null;

    let result;
    try {
      result = await meter.authorize({
        method: 'POST',
        path,
        headers: proof ? { 'meter402-payment': proof } : {},
      });
    } catch (error) {
      /*
       * Errors become tool results rather than exceptions. An MCP client that
       * receives a thrown error learns nothing actionable; one that receives
       * `isError` with a sentence can tell its user why the tool did not run.
       */
      const unavailable = isMeter402SdkError(error) && error.kind === 'unavailable';

      /*
       * A configuration message is carried through rather than flattened.
       * The SDK already knows to say "no endpoint is registered for POST
       * /mcp/tools/deep_research, create it with…", and replacing that with
       * "misconfigured" throws away the only part a developer can act on. The
       * SDK builds these messages from its own strings and never includes a
       * credential, so forwarding one is safe.
       */
      const detail =
        !unavailable && isMeter402SdkError(error) && error.kind === 'configuration'
          ? ` ${error.message}`
          : '';

      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: unavailable
              ? 'Payment authorization is temporarily unavailable. Try again shortly.'
              : `This paid tool is misconfigured and cannot run.${detail}`,
          },
        ],
        _meta: { 'meter402/error': unavailable ? 'unavailable' : 'misconfigured' },
      };
    }

    if (result.outcome === 'PAYMENT_REQUIRED') {
      /*
       * The MCP equivalent of a 402: a result that says what is owed and how
       * to satisfy it. `isError` so a client that understands nothing about
       * payments still surfaces it rather than treating the challenge as an
       * answer.
       */
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text:
              `This tool requires payment. Pay payment request ` +
              `${result.paymentRequestId}, then call the tool again with the proof in ` +
              `\`${PAYMENT_ARGUMENT}\`.`,
          },
        ],
        _meta: {
          'meter402/paymentRequired': true,
          'meter402/paymentRequestId': result.paymentRequestId,
          'meter402/challenge': result.respondWith.body,
          'meter402/paymentArgument': PAYMENT_ARGUMENT,
        },
      };
    }

    /*
     * Paid. The payment is spent whether or not the handler succeeds — the
     * usage event was written inside the gate's transaction — so a handler
     * that throws here has consumed a payment. That is the same ordering the
     * HTTP path has for simulated settlement, and saying so plainly is better
     * than implying a rollback that does not exist.
     */
    const payment: ToolPayment = {
      paymentRequestId: result.paymentRequestId,
      payment: result.payment,
      endpoint: result.endpoint,
    };

    const toolResult = await handler(stripPaymentArgument(args), payment, extra);

    return {
      ...toolResult,
      _meta: {
        ...toolResult._meta,
        'meter402/paymentId': payment.payment.id,
        'meter402/receiptId': payment.payment.receiptId,
      },
    };
  };
}

/**
 * Keep the payment proof out of the tool's own arguments.
 *
 * A handler should see exactly the schema it declared. Leaving a reserved
 * argument in would also mean a tool that echoes its input echoes a payment
 * proof, into whatever logs the merchant keeps.
 */
function stripPaymentArgument<Args extends Record<string, unknown>>(args: Args): Args {
  if (!(PAYMENT_ARGUMENT in args)) return args;
  const { [PAYMENT_ARGUMENT]: _removed, ...rest } = args;
  return rest as Args;
}

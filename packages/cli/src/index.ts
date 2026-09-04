import { init } from './commands/init.js';
import { doctor } from './commands/doctor.js';
import {
  listEndpoints,
  listPayments,
  listReceipts,
  testPayment,
  whoami,
} from './commands/inspect.js';
import { ApiError } from './api.js';
import { isMeter402SdkError } from '@meter402/sdk';
import { bold, cyan, dim, errorLine, line } from './output.js';

export { init } from './commands/init.js';
export { doctor } from './commands/doctor.js';
export * from './commands/inspect.js';
export * from './config.js';
export { ManagementApi, ApiError } from './api.js';

/**
 * The `meter402` command.
 *
 * Argument parsing is deliberately hand-rolled and small. A CLI that needs a
 * parsing framework to express `--price 0.03` has more surface than it needs,
 * and this one is on the critical path of a developer's first ten minutes.
 */

const USAGE = `
${bold('meter402')} — billing for autonomous software

  ${cyan('meter402 init')}                    set up a project, an endpoint, and a TEST key
  ${cyan('meter402 doctor')}                  check the setup end to end
  ${cyan('meter402 whoami')}                  what this credential is
  ${cyan('meter402 endpoints')}               what is registered and what it costs
  ${cyan('meter402 payments')}                recent payments
  ${cyan('meter402 receipts')}                recent receipts
  ${cyan('meter402 test-payment <id>')}       pay a challenge, TEST only

${dim('Options')}
  --api-url <url>       Meter402 base URL          ${dim('(default: from .meter402.json)')}
  --path <path>         route to protect           ${dim('(init, default: /research)')}
  --method <method>     HTTP method                ${dim('(init, default: POST)')}
  --price <amount>      price as a decimal string  ${dim('(init, default: 0.03)')}
  --asset <symbol>      asset                      ${dim('(init, default: USDC)')}
  --email <address>     account to sign in as      ${dim('(init)')}
  --name <name>         organization/project name  ${dim('(init)')}
  --limit <n>           rows to show               ${dim('(payments, receipts)')}
`;

export interface Flags {
  readonly [key: string]: string | boolean | undefined;
}

/**
 * `--key value`, `--key=value`, and bare `--flag`.
 *
 * A value that itself starts with `--` is treated as the next flag rather than
 * as this one's value, so a forgotten argument produces a clear "missing"
 * error instead of silently consuming the following option.
 */
export function parseFlags(argv: readonly string[]): { positional: string[]; flags: Flags } {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index] ?? '';

    if (!argument.startsWith('--')) {
      positional.push(argument);
      continue;
    }

    const withoutDashes = argument.slice(2);
    const equals = withoutDashes.indexOf('=');
    if (equals !== -1) {
      flags[withoutDashes.slice(0, equals)] = withoutDashes.slice(equals + 1);
      continue;
    }

    const next = argv[index + 1];
    if (next !== undefined && !next.startsWith('--')) {
      flags[withoutDashes] = next;
      index += 1;
    } else {
      flags[withoutDashes] = true;
    }
  }

  return { positional, flags };
}

function stringFlag(flags: Flags, name: string, fallback: string): string {
  const value = flags[name];
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

export async function run(argv: readonly string[], cwd = process.cwd()): Promise<number> {
  const { positional, flags } = parseFlags(argv);
  const command = positional[0];

  if (!command || command === 'help' || flags['help'] === true) {
    line(USAGE);
    return command ? 0 : 1;
  }

  const apiUrlFlag = typeof flags['api-url'] === 'string' ? flags['api-url'] : undefined;
  const shared = { cwd, ...(apiUrlFlag ? { apiUrl: apiUrlFlag } : {}) };

  try {
    switch (command) {
      case 'init': {
        const result = await init({
          cwd,
          apiUrl: stringFlag(flags, 'api-url', 'http://localhost:8080'),
          path: stringFlag(flags, 'path', '/research'),
          method: stringFlag(flags, 'method', 'POST'),
          price: stringFlag(flags, 'price', '0.03'),
          asset: stringFlag(flags, 'asset', 'USDC'),
          name: stringFlag(flags, 'name', 'My API'),
          email: stringFlag(flags, 'email', 'developer@example.test'),
        });
        return result.exitCode;
      }

      case 'doctor':
        return await doctor(shared);

      case 'whoami':
        return await whoami(shared);

      case 'endpoints':
        return await listEndpoints(shared);

      case 'payments':
        return await listPayments({ ...shared, limit: numberFlag(flags, 'limit') });

      case 'receipts':
        return await listReceipts({ ...shared, limit: numberFlag(flags, 'limit') });

      case 'test-payment': {
        const paymentRequestId = positional[1];
        if (!paymentRequestId) {
          errorLine('Usage: meter402 test-payment <payment-request-id>');
          errorLine('');
          errorLine('The ID is in the 402 response body, under `payment.paymentRequestId`.');
          return 1;
        }
        return await testPayment({ ...shared, paymentRequestId });
      }

      default:
        errorLine(`Unknown command: ${command}`);
        line(USAGE);
        return 1;
    }
  } catch (error) {
    /*
     * One place where every failure becomes a message. The distinction that
     * matters to someone at a terminal is "the server is not there" versus
     * "the server said no", so those read differently.
     */
    errorLine('');
    if (isMeter402SdkError(error) && error.kind === 'unavailable') {
      errorLine(`  ${error.message}`);
      errorLine(dim('  Is the API running? Check --api-url.'));
    } else if (error instanceof ApiError) {
      errorLine(`  ${error.message}`);
      if (error.code) errorLine(dim(`  ${error.code}`));
      if (error.requestId) errorLine(dim(`  request ${error.requestId}`));
    } else {
      errorLine(`  ${error instanceof Error ? error.message : String(error)}`);
    }
    errorLine('');
    return 1;
  }
}

function numberFlag(flags: Flags, name: string): number | undefined {
  const value = flags[name];
  if (typeof value !== 'string') return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

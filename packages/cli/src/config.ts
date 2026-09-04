import { readFileSync, writeFileSync, existsSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Local project configuration.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * Two files, and the split between them is the whole point:
 *
 *   .meter402.json   committed. Which project, which endpoints, which API.
 *                    Identifiers only — safe in a pull request, useful in a
 *                    code review, meaningful to a teammate who clones the repo.
 *
 *   .env             never committed. The API key.
 *
 * A single config file holding both is how API keys end up in git history,
 * where deleting them does not remove them. So the key is never written to the
 * committed file, and `meter402 init` refuses to finish without checking that
 * `.env` is actually ignored.
 * ─────────────────────────────────────────────────────────────────────────
 */

export const CONFIG_FILE = '.meter402.json';
export const ENV_FILE = '.env';
export const API_KEY_VAR = 'METER402_API_KEY';

export interface ProjectConfig {
  /** Meter402's base URL. */
  readonly apiUrl: string;
  /** The project these endpoints belong to. An identifier, not a secret. */
  readonly projectId: string;
  readonly organizationId: string;
  /** TEST or LIVE. Recorded so `doctor` can say which world you are in. */
  readonly environment: string;
  readonly endpoints: ReadonlyArray<{
    readonly path: string;
    readonly method: string;
    readonly price: string;
    readonly asset: string;
  }>;
}

export function configPath(cwd: string): string {
  return join(cwd, CONFIG_FILE);
}

export function readConfig(cwd: string): ProjectConfig | null {
  const path = configPath(cwd);
  if (!existsSync(path)) return null;

  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (typeof parsed !== 'object' || parsed === null) return null;
    const row = parsed as Record<string, unknown>;
    return {
      apiUrl: String(row['apiUrl'] ?? ''),
      projectId: String(row['projectId'] ?? ''),
      organizationId: String(row['organizationId'] ?? ''),
      environment: String(row['environment'] ?? ''),
      endpoints: Array.isArray(row['endpoints'])
        ? (row['endpoints'] as ProjectConfig['endpoints'])
        : [],
    };
  } catch {
    return null;
  }
}

export function writeConfig(cwd: string, config: ProjectConfig): void {
  /*
   * Written through a whitelist of fields rather than by serialising whatever
   * was passed. A future caller that hands this an object carrying a secret
   * cannot accidentally persist it into the committed file.
   */
  const safe: ProjectConfig = {
    apiUrl: config.apiUrl,
    projectId: config.projectId,
    organizationId: config.organizationId,
    environment: config.environment,
    endpoints: config.endpoints.map((endpoint) => ({
      path: endpoint.path,
      method: endpoint.method,
      price: endpoint.price,
      asset: endpoint.asset,
    })),
  };

  writeFileSync(configPath(cwd), `${JSON.stringify(safe, null, 2)}\n`, 'utf8');
}

/** The API key, from the environment or from a local `.env`. */
export function readApiKey(cwd: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const fromEnv = env[API_KEY_VAR]?.trim();
  if (fromEnv) return fromEnv;

  const path = join(cwd, ENV_FILE);
  if (!existsSync(path)) return null;

  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const match = /^\s*(?:export\s+)?METER402_API_KEY\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    const value = (match[1] ?? '').trim().replace(/^["']|["']$/g, '');
    if (value) return value;
  }
  return null;
}

/**
 * Whether `.env` is ignored by git.
 *
 * Checked before writing a key into it, not after. "You committed your API
 * key, here is how to rotate it" is a worse message than refusing to write it.
 */
export function envFileIsIgnored(cwd: string): boolean {
  const gitignore = join(cwd, '.gitignore');
  if (!existsSync(gitignore)) return false;

  return readFileSync(gitignore, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .some(
      (line) => line === '.env' || line === '.env*' || line === '*.env' || line === '.env.local',
    );
}

/** Add the key to `.env`, replacing any existing value. */
export function writeApiKey(cwd: string, apiKey: string): void {
  const path = join(cwd, ENV_FILE);
  const line = `${API_KEY_VAR}=${apiKey}`;

  if (!existsSync(path)) {
    writeFileSync(path, `${line}\n`, 'utf8');
    return;
  }

  const contents = readFileSync(path, 'utf8');
  if (new RegExp(`^\\s*(?:export\\s+)?${API_KEY_VAR}\\s*=`, 'm').test(contents)) {
    writeFileSync(
      path,
      contents.replace(new RegExp(`^\\s*(?:export\\s+)?${API_KEY_VAR}\\s*=.*$`, 'm'), line),
      'utf8',
    );
    return;
  }

  appendFileSync(path, `${contents.endsWith('\n') ? '' : '\n'}${line}\n`, 'utf8');
}

/**
 * A credential rendered for a human, with the secret removed.
 *
 * Enough to tell two keys apart in a terminal; not enough to use one. The CLI
 * prints a lot of diagnostics, and diagnostics get pasted into issues.
 */
export function maskKey(apiKey: string): string {
  if (apiKey.length <= 12) return '***';
  return `${apiKey.slice(0, 8)}…${apiKey.slice(-4)}`;
}

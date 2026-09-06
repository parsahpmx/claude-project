// `pnpm --filter <path>` exits 0 when the pattern matches no projects. That is
// how `--filter ./packages/...` — which matches nothing; the working form is
// `./packages/**` — sat in the root build script building zero packages while
// reporting success. Every consumer then failed with "Cannot find module
// '@forge/core'", but only on a checkout with no stale dist/ lying around.
//
// So: assert the artifacts the workspace actually depends on.
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// The packages consumed through dist/ rather than src/. @forge/contracts is
// deliberately absent: it exports ./src/index.ts and emits nothing.
const required = ['packages/core/dist/index.js', 'packages/db/dist/index.js'];

const missing = required.filter((f) => !existsSync(join(root, f)));

if (missing.length > 0) {
  console.error('Package build produced no output. Missing:');
  for (const f of missing) console.error(`  ${f}`);
  console.error('\nCheck the --filter pattern in the root "build:packages" script.');
  process.exit(1);
}

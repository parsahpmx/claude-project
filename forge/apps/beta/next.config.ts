import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import type { NextConfig } from 'next';

const WORKSPACE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  /**
   * Which directory the build lands in.
   *
   * The browser suite starts its own dev server, and by default that server
   * shares `.next` with `pnpm build` and with any dev server already running.
   * When two of them write it at once the running server starts answering 500
   * with an ENOENT for a compiled page file under `.next` — which reads exactly
   * like a broken page and is not one. Pointing the test server at its own
   * directory makes the tests independent of whatever else is building.
   */
  distDir: process.env.NEXT_DIST_DIR ?? '.next',
  outputFileTracingRoot: WORKSPACE_ROOT,
  // The workspace packages ship TypeScript source rather than a build step.
  transpilePackages: ['@forge/contracts', '@forge/core'],
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(self)' },
        ],
      },
    ];
  },
};

export default nextConfig;

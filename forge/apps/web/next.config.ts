import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import type { NextConfig } from 'next';

const API_ORIGIN = process.env.FORGE_API_ORIGIN ?? 'http://localhost:4000';

// FORGE lives in a subdirectory of a larger repository, so Next sees two
// lockfiles and guesses at the workspace root. Naming it removes the guess —
// and the build warning that came with it.
const WORKSPACE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * The browser and the server both talk to the API at a same-origin `/api`
 * path. That keeps the session cookie first-party in every environment — no
 * CORS preflight on navigation, no SameSite surprises, and no separate cookie
 * domain to configure per environment.
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  outputFileTracingRoot: WORKSPACE_ROOT,
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${API_ORIGIN}/:path*` }];
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Permissions-Policy', value: 'camera=(self), microphone=(self), geolocation=()' },
        ],
      },
    ];
  },
};

export default nextConfig;

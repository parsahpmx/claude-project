/**
 * Which paths may be served without a session.
 *
 * This is deliberately an allowlist of **public** paths, so that anything not
 * named here requires authentication. The previous shape was the inverse — a
 * list of protected prefixes — which meant a route nobody remembered to add
 * was served to anonymous visitors, silently and with nothing to notice. For a
 * platform about to grow `/coach`, `/gym` and `/admin`, forgetting must fail
 * closed: a missing entry here costs a redirect to sign-in, which someone
 * reports in minutes, rather than a data leak nobody sees.
 *
 * Kept as pure functions so the policy can be unit tested without a request.
 */

/** Marketing and entry pages, matched exactly. */
const PUBLIC_EXACT: ReadonlySet<string> = new Set([
  '/',
  '/features',
  '/how-it-works',
  '/pricing',
  '/about',
  '/privacy',
  '/terms',
  '/login',
  '/signup',
]);

/**
 * Prefixes served without a session.
 *
 * `/auth/` carries the OAuth and email-confirmation callbacks, which by
 * definition run before a session exists — gating them would make sign-in
 * impossible. `/_next/` is framework infrastructure rather than a page; the
 * middleware matcher already drops the static and image subtrees, and the
 * remainder (HMR in development, RSC internals) must not be redirected.
 */
const PUBLIC_PREFIXES: readonly string[] = ['/auth/', '/_next/'];

/** Well-known files a crawler or browser fetches unauthenticated. */
const PUBLIC_FILES: ReadonlySet<string> = new Set([
  '/robots.txt',
  '/sitemap.xml',
  '/manifest.webmanifest',
  '/favicon.ico',
]);

/** Trailing slashes are equivalent to their bare form, except for the root. */
function normalize(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith('/')) return pathname.slice(0, -1);
  return pathname;
}

/** True when `pathname` may be served to an anonymous visitor. */
export function isPublicPath(pathname: string): boolean {
  const path = normalize(pathname);
  if (PUBLIC_EXACT.has(path)) return true;
  if (PUBLIC_FILES.has(path)) return true;
  return PUBLIC_PREFIXES.some((prefix) => path === normalize(prefix) || path.startsWith(prefix));
}

/**
 * True when a session is required. Anything not explicitly public is, which is
 * the whole point — new routes are protected until someone decides otherwise.
 */
export function requiresSession(pathname: string): boolean {
  return !isPublicPath(pathname);
}

/** The sign-in page is pointless for someone who already has a session. */
export function isAuthEntryPath(pathname: string): boolean {
  const path = normalize(pathname);
  return path === '/login' || path === '/signup';
}

// ---------------------------------------------------------------------------
// Route classes
// ---------------------------------------------------------------------------

/**
 * What kind of authorization a path needs, beyond merely having a session.
 *
 * Middleware cannot answer these. Resolving a person's organization roles takes
 * database round trips, and middleware runs on every request including static
 * navigation — so it enforces *authentication* only, and each area's layout
 * enforces *authorization* with `requirePermission`. Two layers, each doing the
 * job it can do cheaply and correctly, with RLS underneath as the last one.
 *
 * The classes are declared before the areas exist so that the day someone adds
 * `/gym/members`, the test below already says what it must require.
 */
export type RouteClass = 'public' | 'member' | 'coach' | 'organization' | 'platform';

const CLASS_PREFIXES: readonly (readonly [string, RouteClass])[] = [
  ['/coach', 'coach'],
  ['/gym', 'organization'],
  ['/admin', 'platform'],
];

/** Classify a path. Anything signed-in but unclassified is ordinary member area. */
export function classifyRoute(pathname: string): RouteClass {
  const path = normalize(pathname);
  if (isPublicPath(path)) return 'public';
  for (const [prefix, cls] of CLASS_PREFIXES) {
    if (path === prefix || path.startsWith(`${prefix}/`)) return cls;
  }
  return 'member';
}

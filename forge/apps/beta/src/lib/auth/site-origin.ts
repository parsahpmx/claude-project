/**
 * The origin this site is actually reached on.
 *
 * `request.nextUrl.origin` is the origin of the request *as the server received
 * it*, which is not the origin the browser used. Behind a proxy, a load
 * balancer, or simply in development, it can differ — a request to
 * `http://127.0.0.1:3000` arrives with `nextUrl.origin` of
 * `http://localhost:3000`.
 *
 * That difference is not cosmetic. Redirecting to the wrong origin crosses a
 * cookie boundary: cookies set for `127.0.0.1` are not sent to `localhost`, so
 * the session established a moment earlier vanishes, and the user is told their
 * perfectly valid sign-in link has expired. In production behind a proxy the
 * same mistake sends people to an internal hostname they cannot reach at all.
 *
 * So: trust the explicit configuration, then the forwarding headers the proxy
 * set, and only then fall back.
 *
 * Setting `NEXT_PUBLIC_SITE_URL` in production is the reliable option, and the
 * one the production checklist asks for. The header fallback keeps local
 * development and preview deployments working with no configuration.
 *
 * A forged `Host` or `X-Forwarded-Host` cannot turn this into a redirect to an
 * attacker's site, because Supabase only redirects to URLs on its own
 * allow-list — but that allow-list has to actually be configured.
 */
export function siteOriginFrom(headers: Headers, fallback?: string): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL;
  if (configured) return configured.replace(/\/$/, '');

  const host = headers.get('x-forwarded-host') ?? headers.get('host');
  if (host) {
    const proto =
      headers.get('x-forwarded-proto') ??
      (host.startsWith('localhost') || host.startsWith('127.0.0.1') ? 'http' : 'https');
    return `${proto}://${host}`;
  }

  return (fallback ?? 'http://localhost:3100').replace(/\/$/, '');
}

# Content-Security-Policy plan

**Status: NOT SHIPPED, deliberately.**

A CSP is the one security header that breaks things when it is wrong, and the
two integrations most likely to break it — OAuth and Google Maps — do not exist
yet. Writing the policy now means writing it against guesses; the guesses would
be wrong; and the failure mode is a blank page or a sign-in that never returns.

So this file inventories what each integration will need, and the order to ship
it in. It is a plan, not a policy.

## What is already set — verified on a live response

`X-Content-Type-Options: nosniff` · `Referrer-Policy:
strict-origin-when-cross-origin` · `X-Frame-Options: DENY` ·
`Permissions-Policy: camera=(), microphone=(), geolocation=(self)`

All four in `next.config.ts`. Missing: **CSP** and **HSTS** (the latter in
`production-security-checklist.md` §6).

## Source inventory

What each capability needs, and when it becomes real.

### Supabase — needed now

| Directive | Source | Why |
|---|---|---|
| `connect-src` | `https://<project>.supabase.co` | PostgREST, GoTrue, Storage |
| `connect-src` | `wss://<project>.supabase.co` | Realtime, if it is ever switched on |
| `img-src` | `https://<project>.supabase.co` | Storage-served avatars and media |

The project ref differs per environment, so this has to come from
`NEXT_PUBLIC_SUPABASE_URL` at build time rather than being hard-coded.

### OAuth — Phase 2

Sign-in redirects are **top-level navigations**, which CSP's `connect-src` does
not govern; `form-action` and `frame-src` are the ones that matter, and only if
a provider is embedded rather than redirected to.

| Provider | Directive | Source |
|---|---|---|
| Google | `frame-src` (One Tap only) | `https://accounts.google.com` |
| GitHub | — | redirect only, no directive needed |
| Apple | `frame-src` (JS SDK only) | `https://appleid.apple.com` |

If all three are plain redirects through Supabase — which is the intended design
— **no CSP change is needed for OAuth at all**. That is worth confirming rather
than pre-emptively widening the policy.

### Google Maps — Phase 6

The heaviest requirement, and the reason not to write the policy yet.

| Directive | Sources |
|---|---|
| `script-src` | `https://maps.googleapis.com` |
| `img-src` | `https://maps.gstatic.com`, `https://*.googleapis.com`, `data:`, `blob:` |
| `connect-src` | `https://maps.googleapis.com` |
| `style-src` | `'unsafe-inline'` — the Maps JS API injects inline styles |
| `worker-src` | `blob:` |

`style-src 'unsafe-inline'` is the uncomfortable one. It cannot be avoided with
the Maps JS API today. Options, in order of preference: keep maps on a route
whose CSP is relaxed rather than relaxing it site-wide; or accept it and rely on
`script-src` being strict, since inline *styles* are a far weaker vector than
inline scripts.

MapLibre, which the app uses today, needs `worker-src blob:` and the tile host's
`connect-src`/`img-src`, and no inline styles.

### Fonts

Currently `https://fonts.googleapis.com` (stylesheet) and
`https://fonts.gstatic.com` (files). Self-hosting via `next/font` removes both
directives and a render-blocking third-party request — worth doing regardless of
CSP.

### Next.js itself

The framework inlines hydration data and, in development, uses `eval`.

- Production: `script-src 'self' 'nonce-<per-request>' 'strict-dynamic'`
- Development: additionally `'unsafe-eval'`, which must **never** reach production

## Recommended policy shape

Nonce-based, not allow-list-based. An allow-list of CDNs is bypassable via any
JSONP endpoint on an allowed host; a nonce is not. Next supports this through
middleware, which this app already has.

```
default-src 'self';
script-src 'self' 'nonce-{NONCE}' 'strict-dynamic';
style-src 'self' 'unsafe-inline';
img-src 'self' data: blob: https://<project>.supabase.co;
font-src 'self';
connect-src 'self' https://<project>.supabase.co wss://<project>.supabase.co;
frame-ancestors 'none';
base-uri 'self';
form-action 'self';
object-src 'none';
upgrade-insecure-requests;
```

`frame-ancestors 'none'` supersedes `X-Frame-Options` in modern browsers; keep
both while older ones matter.

## Shipping order

1. **Report-only first.** Ship `Content-Security-Policy-Report-Only` with the
   policy above and a report endpoint. Collect for a week across real browsers.
   Nothing breaks while you learn what it would have broken.
2. **Fix what it reports**, rather than widening the policy to silence it. Each
   widening should be a decision with a reason, not a reflex.
3. **Enforce**, keeping report-only alongside for one release.
4. **Re-open it** when OAuth lands, and again when Maps lands. Both change the
   inventory above; neither should be guessed at now.

## Do not

- Ship `unsafe-eval` in production.
- Use `unsafe-inline` for `script-src`. It defeats the point.
- Add a host to the allow-list to fix a report without understanding what asked
  for it.
- Enforce a CSP the same week as another risky change. When something breaks you
  want one candidate, not two.

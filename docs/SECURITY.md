# Meter402 — Security

Engineering security standards. For the adversary analysis see
`THREAT_MODEL.md`. For vulnerability disclosure see the root `SECURITY.md`.

---

## 1. Principles

1. **Security outranks everything else.** When forced to choose, the order is
   security, correct payment accounting, reliability, developer experience,
   product simplicity, observability, performance, feature count.
2. **Never take custody.** Funds move agent → merchant. We hold no keys that
   can move merchant money, so there is no hot wallet to drain.
3. **Enforce structurally, not by convention.** A rule a developer must
   remember is not a control. TEST/LIVE separation, replay protection, and the
   ban on float money are all enforced by types, constraints, or lint.
4. **Fail closed.** Unknown environment, unparseable config, unrecognised
   status: refuse rather than guess.
5. **Trust nothing from a client.** Including — especially — payment proofs.

## 2. Authentication

### API keys

- Format `meter_test_<random>` / `meter_live_<random>`, 256 bits from
  `crypto.randomBytes`. Never `Math.random`.
- Stored as HMAC-SHA256 with a server-side pepper. Plaintext is shown once and
  never persisted. See `DATABASE.md §2` for why a fast keyed hash is correct
  here and a slow KDF is not.
- Verified with a **timing-safe** comparison. A byte-by-byte early-exit compare
  leaks the prefix of a valid key across enough requests.
- Support create, rotate, revoke, list. Revocation takes effect immediately —
  key state is authoritative on every request, never cached past its TTL.
- Scopes are least-privilege: `payments:read`, `payments:write`,
  `endpoints:read`, `endpoints:write`, `webhooks:read`, `webhooks:write`,
  `analytics:read`.

### Dashboard sessions

A production-grade authentication library, not a hand-rolled implementation
(brief §12). Requirements: secure/HttpOnly/SameSite cookies, session rotation
on privilege change, immediate revocation, MFA-ready, suspicious sign-in
detection where feasible.

## 3. Authorization

**Every authorization decision happens server-side.** Frontend role checks
control what is rendered, never what is permitted. Permissions are defined in
one central table, not scattered through route handlers.

**Tenant isolation is the highest-severity access control in the system.**
Fetching a payment by ID without validating organization ownership is an IDOR
that exposes another merchant's revenue. Rules:

- Every tenant-owned query is scoped to `organization_id`.
- Repositories take the organization as a required argument; there is no
  `findById(id)` on a tenant-owned entity.
- A cross-tenant fetch returns `RESOURCE_NOT_FOUND`, not `PERMISSION_DENIED` —
  the latter confirms the resource exists.
- Cross-tenant access is tested explicitly, not assumed.

## 4. Input validation

All external input is validated with Zod schemas at the boundary. Anything
unvalidated is `unknown` until it is parsed.

- **SQL injection:** parameterised queries only, via Drizzle. No string
  concatenation into SQL, ever.
- **XSS:** React escapes by default; `dangerouslySetInnerHTML` is prohibited
  without written review. CSP is set.
- **Prototype pollution:** JSON from untrusted sources is parsed with a reviver
  that drops `__proto__`, `constructor`, and `prototype` keys. Implemented in
  the x402 proof parser and tested.
- **SSRF:** webhook URLs are the primary vector — a merchant can point one at
  `169.254.169.254` and read cloud instance metadata. Required controls:
  reject non-HTTPS, resolve DNS and reject private/loopback/link-local ranges,
  re-validate after redirects, disallow redirects to new hosts, and set a
  short timeout. **Status: not yet implemented** — required before webhooks
  ship in Phase 6.
- **Resource exhaustion:** every parser that handles untrusted input is
  bounded before it allocates. The x402 payment header is capped at 8 KiB and
  checked before decoding.

## 5. Cryptography

Never invent cryptography. Use vetted libraries and standard constructions.

- Randomness: `crypto.randomBytes` / `crypto.webcrypto`. Never `Math.random`.
- Comparisons of secrets: `crypto.timingSafeEqual`.
- Webhook signatures: HMAC-SHA256 over `timestamp.payload`, sent as
  `Meter402-Signature` with `Meter402-Timestamp`. Verifiers must reject
  timestamps outside a tolerance window, or the signature is replayable
  forever.
- No custom smart contracts in MVP. If one ever holds funds it requires an
  independent professional audit before it processes meaningful value.

## 6. Secrets

Never committed: private keys, database passwords, RPC secrets, webhook
secrets, JWT/auth secrets, API keys.

- Local: `.env`, git-ignored. `.env.example` is the only committed env file and
  contains no real values.
- Production: AWS Secrets Manager, injected at task start. Not in image
  layers, not in task definitions, not in CI logs.
- Rotation procedures per secret type are documented in `KEY_MANAGEMENT.md`
  (planned).
- The API refuses to boot outside `local` if a secret is missing or still set
  to its placeholder. Fail closed, loudly, at startup rather than subtly at
  runtime.

## 7. Logging and privacy

**Never logged:** API keys or any part of a secret, authorization headers,
session tokens, webhook signing secrets, full payment proofs, merchant request
or response bodies.

Meter402 sits in the authorization path, not the data path, so merchant
content does not transit our systems in the first place. That is a privacy
property enforced by architecture rather than by log configuration.

Collect the minimum: payment metadata, not payloads. Logging verbosity is
configurable, and no verbosity level unlocks secret logging.

Every log line carries `requestId` and `traceId`; every error response returns
the same `requestId`, so a support conversation starts from one identifier
without the customer pasting a payload.

## 8. Rate limiting and abuse

Rate limits on: login, registration, password reset, API key operations,
payment request creation, payment verification, webhook creation, analytics,
and all public endpoints. Keyed by IP, API key, organization, project, and
endpoint as appropriate.

Unauthenticated endpoints are limited more aggressively than authenticated
ones — an attacker who has not paid to authenticate should not be able to
consume the same resources as a customer.

Verification is the sensitive path: it is unauthenticated by nature (an agent
presents a proof, not a key) and triggers upstream RPC calls. Proof parsing is
therefore bounded and validated before any network call.

## 9. Transport and headers

HTTPS only. HSTS with a long max-age. Content-Security-Policy,
X-Content-Type-Options `nosniff`, a restrictive Referrer-Policy, and
`Permissions-Policy`. Cookies `Secure`, `HttpOnly`, `SameSite`.

CORS on the API allows the dashboard origin explicitly; it is never `*` for
credentialed requests.

## 10. Dependencies

- `pnpm` blocks dependency lifecycle scripts by default. Each exception is
  listed explicitly in `pnpm-workspace.yaml` and reviewed — a postinstall
  script is arbitrary code execution at install time and the main practical
  supply-chain vector.
- Lockfile committed; CI installs with `--frozen-lockfile`.
- `pnpm audit` runs in CI.
- Dependencies are pinned through a workspace catalog so a version bump is one
  reviewed change rather than drift across packages.

## 11. Testing security properties

Security tests are a required category, not an aspiration. Currently covered:

- payment replay (same tx against a second request)
- wrong recipient, wrong amount, wrong network, wrong asset
- expired payment requests
- reverted transactions
- spoofed ERC-20 logs with non-zero address padding
- malformed and oversized payment proofs
- prototype pollution via crafted JSON
- duplicated headers (request smuggling ambiguity)
- forbidden state transitions

Required before the corresponding features ship: cross-tenant object access,
revoked/expired API keys, brute-force authentication, webhook replay, SSRF
against webhook URLs.

## 12. Pre-production requirements

Before processing meaningful production volume:

1. External security review.
2. Penetration test of the dashboard and API.
3. Tenant isolation audit.
4. Incident response runbooks exercised, not just written.
5. Backup restore tested end to end.
6. Legal review of the regulatory posture in target jurisdictions.

None of these are complete. Meter402 must not process meaningful third-party
value until items 1, 3, and 6 are.

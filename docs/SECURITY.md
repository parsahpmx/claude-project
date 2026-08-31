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

### Dashboard sessions **[development adapter — not production auth]**

Phase 1 does **not** integrate a production identity provider, and Meter402
must not describe itself as having one. What exists is `SessionIssuer`, a
provider-neutral interface, with a single `DevelopmentSessionIssuer`
implementation minting HMAC-SHA256 bearer tokens from `AUTH_SECRET`. It exists
so authorization and tenant isolation can be tested end to end over real HTTP.

Missing, and required before any real user account exists: passwords or
federated login, MFA, account recovery, device management, and a session
revocation list.

Two guards keep the token-minting route out of production, both tested:
1. `POST /v1/dev/sessions` is only registered when `DEPLOY_ENV` is `local` or
   `development`; in staging and production the route does not exist.
2. A runtime check refuses even if that call site changes in a refactor.

Requirements for the eventual provider integration are unchanged:
secure/HttpOnly/SameSite cookies, session rotation on privilege change,
immediate revocation, MFA-ready, suspicious sign-in detection where feasible.

## 3. Authorization

**Every authorization decision happens server-side.** Frontend role checks
control what is rendered, never what is permitted. Permissions are defined in
one central table, not scattered through route handlers.

**Tenant isolation is the highest-severity access control in the system.**
Fetching a payment by ID without validating organization ownership is an IDOR
that exposes another merchant's revenue. Rules, all **[built]** as of Phase 1:

- Every tenant-owned query is scoped to `organization_id`.
- Repositories take a `TenantScope` as a required argument; there is no
  `findById(id)` on a tenant-owned entity. `TenantScope` is a *branded* type
  that cannot be written as an object literal — it is obtainable only from an
  authenticated principal whose membership was loaded from the database. A
  handler cannot forget the check, because there is nothing to forget.
- A cross-tenant fetch returns 404, not `PERMISSION_DENIED` — the latter
  confirms the resource exists. 403 is reserved for a caller who demonstrably
  has tenant access and merely lacks the permission.
- Cross-tenant access is tested explicitly, not assumed: 33 integration tests
  drive a genuinely authenticated user from Organization B at every
  Organization A resource and route.

The single sanctioned exception is `findProjectOrganizationId`, which returns
an opaque organization ID and no project data so that routes can be addressed
as `/v1/projects/:id`. Its narrowness is the security property; widening its
return value requires review.

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

Added in Phase 1:

- cross-tenant object access across every organization, project, membership,
  and API-key route, including with lower-privilege roles and with API keys
- the full role x permission matrix, denials as well as grants
- revoked and expired API keys, including a key past `expires_at` that is still
  marked ACTIVE
- rotation atomicity, and the plaintext secret's absence from the database, the
  list endpoint, and every audit event
- privilege escalation: self-promotion, unknown roles, escalating key scopes
- concurrency: last-owner races, duplicate membership, duplicate slug,
  contended key rotation and revocation

Added in Phase 2:

- cross-tenant access to endpoints, payment requests, payments, and receipts,
  by user session and by API key, including the assertion that an unknown ID
  and another tenant's ID return byte-identical answers
- payment binding: a settled payment presented at a different endpoint, and a
  valid request ID presented with the wrong reference
- double-spend: replaying a spent proof, and twenty simultaneous retries of one
  valid proof, asserted against the usage-event count in the database
- exactly-once creation: twenty simultaneous completions of one payment
  request, asserted against payment and receipt row counts
- scope enforcement on the machine surface — `payments:write` for paying and
  for the simulator, `payments:read` for reading receipts — and the refusal of
  machine credentials on endpoint configuration entirely
- TEST/LIVE confinement: a LIVE key on a TEST endpoint, a LIVE key at the
  simulator, a LIVE endpoint on a project without LIVE mode enabled
- price snapshot immutability: repricing an endpoint mid-flight does not change
  what an issued request owes, and the settled payment and receipt carry the
  quoted amount
- price validation: over-precision for the asset's decimals, and zero prices
- endpoint path handling: traversal rejected rather than resolved, embedded
  control characters, query strings and fragments, non-ASCII, over-length

### Still open, and blocking the features they belong to

These gates remain **unresolved**. Phase 2 did not close either of them, and
nothing in this release should be read as having done so:

1. **SSRF controls must exist before merchant-controlled outbound webhook
   delivery.** No DNS-rebinding-resistant resolution, private-range blocking,
   or redirect confinement is implemented. This is why Phase 2's paid surface
   does not forward authorized requests to merchant infrastructure and serves
   them from a built-in handler instead.
2. **x402 compatibility must not be advertised until independent wire
   conformance testing is complete.** It has not been done. The Phase 2
   challenge body is deliberately protocol-neutral and does not use x402's
   `accepts` shape, precisely so that no public contract depends on an
   unverified reading of that specification.

Also required before the corresponding features ship: brute-force
authentication rate limiting, and webhook replay protection.

## 12. The TEST payment simulator

The simulator settles TEST payments without a wallet or a chain. Four
independent guards confine it, each covered by a test:

1. **The stored environment decides.** `assertSimulatableRequest` refuses any
   `PaymentRequest` whose environment is not `TEST`, and it lives beside the
   adapter in `@meter402/payments` so there is exactly one implementation of
   the rule rather than a copy per handler that can drift.
2. **A TEST request cannot carry a mainnet chain.**
   `assertChainAllowedForEnvironment` runs at endpoint configuration, so the
   LIVE case cannot be constructed through this path in the first place.
3. **There is no flag to pass.** The route accepts a payment request ID and
   nothing else — no environment, no amount, no `simulate` parameter, no
   override. A caller cannot relax a check that takes no input.
4. **The evidence must be one the simulator issued.**
   `SimulatedSettlementVerifier` refuses any reference other than the keyed
   HMAC derivation for that specific request, compared in constant time. An
   agent that knows the request ID and nonce — both public, both in the 402 —
   still cannot mint one.

`TEST_SIMULATOR_SECRET` keys that derivation. It is a **separate secret**,
required at boot and required to differ from `AUTH_SECRET`,
`API_KEY_HASH_PEPPER`, and `WEBHOOK_SIGNING_SECRET`: a simulated settlement
reference is a bearer credential for a TEST payment, and deriving it from the
session secret would make one leak forge both sessions and payments.

The reference itself is recorded in audit metadata deliberately — once a
payment is complete it is the identifier a merchant reconciles against, the
TEST analogue of a transaction hash. The derivation *key* is never logged.

## 13. Pre-production requirements

Before processing meaningful production volume:

1. External security review.
2. Penetration test of the dashboard and API.
3. Tenant isolation audit.
4. Incident response runbooks exercised, not just written.
5. Backup restore tested end to end.
6. Legal review of the regulatory posture in target jurisdictions.

None of these are complete. Meter402 must not process meaningful third-party
value until items 1, 3, and 6 are.

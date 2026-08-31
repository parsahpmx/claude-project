# Phase 1 — Implementation Note

Written before code, after inspecting the Phase 0 repository. It records how
Phase 1 fits the existing architecture and, more importantly, what it
deliberately does **not** rebuild.

---

## 1. What Phase 0 already provides

| Capability | Where | Reused as-is |
| --- | --- | --- |
| Prefixed ULID identity | `@meter402/shared` `ids.ts` | Yes — `ID_PREFIXES` already has `user`, `organization`, `membership`, `project`, `apiKey`, `auditEvent` |
| Error envelope + taxonomy | `@meter402/shared` `errors.ts` | Yes — extended with Phase 1 codes, not replaced |
| `MerchantEnvironment` (TEST/LIVE) and key prefixes | `@meter402/shared` `environment.ts` | Yes — `API_KEY_PREFIX` already maps environment → `meter_test`/`meter_live` |
| Key generation, peppered HMAC, timing-safe verify | `apps/api/src/lib/api-key.ts` | Yes — this is already correct; Phase 1 adds persistence around it |
| `users` / `organizations` / `organization_members` / `projects` / `api_keys` tables | `@meter402/database` | Extended with status columns, not recreated |
| `audit_events` table (append-only) | `@meter402/database` `operations.ts` | Yes |
| Fastify app, error handler, request IDs, security headers | `apps/api/src/app.ts` | Yes — routes register into it |
| Validated config incl. `API_KEY_HASH_PEPPER`, `AUTH_SECRET` | `@meter402/config` | Yes |

**Nothing in the payment domain is touched.** No changes to `@meter402/payments`,
`@meter402/blockchain`, `@meter402/x402`, or `@meter402/pricing`.

## 2. New package: `@meter402/auth`

RBAC is pure logic — a role in, a permission set out. Putting it in a package
rather than in the API app keeps it I/O-free and therefore exhaustively
testable, which matches how the payment state machine is structured. It also
means the future dashboard and admin console evaluate the *same* map rather
than a second copy that drifts.

Contents: permission constants, the single `ROLE_PERMISSIONS` map, the
principal union, the authorization context, API-key scopes, and the
owner-invariant rules.

`packages/auth` was listed as **planned** in Phase 0's ARCHITECTURE.md; this
fills it, scoped to authorization rather than session management.

## 3. Two principal types, never one ambiguous object

```
Principal = UserPrincipal | ApiKeyPrincipal
```

A human acting through the dashboard and an agent acting through an API key
are different actors with different authority. Collapsing them into one
"current user" object is how a machine credential silently acquires a human's
organization-management rights.

- `UserPrincipal` carries `userId` and, once an organization is resolved, a
  `membership` (role + status). Authorization asks **RBAC** questions.
- `ApiKeyPrincipal` carries `apiKeyId`, `organizationId`, `projectId`,
  `environment`, and `scopes`. Authorization asks **scope** questions.

An API key can never satisfy an RBAC permission check, and a user session can
never satisfy a scope check. That is enforced by the type discriminant, not by
convention.

## 4. Tenant scoping: structural, not remembered

The failure mode Phase 1 exists to prevent is a route handler forgetting an
ownership check. Convention does not survive contact with a growing codebase,
so the boundary is enforced by types:

- Tenant-owned repositories expose **no** `findById(id)`. The narrowest lookup
  is `findInOrganization(scope, id)`.
- `scope` is a branded `TenantScope`, obtainable only from an authenticated
  principal whose membership was loaded from the database.
- The organization ID is therefore never read from a request body or an
  unvalidated path parameter into a query.

A handler that wants to bypass this has to construct a `TenantScope` by hand,
which is visible in review in a way that a missing `WHERE` clause is not.

## 5. Existence disclosure policy: 404, not 403

For a resource in another organization the API returns
`RESOURCE_NOT_FOUND` (404), never `PERMISSION_DENIED` (403).

403 confirms the resource exists. Given ULIDs that is not a practical
enumeration risk, but it still leaks that a specific ID is a real
organization/project — enough to confirm a competitor's account from a
leaked identifier. 403 is reserved for the case where the caller
*demonstrably has access to the tenant* and merely lacks the permission,
which discloses nothing they did not already know.

This matches the policy already written in `docs/SECURITY.md §3`.

## 6. API key lookup — a Phase 0 defect to correct

Phase 0's `docs/DATABASE.md` says lookup is "by `prefix`, then a timing-safe
comparison of the HMAC". That is not workable: `prefix` is `meter_test` or
`meter_live`, shared by *every* key, so it selects the whole table.

The hash is a deterministic HMAC (no per-row salt), so the correct lookup is a
direct equality probe on the existing `UNIQUE (key_hash)` index — O(1), and
the constant-time comparison is retained afterwards as defence in depth. This
is a documentation and implementation correction, not a change to the hashing
strategy, which remains right for the reasons Phase 0 recorded.

## 7. Human authentication is a development adapter, and says so

Phase 1 does not integrate a production identity provider. Instead the
identity domain stays provider-neutral: a `SessionIssuer` interface with one
implementation, `DevelopmentSessionIssuer`, which mints HMAC-signed bearer
tokens using `AUTH_SECRET`.

Safety properties, each tested:
- The dev session route is **only registered** when `DEPLOY_ENV` is `local` or
  `development`. In `staging` and `production` the route does not exist.
- Token verification is constant-time and rejects expired or tampered tokens.

This is honest about maturity: API-key authentication is real and complete;
human authentication is a test seam awaiting a provider (Phase 4+). It is
documented as **PLANNED** in the architecture docs rather than described as a
finished auth system.

## 8. Order of work

Schema → auth package → repositories → principals → routes → tests, with
verification against real PostgreSQL at the end. Owner invariants and
membership uniqueness get real-database concurrency tests, because
check-then-write races are exactly the class of bug unit tests cannot see —
the same reasoning that put replay protection behind a database constraint in
Phase 0.

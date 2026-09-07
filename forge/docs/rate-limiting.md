# Rate limiting — what is covered, what is not

Written to avoid two opposite mistakes: assuming Supabase covers everything, and
rebuilding protection that already exists.

**Nothing in this document has been load-tested from this environment.** The
Supabase-side limits are its documented behaviour, not something I have
exercised; treat them as "expected" until measured against the real project.

## Covered by Supabase — no application code needed

Supabase applies its own limits to the GoTrue endpoints the app calls. These
protect the operations that matter most, and they apply regardless of what the
application does, because they sit in front of it.

| Endpoint | App surface | Notes |
|---|---|---|
| `/auth/v1/token` | sign-in | Repeated failures are throttled |
| `/auth/v1/signup` | sign-up | |
| `/auth/v1/recover` | forgot password | Also limits how often one address can be mailed |
| `/auth/v1/user` | session refresh, password update | |

The app already surfaces this correctly: `readableAuthError` maps a rate-limit
message to *"Too many attempts. Wait a minute and try again."*, and the
forgot-password action deliberately breaks its own generic-response rule for
that one case — because repeating the request is exactly the wrong response to
being throttled, and the person needs to know to wait.

**Configure the actual numbers** in Dashboard → Authentication → Rate Limits.
The defaults are generous for a beta and should be reviewed before launch.

## Not covered — application responsibility

**Server Actions have no rate limiting at all.** They are ordinary POSTs to the
Next server; Supabase never sees them. Today that means:

| Action | Risk today | Severity |
|---|---|---|
| `createActivity` | A script could fill a person's own account with junk | Low — RLS confines it to the attacker's own rows |
| `updatePrivacySettings` | Same | Low |
| `completeOnboarding` | Same | Low |

Low, because RLS means the blast radius of any authenticated abuse is the
attacker's own data. It becomes serious the moment an action writes something
another person sees, or costs money.

**Becomes necessary in later phases:**

- **AI endpoints (Phase 11)** — each call has a direct monetary cost. This is
  the one that needs a hard per-user quota, not just a rate limit.
- **QR credential issuance (Phase 10)** — rotating credentials are cheap to mint
  and a flood is a denial-of-service on the door.
- **Access verification (Phase 10)** — must stay fast under a queue at 6pm.
- **Messaging and comments (Phase 7/8)** — spam surface, and the first place
  abuse reaches another person.
- **File upload (Phase 4+)** — storage cost and malware surface.

## Recommendation

Do not build a rate limiter now. Supabase covers the endpoints that matter
today, and an unused limiter is a thing to maintain and misconfigure. Build it
when the first uncovered surface lands — AI or QR, whichever comes first — and
build it once, as shared middleware rather than per-endpoint.

When that happens, the shape to prefer:

- Keyed on **user id first, IP second**. IP alone punishes shared networks —
  a gym's wifi is one IP for everyone in the building.
- **Fail closed for money, fail open for reads.** A rate limiter that goes down
  should not lock people out of their own training history; it absolutely should
  stop AI spend.
- Return `429` with `Retry-After`, and surface it the way the auth path already
  does: say to wait, not "something went wrong".

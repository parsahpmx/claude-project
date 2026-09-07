# Production security checklist

Everything here is **configuration a person has to do**, not code. Each item
says what to click and how to tell it worked. Nothing is marked done on the
strength of having written it down.

**Status key:** ✅ verified · ⚠️ implemented, not verified · ❌ not done ·
**NOT VERIFIED** = nobody has exercised it.

---

## 1. Leaked password protection — ❌ NOT DONE

Supabase can reject passwords that appear in the HaveIBeenPwned corpus. It is
off, which the database advisor reports on every scan.

**Do this:** Supabase Dashboard → your project → **Authentication** →
**Policies** (or **Providers → Email**, depending on dashboard version) → enable
**Leaked password protection**.

**Verify:** try to register with `Password123!` — a password known to be in the
corpus. Signup should be refused. Then re-run the advisor; the
`auth_leaked_password_protection` warning should be gone.

*I cannot do this: it is an Auth setting, not SQL, and the MCP connection I have
reaches the database rather than the Auth configuration API.*

---

## 2. Redirect allow-list — ⚠️ REQUIRED BEFORE PASSWORD RESET WORKS

Password recovery emails a link built from `NEXT_PUBLIC_SITE_URL` (or the
request host when that is unset). Supabase will only redirect to URLs on its
allow-list, and a link not on it silently fails.

**Do this:** Dashboard → **Authentication** → **URL Configuration**.
- **Site URL:** your production origin, e.g. `https://forge.example.com`
- **Redirect URLs:** add `https://forge.example.com/auth/callback` and, for
  local work, `http://localhost:3100/auth/callback`

**Verify:** request a reset from the production site, open the emailed link, and
confirm it lands on `/reset-password` with a working form rather than
`/login?error=exchange_failed`.

**Also set `NEXT_PUBLIC_SITE_URL`** in the deployment environment. Without it
the origin is derived from the request host, which behind a proxy can be an
internal hostname — producing reset links nobody can open.

---

## 3. Email delivery — ❌ NOT CONFIGURED, NOT VERIFIED

Supabase's built-in SMTP is rate-limited and intended for development. Password
recovery is useless if the mail does not arrive.

**Do this:** Dashboard → **Project Settings** → **Authentication** → **SMTP
Settings** → configure a real provider (Resend, Postmark, SES…). Then
**Authentication → Email Templates** → review the recovery template.

**Verify:** request a reset for a real mailbox; confirm delivery, that the link
works once, and that a second use of the same link is refused.

> **Password recovery is IMPLEMENTED and LOCALLY TESTED but delivery is NOT
> VERIFIED.** The flow, validation, generic response and expired-session
> handling are covered by browser tests against a local stand-in. No email has
> ever been sent. Do not report recovery as working until this item is done.

---

## 4. OAuth providers — ❌ NOT IMPLEMENTED, NOT VERIFIED

No `signInWithOAuth` call exists yet. When it is added, each provider needs:

| Provider | Console | Callback to register |
|---|---|---|
| Google | Google Cloud → APIs & Services → Credentials → OAuth client (Web) | `https://<project>.supabase.co/auth/v1/callback` |
| GitHub | GitHub → Settings → Developer settings → OAuth Apps | same |
| Apple | Apple Developer → Services ID + Sign in with Apple key | same |

Then Dashboard → **Authentication → Providers** → enable and paste the client
id/secret.

**Notes that cost time if missed:** Apple returns the person's name **only on
first authorization** — persist it then or lose it. Apple's private relay
addresses are real addresses; do not treat them as invalid. Request only the
scopes sign-in needs: signing in with Google is not a reason to ask for Gmail.

---

## 5. Map tiles — ❌ DEV-GRADE, NOT VERIFIED

`NEXT_PUBLIC_MAP_STYLE_URL` defaults to a demo endpoint that is rate-limited and
not for production traffic.

**Do this:** create **separate** keys per surface — web, iOS, Android, server —
and restrict each one: web by HTTP referrer, mobile by bundle/package id, server
by IP. Restrict every key to only the APIs it needs. Set a billing alert.

Never ship an unrestricted key: a public unrestricted key is someone else's free
quota until the bill arrives.

**Verify:** load `/maps` and confirm tile requests return 200 in the network
panel. Today they fail and the page degrades to "Map unavailable", which is
tested and correct — but it is a fallback, not a map.

---

## 6. HSTS — ⚠️ CHECK THE PLATFORM FIRST

`Strict-Transport-Security` is not set by the application, deliberately.

Most hosts (Vercel, Netlify, Cloudflare) inject HSTS on custom domains already,
and a second one from the app is at best redundant and at worst conflicting.
Setting it locally would also be wrong — the header on `http://localhost` can
pin a browser to HTTPS for a hostname that does not serve it, which is
irritating to undo.

**Do this:** deploy, then check the response headers of the production origin.
- Present → nothing to do; record which layer sets it.
- Absent → add it in `next.config.ts` **guarded to production**, starting with
  a short `max-age` and lengthening it once you are sure, since HSTS is
  effectively irreversible for its lifetime.

**Verify:** `curl -sI https://<origin> | grep -i strict-transport-security`.

---

## 7. Content-Security-Policy — ❌ NOT SET, DELIBERATELY DEFERRED

See `docs/csp-plan.md`. A CSP written before OAuth and maps exist would be
written against guesses and would break both. The plan lists the sources each
integration needs and recommends shipping `Content-Security-Policy-Report-Only`
first.

**Already set and verified on a live response:** `X-Content-Type-Options`,
`Referrer-Policy`, `X-Frame-Options`, `Permissions-Policy`.

---

## 8. Fixture accounts — ❌ STILL PRESENT

Two `@forge.test` accounts share the production database with a real account.

**Do this:** run `scripts/purge-test-accounts.sql`. It reports first and deletes
nothing until you uncomment the final block. Read the listing before you do.

**Verify:** `select count(*) from auth.users where email like '%@forge.test'`
returns 0.

---

## 9. Rate limiting — ⚠️ PARTLY COVERED, APPLICATION SIDE ABSENT

See `docs/rate-limiting.md` for what Supabase covers and what it does not.
Short version: Supabase rate-limits its own auth endpoints, so sign-in, sign-up
and recovery have a floor. Server Actions have none, and the AI and QR
endpoints of later phases will need their own.

---

## 10. Service-role key — ✅ VERIFIED ABSENT FROM THE APP

Confirmed by grep across the repository at every commit this phase: the only
matches are SQL `grant` statements in migrations. `src/lib/supabase/config.ts`
reads `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` and
nothing else. A key with no code path cannot be leaked by one.

Keep it that way: if a query seems to need the service role, the fix is a
policy, not a key.

---

## 11. Row level security — ✅ VERIFIED

- 31 tables in `public`, **0 without RLS** — checked by query, not by reading
  migrations.
- `private.rls_selftest()` — **21/21**.
- `private.authz_selftest()` — **25/25**, including self-escalation to
  `platform_admin` and `super_admin` both refused.

Re-run both after every migration. A new table without a policy is invisible
until someone queries it in production.

---

## 12. Advisor warning that needs no action — ✅ EXPLAINED

`public.rls_auto_enable()` is reported as a `SECURITY DEFINER` function
executable by `anon` and `authenticated`. It is a **Supabase platform object**,
owned by `postgres`, returning `event_trigger`, attached to one event trigger.
Postgres refuses to invoke it: *"trigger functions can only be called as
triggers."*

Recorded so nobody tries to "fix" a platform object, and so nobody dismisses the
advisor wholesale without knowing which finding is which.

---

## Before external users

- [ ] Leaked password protection on (§1)
- [ ] Redirect allow-list and `NEXT_PUBLIC_SITE_URL` set (§2)
- [ ] Real SMTP, recovery round-trip verified end to end (§3)
- [ ] Fixture accounts removed (§8)
- [ ] Map provider key, restricted per surface (§5)
- [ ] HSTS confirmed at some layer (§6)
- [ ] CSP at least in report-only (§7)
- [ ] `rls_selftest` and `authz_selftest` green on the production database

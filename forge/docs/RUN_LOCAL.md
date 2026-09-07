# Running FORGE Web Beta on localhost

Everything below has been run from a clean checkout. Where something has **not**
been verified, it says so rather than implying it works.

---

## 1. Requirements

| Tool | Version | Check |
| --- | --- | --- |
| Node | >= 22 | `node -v` |
| pnpm | >= 10 | `pnpm -v` (install with `corepack enable pnpm`) |

## 2. Install and start

From the repository root:

```bash
cd forge
pnpm install
cp apps/beta/.env.example apps/beta/.env.local   # only if .env.local is missing
pnpm dev:beta
```

Then open **http://localhost:3100**.

`pnpm dev:beta` is not just `next dev` — it runs `build:packages` first.
`@forge/core` and `@forge/db` are consumed from their compiled `dist/`, so
starting Next directly fails with `Cannot find module '@forge/core'`. Use the
root script and that never comes up.

## 3. Signing in

The account you sign in with must satisfy two conditions, and both are
properties of the Supabase project, not of this code:

1. **It has a password.** Accounts created by an OAuth provider do not.
2. **Its email is confirmed.** The project has "Confirm email" switched on, so
   an account created through `/signup` cannot sign in until the emailed link
   is clicked.

If sign-in answers *"Check your inbox and confirm your email address first"*,
condition 2 is the one that is failing.

### Why sign-up used to look broken

With "Confirm email" on, `supabase.auth.signUp()` creates the account and
returns **no session**. The sign-up action used to redirect to `/onboarding`
regardless — a route that requires a session — so middleware immediately bounced
the brand-new account to `/login` with nothing on screen explaining why, and the
password just chosen was then rejected with "confirm your email first". The
account existed. The person had no way to tell.

Sign-up now checks whether a session came back and, when it did not, says so and
stops. Covered by `src/app/(auth)/sign-up.test.ts` and by the `sign up` group in
`e2e/auth-ui.spec.ts`.

## 4. Email links, and the one dashboard setting they need

Confirmation and password-reset links are sent by Supabase and come back to
`<origin>/auth/callback`. Supabase only redirects to origins on its own
allow-list, so for a local run:

> Supabase dashboard → Authentication → URL Configuration → **Redirect URLs** →
> add `http://localhost:3100/**`

Without it the links resolve to the project's Site URL instead, and a local
sign-up or reset dead-ends. **This is a dashboard setting; it cannot be set from
code in this repository.**

Two further caveats about email:

- Supabase's built-in SMTP is rate-limited (a couple of messages per hour) and is
  not intended for real use. Configure a real SMTP provider before beta.
- **Email delivery has never been verified from this repository.** The tests
  assert that the app *asks* the auth service to send a link, which is a
  different claim from one arriving.

## 5. Environment variables

`apps/beta/.env.local` is gitignored, so a fresh clone has none. Copy the
example and fill it in.

| Variable | Required | Notes |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | yes | Project Settings → API |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | yes | Publishable key. Public by design — it ships in the browser bundle and RLS is what protects the data |
| `NEXT_PUBLIC_SITE_URL` | no | Set in production. Locally the host header is used |
| `NEXT_PUBLIC_MAP_STYLE_URL` | no | Defaults to the MapLibre demo tiles, which are rate-limited and development-only |
| `FORGE_DISABLED_FEATURES` | no | Comma-separated optional features to switch off |

The service-role key is **deliberately absent**. Nothing in this app reads it,
and a key with no code path cannot be leaked by one. Do not add it here.

Missing configuration is tolerated in development: the marketing pages still
render and `/login` explains what to do, rather than every route answering 500.
In production it fails loudly instead, because a deployment with no Supabase
project is a broken deployment. Either way no session can be verified, so every
visitor is anonymous and every guarded route still redirects — it admits nobody.

## 6. What you should see

| Route | Signed out | Signed in |
| --- | --- | --- |
| `/`, `/features`, `/how-it-works`, `/pricing`, `/about` | 200 | 200 |
| `/login`, `/signup`, `/forgot-password`, `/reset-password` | 200 | redirects to `/home` |
| `/home`, `/activities`, `/progress`, `/maps` | 307 to `/login?next=…` | 200 |

Guarded routes redirect rather than render, including when Supabase is
unreachable. That is deliberate: the guard fails closed.

## 7. Tests

```bash
cd forge/apps/beta
pnpm test          # Vitest — units. No server, no browser
pnpm test:e2e      # Playwright — needs browsers; see below
```

The Playwright suite starts its own Next server on port 3101 against a stand-in
auth/PostgREST server, so it never touches a real Supabase project and never
needs credentials.

If the environment ships its own Chromium and forbids downloading another, point
Playwright at it instead of running `playwright install`:

```bash
PLAYWRIGHT_CHROMIUM_PATH=/path/to/chrome pnpm test:e2e
```

## 8. Troubleshooting

| Symptom | Cause |
| --- | --- |
| `Cannot find module '@forge/core'` | Started Next directly. Use `pnpm dev:beta` from `forge/` |
| Every route 500s with `NEXT_PUBLIC_SUPABASE_URL is not set` | Running with `NODE_ENV=production` and no `.env.local` |
| Sign-in says "confirm your email address first" | The account is unconfirmed — see §3 |
| Sign-up says "check your inbox" and nothing arrives | Built-in SMTP rate limit, or the redirect URL of §4 is not allow-listed |
| A reset link reports itself expired immediately | The link's origin does not match the one you are browsing on — `127.0.0.1` and `localhost` are different cookie origins |
| Port 3100 in use | `next dev -p <other>` , and add that origin to §4 |

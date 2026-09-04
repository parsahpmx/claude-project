# API

Fastify 5 on `:4000`, mounted at `/v1`. The web app reaches it through a
same-origin `/api/*` rewrite so the session cookie stays first-party.

## Conventions

**Errors.** One shape everywhere. Clients branch on `code`, never on prose, so
copy can be rewritten without breaking them.

```json
{ "error": { "code": "already_completed",
             "message": "This session has already been logged.",
             "details": [{ "field": "email", "message": "Invalid email" }] } }
```

`400 invalid_request` · `401 unauthorized` · `403 forbidden` ·
`404 not_found` · `409 <specific>` · `429 rate_limited` · `500 internal_error`.
Internal messages and stacks are never returned.

**Auth.** A `forge_session` cookie: httpOnly, SameSite=Lax, Secure in
production. The database stores only the SHA-256 of the token.

**Rate limiting.** 600 requests a minute, keyed on the member id when signed in
and the IP when not — so a shared office NAT cannot lock everyone out.

**Validation.** Every request body and query is parsed with a Zod schema built
from the domain's own unions, so adding a goal to `@forge/core` cannot leave the
API rejecting it.

## Endpoints

### Public

```
GET  /health

POST /v1/auth/register            create account (+ optional assessment)
POST /v1/auth/login
POST /v1/auth/logout
GET  /v1/auth/me

POST /v1/assessment               answers -> performance profile
POST /v1/checkout/preview         plan + interval -> billing disclosure
POST /v1/coach-applications       apply to coach on FORGE

GET  /v1/catalog/assessment-steps
GET  /v1/catalog/plans
GET  /v1/catalog/programs         ?goal ?difficulty ?style ?location
                                  ?maxSessionMinutes ?equipment ?search
GET  /v1/catalog/programs/:slug
GET  /v1/catalog/exercises        ?equipment ?pattern
GET  /v1/catalog/coaches          ?goal ?specialty ?language ?maxMonthlyPriceCents
                                  ?minRating ?availableOnly
GET  /v1/catalog/coaches/:slug
GET  /v1/catalog/recipes          ?diet ?slot ?search
GET  /v1/catalog/recipes/:slug
GET  /v1/catalog/recovery
GET  /v1/catalog/articles         ?category
GET  /v1/catalog/articles/:slug
GET  /v1/catalog/stories
GET  /v1/catalog/stories/:slug
GET  /v1/catalog/products         ?category ?goal
GET  /v1/catalog/products/:slug
GET  /v1/catalog/challenges
GET  /v1/catalog/groups
GET  /v1/community/feed           ?group ?limit ?offset
GET  /v1/community/posts/:id
```

### Member

```
GET    /v1/me/dashboard           today, readiness, week, load, timeline
GET    /v1/me/progress            every series the Progress page renders
GET    /v1/me/profile
PATCH  /v1/me/profile
GET    /v1/me/metrics             ?from
POST   /v1/me/metrics             log sleep/HRV/RHR/steps/water/soreness/stress
GET    /v1/me/devices
PATCH  /v1/me/devices/:provider
GET    /v1/me/billing
POST   /v1/me/billing/change-plan
POST   /v1/me/billing/cancel
GET    /v1/me/notifications
POST   /v1/me/notifications/read
GET    /v1/me/calendar            ?from ?to
PATCH  /v1/me/calendar/:id

GET    /v1/me/plan                roadmap, phases, weeks, days, progress
POST   /v1/me/plan                start a programme (builds the whole block)
GET    /v1/me/plan/days/:id       session + the member's own previous loads
PATCH  /v1/me/plan/days/:id       reschedule | skip | restore | shorten | substitute
POST   /v1/me/workouts            log a session -> records + next prescriptions
GET    /v1/me/workouts            ?from ?limit
GET    /v1/me/workouts/:id

GET    /v1/me/nutrition           ?date
POST   /v1/me/nutrition/recalculate
POST   /v1/me/nutrition/log
POST   /v1/me/nutrition/swap
GET    /v1/me/nutrition/week      ?weekStart
GET    /v1/me/nutrition/shopping-list
POST   /v1/me/nutrition/shopping-list/generate
PATCH  /v1/me/nutrition/shopping-list/:id
GET    /v1/me/nutrition/favourites
POST   /v1/me/nutrition/favourites

GET    /v1/me/recovery
POST   /v1/me/recovery/log

GET    /v1/me/coach
POST   /v1/me/coach/select
POST   /v1/me/coach/check-in
GET    /v1/me/coach-notes         shared notes only
GET    /v1/me/messages
GET    /v1/me/messages/:threadId
POST   /v1/me/messages/:threadId
POST   /v1/me/messages/:threadId/form-check/:messageId/comments
GET    /v1/me/bookings
POST   /v1/me/bookings

GET    /v1/me/challenges          boards, ranks, progress
POST   /v1/me/challenges/:slug/join
PATCH  /v1/me/challenges/:slug
POST   /v1/community/posts
POST   /v1/community/posts/:id/like
POST   /v1/community/posts/:id/save
POST   /v1/community/posts/:id/comments
POST   /v1/community/follow/:userId

GET    /v1/me/cart
POST   /v1/me/cart
DELETE /v1/me/cart/:slug
POST   /v1/me/orders
GET    /v1/me/orders

GET    /v1/ai/suggestions
POST   /v1/ai/ask
GET    /v1/ai/history
GET    /v1/ai/classify            ?question
```

### Coach

Every read joins through `coach_clients`; there is no endpoint that takes a
member id and trusts it.

```
GET  /v1/coach/overview           workload, capacity, flagged check-ins
GET  /v1/coach/clients
GET  /v1/coach/clients/:memberId
POST /v1/coach/clients/:memberId/notes
GET  /v1/coach/check-ins          ?status=pending|answered|all
POST /v1/coach/check-ins/:id/respond
GET  /v1/coach/calendar
GET  /v1/coach/messages
GET  /v1/coach/analytics
```

## Two endpoints worth reading

**`POST /v1/me/workouts`** is the one that does real work. It stores the
session and its sets, detects personal records against the member's own
history, runs the progression engine per exercise to produce the next
prescription, updates working loads with the phase bias divided back out, marks
the plan day complete, and applies the post-session difficulty rating to the
next session of the same kind. It returns the summary, the records and a
per-exercise explanation of what changes next time and why.

**`POST /v1/ai/ask`** assembles the member's real context — plan, readiness,
macros, equipment, adherence, last session RPE — and hands it to the pure
reasoning engine in `@forge/core`. Nothing about the answer is generated in the
route, which is what keeps the medical routing and the never-invent-data rules
enforced in one tested place instead of at the edge.

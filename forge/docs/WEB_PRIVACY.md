# Privacy

A training log records where you are, several times a week, with timestamps.
FORGE treats it as that rather than as content.

## Defaults

A new account gets these without doing anything:

| Setting | Default | Why |
| --- | --- | --- |
| Profile visibility | Followers | Discoverable only if you choose to be |
| New activities | Followers | Never public by accident |
| Routes | **Private** | A route usually starts where you live |
| Approve followers | On | Following is a request, not an action |
| Trim activity start and end | On, 250 m | A track that begins at your door is your address |

These are written by the signup trigger, so they exist from the first
millisecond of the account.

## Sanitizing a track

`sanitizeTrack` in `@forge/contracts` produces the shared version of a route:

1. **Trim both ends** by the hide radius.
2. **Remove anything inside a private zone**, wherever it falls — not just at
   the ends. A loop that passes your house halfway round is the case that
   end-trimming alone misses.
3. **Publish nothing if fewer than four points survive.** A two-point stub near
   home is not a route, it is a location, and shipping it would defeat step 1.

The result is encoded into `activities.map_polyline`. The full trace stays in
`activity_tracks`, which has one policy: owner only.

## Why the split is structural

Sanitizing on read would mean every query that returns an activity has to
remember to sanitize. One that forgets leaks the raw trace. Storing the
sanitized line separately means the raw geometry is not in the table the
sharing rules operate on at all, so the failure mode does not exist.

## Consent is granular

Four separate switches, all off at signup:

- **Coach sharing** — lets a connected coach see your training.
- **Aggregate contribution** — for a future popularity layer. Turning it on
  today changes nothing, and the setting says so.
- **Product analytics** — which screens get used. Never location, never health.
- **Model improvement** — off, and unused in the beta.

Bundling these would make "yes" meaningless.

## What the database enforces

Everything above is UI. The database is what actually stops a request:

- `privacy_settings` is readable only by its owner. Nobody can inspect another
  person's configuration to find out what they have opened up.
- `blocks` is readable only by the blocker. The blocked person is never told.
- A block overrides everything short of ownership, in both directions.
- Kudos and comments require the actor to be able to see the activity, so a
  hidden activity cannot be probed by writing to it.

## Verification

`private.rls_selftest()` makes 21 assertions, including that athlete A cannot
read athlete B's activities, tracks, streams, privacy settings, goals, records
or private profile, and cannot rename, retitle, delete, loosen or forge any of
them. See `WEB_BETA_TEST_PLAN.md`.

## Deletion

`auth.users` cascades to `profiles`, and every user-owned table cascades from
there. Deleting the account removes the training history rather than orphaning
it. Export is designed for but not implemented — the schema has no
export-blocking shape, and the product does not claim the feature exists.

## Beta caveat, stated in the product

This is beta software on a beta database. The privacy page says so rather than
implying durability the beta has not earned.

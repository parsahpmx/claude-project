# Web beta cost model

**Read this first.** The prices below are the published list prices as understood
at the time of writing and they change. Treat the *shape* of the model — what
drives cost, and which line item becomes the largest first — as the durable part,
and verify the numbers before committing to them.

## What actually drives cost

In rough order of how quickly each one bites:

1. **Map tiles.** Per-request pricing scales with map opens, not with users, and
   a single map screen can fire hundreds of tile requests. This is the line item
   most likely to surprise.
2. **Database size and egress.** GPS streams are the bulk of it — see below.
3. **Hosting.** Effectively flat until traffic is real.
4. **Auth.** Monthly active users, generous free ceilings.
5. **Storage.** Small until photo upload ships.

## Storage arithmetic, which is the part worth doing

A one-hour run recorded at one sample per second is ~3,600 points. Stored as
parallel arrays (time, distance, altitude, heart rate, cadence, velocity) that
is roughly **40–60 KB per activity** before compression, dominated by
`activity_streams`.

| Users | Activities/week each | Activities/month | Stream data/month | After 6 months |
| --- | --- | --- | --- | --- |
| 25 | 4 | 400 | ~20 MB | ~120 MB |
| 100 | 4 | 1,600 | ~80 MB | ~480 MB |
| 500 | 4 | 8,000 | ~400 MB | ~2.4 GB |
| 1,000 | 4 | 16,000 | ~800 MB | ~4.8 GB |

The summary rows are trivial by comparison — a few hundred bytes each.

**Consequence:** the free tier's 500 MB database is comfortable at 25 users,
tight at 100, and gone at 500. That is the trigger for Pro, and it is a
storage trigger rather than a user-count one.

## Estimates

Monthly, assuming a hosted tile free tier and no photo uploads.

| | 25 users | 100 users | 500 users | 1,000 users |
| --- | --- | --- | --- | --- |
| Supabase | Free | Free → Pro | Pro | Pro + storage |
| Hosting | Free / Hobby | Free / Hobby | Pro tier | Pro tier |
| Map tiles | Free tier | Free tier | Free tier → paid | Paid |
| Email | Free | Free | Free | Low |
| **Rough total** | **$0** | **$0–25** | **$25–60** | **$50–120** |

The wide ranges are honest: tile pricing depends on a provider not yet chosen,
and map opens per user is exactly the number a beta exists to discover.

## Free tier caveat that matters more than the price

Supabase free projects **pause after a period of inactivity**. For a beta with
sporadic use that means the first visitor after a quiet spell meets a cold
project. If beta users are external, Pro is worth it for that reason alone,
independently of storage.

## Levers, if cost becomes a problem

1. **Down-sample streams on ingest.** One sample per second is more than any
   screen displays. Storing every third sample cuts the dominant line item by
   two thirds and changes no chart visibly.
2. **Move to Protomaps on object storage.** Turns per-request tile pricing into
   flat storage plus egress. This is the structural fix, not a discount.
3. **Cache the public catalogue.** Programmes and challenges are identical for
   everyone and currently re-queried per request.
4. **Archive streams for old activities.** Summaries, splits and records are
   what people look at after a few months; the raw series can move to cold
   storage without changing any screen.

Nothing needs doing at beta scale. Lever 1 is the one to reach for first.

## What is deliberately not in this model

Stripe (beta is free), Edge Function invocations (none used), Realtime
(messaging is post-beta), and CDN egress for photography (upload not built).

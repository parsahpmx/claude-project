# Product

## The five questions

Every screen in FORGE answers at least one of these. A screen that answers none
does not ship.

1. **What should I do today?** — the dashboard leads with today's session, its
   length, its focus and one button.
2. **Why am I doing it?** — readiness explains itself by naming the weakest
   input; every week card states its nutrition goal and recovery target; every
   progression decision comes back with a sentence of reasoning.
3. **Am I making progress?** — Progress charts strength, volume, consistency,
   body and recovery from sessions actually logged, with gaps left visible.
4. **What should I do next?** — the roadmap shows all twelve weeks at once,
   with the next milestone named.
5. **Who can help me?** — the coach is one tap from the dashboard, and FORGE AI
   is on every screen that could raise a question.

## Screen map

### Marketing (17 routes)

| Route | What it does |
| --- | --- |
| `/` | Cinematic hero, live three-question assessment preview, the four-pillar system, a real dashboard preview, programmes, workout discovery, coaching |
| `/training` | Workout discovery — nine filter dimensions, equipment as a capability gate |
| `/programs` · `/programs/[slug]` | Catalogue and full programme page: overview, outcomes, who it is for, equipment, weekly schedule, coach, reviews, FAQ |
| `/nutrition` · `/nutrition/recipes/[slug]` | How targets are calculated, recipes, shopping list, full recipe page |
| `/coaching` · `/coaching/[slug]` | Marketplace with self-explaining ranking; coach profile with philosophy, certifications, availability, pricing, stories |
| `/recovery` | Readiness explained input by input, session catalogue |
| `/community` | Feed, groups, challenges |
| `/equipment` · `/equipment/[slug]` | Store organised by the programmes each product unlocks |
| `/for-coaches` | Coach acquisition and a working application form |
| `/pricing` | Three tiers, monthly/yearly with derived savings, comparison table, FAQ |
| `/blog` · `/blog/[slug]` | Knowledge hub, seven full articles |
| `/stories` | Case studies with real timeframes and adherence numbers |
| `/design-system` | The component library, live |

### Funnel (3 routes)

`/assessment` → ten steps, large visual choice cards, a performance profile at
the end · `/signup` → account, plan, payment method and the real recurring
billing disclosure · `/signin`.

The homepage preview carries its answers into the full assessment through the
query string, so nobody answers the same question twice.

### Member app (18 routes)

Home · My Plan · Programs · Explore · Nutrition · Progress · Recovery · Coach ·
FORGE AI · Community · Challenges · Calendar · Messages · Profile · Settings ·
Equipment · Notifications · Help — plus `/workout/[dayId]`, which sits outside
the shell on purpose.

### Coach workspace (8 routes)

Overview · Clients · Client profile · Program builder · Calendar · Messages ·
Check-ins · Analytics · Payments.

## The funnel, end to end

```
Landing → Assessment → Performance profile → Account + checkout
   → Onboarding → Plan built → First session → Completion + records
   → Progress → Coach recommendation → Weekly check-in → Retention
```

Every arrow is a working route. Signing up with an answer sheet creates the
member, their profile, their nutrition targets and their subscription in one
request; starting a programme schedules the entire twelve-week block — every
week, every session, every starting load — before the first workout.

## The twelve-week roadmap

Visible in the product at `/app/plan`, not just described in marketing.

| Weeks | Phase | Emphasis |
| --- | --- | --- |
| 0 | — | Assessment and baseline testing |
| 1–4 | **Foundation** | Movement quality, technique, baseline strength, consistency. Prescribed at 85% of true working load. |
| 5–8 | **Build** | Progressive overload, volume increase, nutrition around training. 95%. |
| 9–12 | **Perform** | Peak strength, benchmarks, personal records. 105%. |

Phase boundaries scale with programme length, so an eight-week 5K build and a
sixteen-week marathon build both get three coherent phases. The last week of
any phase of four weeks or more is a deload: volume drops, load holds.

Week 1 is marked *Baseline testing*, the midpoint *Mid-block benchmark*, week
`n−2` a *PR attempt* or *Time trial* depending on goal, and the final week
*Final assessment and progress report*.

## What makes the plan personal

- **Frequency is capped by experience,** not by ambition — a beginner asking
  for six days gets four, and is told why.
- **Equipment is a hard gate.** No session ever asks for a bar the member does
  not own; movements substitute within the same pattern, and when no substitute
  exists FORGE says so rather than swapping in something unrelated.
- **Time is respected.** Any session rebuilds to 20 or 30 minutes by dropping
  accessories from the bottom up. The main lift is the last thing to go.
- **Progression is driven by what was logged,** never by what the plan hoped
  for. Miss the rep target and the load holds; grind at RPE 9.5 and it backs
  off; hit the top of the range on every set and it climbs.
- **Readiness can change today's session.** Below 50 the guidance is to swap to
  mobility, and it says why.
- **The difficulty rating after a session** moves the next session of the same
  kind by up to 5%.

## Deliberate product decisions

**Challenges measure actions, never outcomes.** The metric union —
sessions, steps, active minutes, distance, mobility sessions, streak days — has
no way to express a weight-loss competition. That is a type-level guarantee,
not a content guideline.

**Success stories state process, not transformations.** Every one carries the
time period and the adherence percentage. There are no before-and-after weight
claims anywhere in the product, and the community rules say so out loud.

**Nutrition has a floor.** Goal adjustment is bounded at ±20%, with a hard
floor at 1,500 kcal and never below the member's own resting requirement.

**Coaches are capped at forty clients,** shown on their own dashboard as a
utilisation figure, and members can see how many slots are open this week.

**FORGE AI does not answer medical questions.** Every injury, pain, pregnancy
or medication phrasing routes to a qualified professional with no hedging. The
term list is deliberately over-broad: a false positive costs one redirect, a
false negative is a fitness product giving injury advice.

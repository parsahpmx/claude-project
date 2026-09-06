# Web beta scope

Every competitive capability from §96, classified. **BETA CORE** means the beta
is not a beta without it. **BETA OPTIONAL** means it ships behind a flag that an
environment can switch off. **POST-BETA** means the surface does not exist, and
`isEnabled()` will not turn it on regardless of what an environment says.

| Capability | Class | State today |
| --- | --- | --- |
| Auth and accounts | CORE | Built |
| Onboarding | CORE | Built — five steps |
| Activity recording (manual) | CORE | Built |
| Activity analysis | CORE | Built — splits, pace, climbing, effort |
| Strength logging | CORE | Schema and display built; web set-logger not built |
| Training log | CORE | Built, cursor-paginated |
| Personal activity map | CORE | Built |
| Route display | CORE | Built |
| Route mapping (builder) | CORE | **Not built** — see WEB_MAPS.md |
| Training plans | CORE | Schema and week view built; plan generation not wired |
| Programme catalogue | CORE | Built, six programmes |
| Progress and metrics | CORE | Built |
| Goals | CORE | Built |
| Privacy controls | CORE | Built |
| Private zones | CORE | Schema and logic built; drawing UI not built |
| Feed | OPTIONAL | Built, flagged |
| Follows | OPTIONAL | Schema and policies built; UI not built |
| Clubs | OPTIONAL | Schema and policies built; browse UI built |
| Challenges | OPTIONAL | Schema built; browse UI built; joining not wired |
| Events | OPTIONAL | Schema built; UI not built |
| Kudos and comments | OPTIONAL | Schema and policies built; UI not built |
| Suggested routes | POST-BETA | Not built |
| Global heatmap | POST-BETA | Not built, no data collected |
| Segments | POST-BETA | Not built |
| Live segments | POST-BETA | Not built |
| Leaderboards | POST-BETA | Not built |
| Messaging | POST-BETA | Not built |
| Coaching | POST-BETA | Consent switch exists; product not built |
| Nutrition | POST-BETA | Not built in the beta app |
| Recovery | POST-BETA | Not built in the beta app |
| Device integrations | POST-BETA | Not built |
| Activity file upload (FIT/GPX/TCX) | POST-BETA | Not built |
| Subscriptions and billing | POST-BETA | Not built — beta is free |
| Admin and moderation | POST-BETA | Not built |

## The honest summary

The beta can do this end to end: **sign up, onboard, record activities, see them
analysed, see them on a personal map, track goals and progress, and control who
sees any of it.**

It cannot yet: build a route, generate a plan from the catalogue, log a
strength session from the web, draw a private zone, follow another athlete, or
upload a GPS file.

## Deliberate omissions

Some absences are decisions, not gaps:

- **No weight-loss competition is possible.** `challenges.metric` is
  constrained to `distance_m`, `sessions`, `minutes` or `elevation_m`. The
  column cannot express a body-composition contest.
- **No global heatmap and no data collection for one.** The consent switch
  exists and is off, and the UI says turning it on changes nothing today.
- **No coach marketplace.** Populating it with placeholder coaches would be
  fiction.

# VYRA Operator Console

A read-mostly window onto the engine, plus the kill switch.

## Running it

```bash
# 1. the API (from the repository root)
export VYRA_API_SECRET="$(python3 -c 'import secrets; print(secrets.token_urlsafe(48))')"
export VYRA_API_USERS="alice:$(python3 -c 'import secrets; print(secrets.token_urlsafe(12))'):OPERATOR"
python3 -m uvicorn apps.api.main:app --port 8000

# 2. the console
cd apps/dashboard
npm install
npm run dev          # http://localhost:3000
```

`npm run typecheck` type-checks it (route types are generated first, so it works on a clean
checkout), and `npm run build` produces the production bundle.

`VYRA_API_USERS` is `name:password:ROLE,...` with roles `VIEWER`, `TRADER`, `OPERATOR`,
`ADMIN`. There is no default account and no default signing secret; the API refuses to
start without both. Point the console at a different API with
`NEXT_PUBLIC_VYRA_API_URL`.

## What it does and does not do

The console **renders what the engine decided**. It computes no trading figure, holds no
trading state, and has no server-side route that reaches the engine. That is the platform's
single-authority rule applied to the UI: an interface that could recompute a risk number
would be a second answer to a question that must have exactly one.

Consequences worth knowing before reading a screen:

* **Positions are empty** until a live trader is attached. The closing position of a
  backtest is not a held position, and the page says so instead of showing one.
* **Orders, fills and signals are scoped to a completed run.** There is no live order flow
  in this build.
* **No prices are displayed.** No market-data feed is attached; a price carried over from a
  research run is not a live price.
* **ML Models and AI Analysis are empty pages that say they are empty.** Placeholder
  metrics for an unbuilt subsystem eventually get read as real ones.
* **Every performance figure appears with its gross and net columns together.** There is no
  view that shows the gross figure alone.
* **`enabled` is not `promoted`.** Enabled is a line in a config file; promoted means the
  validation pipeline passed the strategy. Nothing is promoted.

## Authentication

Sign-in exchanges a username and password for a short-lived JWT. The token is kept in
`sessionStorage`, not `localStorage`: an operator console's credential should not outlive
the tab. The role in the token is used only to hide controls the caller cannot use — every
request is authorised again by the API, which is the only place authorisation is decided.

## The kill switch

It is a bar on every page rather than a card on one, because whether the platform may trade
must be readable from wherever an operator happens to be when something goes wrong.

Halting asks only for a reason. Clearing asks for a reason *and* an explicit assertion that
the triggering condition is gone, is recorded against the signed-in account, and is refused
by the engine if it comes too soon after the trip. The dialog cannot override that refusal —
it surfaces it.

If the kill-switch state cannot be read, the bar says so and tells the operator to treat the
platform as halted. An unknown state is not a safe state.

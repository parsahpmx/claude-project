# Phase 4 implementation report — data pipeline, API and console

**Scope:** the Parquet normalised data layer (item 4's remaining half) and the interface
layer — the FastAPI service (item 20) and the Next.js console (item 20b).

**Result:** all three are built, tested and exercised end to end. The console was driven in
a real browser against a running API reading a real backtest, not only type-checked and
built.

---

## Findings from building it

Six defects were found and fixed. Each is recorded because each produced a *plausible
wrong answer* rather than an obvious failure — the only kind worth writing down.

### 1. The SYNTHETIC watermark was lost through the storage layer

Ingesting a synthetic dataset into Parquet and running from it produced a report with no
synthetic warning. The runner detected synthetic data by looking for `SYNTHETIC` in the
source id, and reading through the store changed that id to `PARQUET:<dataset>`. The
watermark was therefore attached to the *transport*, not to the data.

The runner now propagates the dataset manifest's own notes into the run manifest, so a
provenance warning survives every hop the data takes. A watermark that a round-trip through
storage can remove is not a watermark.

### 2. `client_id` was not credential-shaped enough

The config endpoint stripped fields whose names looked like credentials, and a broker
`client_id` passed the filter — it does not contain "password", "secret" or "token".

Extending the list would have left the next omission to be found the same way, so whole
`connection`, `credentials` and `auth` blocks are now removed regardless of contents. A
connection block exists to hold the details of reaching a venue; nothing in one belongs in
an HTTP response.

The inverse error appeared immediately after: `account` as a hint removed `risk.yaml`'s
`account` block, hiding starting equity and currency from the risk page. The filter now
matches `account_id`/`account_number` and leaves the plain word alone — every broker
account identifier in the shipped configuration is inside a connection block anyway.

### 3. The equity endpoint returned the head of the file, so every curve was flat

The console drew a flat line at $100,000 for a run that made $890 and drew down $643. The
API bounded the response at 500 rows by taking the first 500 — and a backtest writes an
equity point per second, so the first 500 points of a 410,431-point curve are all at the
opening balance.

The endpoint now samples evenly across the whole artefact and always includes the final
point, and returns the total so the client can say what fraction it is drawing. Truncation
is a reasonable answer for a ledger, where the head is genuinely the beginning; for a curve
it is a picture of the wrong thing.

### 4. Costs of three different units were summed into one number

The analytics block reports commission and fees in currency, `drag_pct_of_gross` as a
fraction and `headroom` as a multiple. The console summed the block and rendered every
entry as money, producing a "total cost" of $230.20 against a real total of $72.27, and
displaying a 13.3× cost headroom as "$13.32".

Each figure is now classified explicitly, the total comes from the engine's own `total`
rather than a client-side sum, and an unrecognised key renders as a bare number — guessing
"money" would put a currency symbol on something that may not be an amount.

### 5. `[object Object]` in the run picker

The run manifest records a strategy as `{id, version}`, because a result belongs to a
specific version. The summary endpoint passed the objects through as `strategies`, typed as
strings, and the browser rendered them the way browsers do.

The API now flattens them to `id@version` for summary rows and leaves the manifest untouched
on the detail endpoint. Flattening once in the API beats every client doing it — the version
matters, so dropping it was not an option either.

### 6. The API's own state lived among the run artefacts

The kill switch persisted to `runs/kill_switch_state.json`. That directory holds the record
of what a run produced and should be mounted read-only for a service that only displays it —
but with the switch's state file inside it, a *trip would fail exactly when it mattered*,
since the switch re-raises when it cannot record that it is tripped.

State now goes to a separate `VYRA_STATE_DIR`, defaulting to the runs directory for local
use, and the compose stack mounts runs read-only with a writable volume for state.

---

## Deliberate design decisions

**The API is read-mostly.** Twenty-two endpoints, of which exactly two change anything: trip
the kill switch and clear it. There is no endpoint to start a backtest, submit an order or
change a risk limit. An API that could mutate risk state would be a second path into the
risk engine, and the platform's central guarantee is that there is only one.

**Missing evidence is displayed as missing.** The console shows no price (no feed is
attached), no positions (no trader is attached), and the ML and AI pages state that nothing
is built. Rendering a backtest's closing position as a held position, or plausible metrics
for an unbuilt model, is how a number nobody computed ends up in a decision.

**Gross and net are always shown together.** The performance view has no mode that displays
the gross figure alone, because a screenshot of one is a claim the platform exists to
prevent.

**`enabled` and `promoted` are separate columns and both are always shown.** Enabled is a
line in a config file; promoted means the validation pipeline passed the strategy. Nothing
is promoted, and the page says why rather than leaving the column looking unfinished.

**No default account and no default signing secret.** The API refuses to start without
`VYRA_API_SECRET` (32 characters minimum) and `VYRA_API_USERS`. Both are checked during
startup rather than on the first request: a service that accepts traffic and then refuses
every call is harder to diagnose than one that never came up.

**The token lives in `sessionStorage`.** An operator console's credential should not outlive
the tab. The role in the token only hides controls; the API authorises every request, which
is the only place authorisation is decided.

---

## Verification

* `tests/data` — 26 tests over the ingestion pipeline, Parquet round-trip, manifests and
  content hashing.
* `tests/api` — 55 tests. The credential test walks every GET endpoint the OpenAPI document
  declares with sentinel credentials injected through the shipped config's own `${VAR}`
  interpolation, so a new endpoint is covered the day it is added rather than when someone
  remembers. Disabling the credential filter makes it fail, which is how it was confirmed to
  test anything.
* The console was driven in Chromium against a live API serving a real 410,431-point run:
  all thirteen pages rendered with no console error and no failed request, the kill switch
  was tripped through the UI, the halt appeared on the status page, and an immediate reset
  was refused with the switch's own explanation ("tripped for 7.3s, minimum is 60.0s").

---

## What is not built

The API serves completed runs because that is all the engine has. No live trader, no feed,
no order flow. When those exist they register with the same `EngineState` and the routers do
not change — which is the reason the state object exists at all rather than the routers
reading files directly.

Latency, feed staleness, broker connectivity and order round-trip times are specified but
not exported; the System Health page says so instead of estimating them.

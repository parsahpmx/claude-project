# Promoting a strategy to live

One explicit, human-triggered action. It is downstream of and separate from the kill switch,
and it produces its own audit record.

**Nothing in this repository is promoted, and nothing can be yet.** Promotion requires
paper-trading evidence that cannot exist: there is no live feed, so there have been no
paper-trading days at all, clean or otherwise. The mechanism is built and tested; it has not
been used.

## The bar

Every item is a precondition, not a score. There is no weighted total that lets a strong
walk-forward result compensate for an unresolved reconciliation break — those are not
commensurable, and a number that pretends they are is a number somebody will optimise.

**Missing evidence is a failure.** A requirement nobody measured is not a requirement nobody
violated.

| Requirement | Default | Why |
|---|---|---|
| Validation pipeline passed, with a run id | required | Without it there is no evidence of an edge at all. A pass with no run behind it cannot be checked. |
| Consecutive clean paper-trading days | 20 | *Consecutive*, not cumulative. A strategy that runs clean for nineteen days, breaks, and runs clean for nineteen more has demonstrated that it breaks. The counter resets. |
| Paper trades | 100 | Twenty clean days at two trades a day is forty trades, which cannot distinguish an edge from a run of luck. |
| Paper result within tolerance of the backtest | 50% | **Better than expected fails too.** A paper result far above the backtest means the backtest is not modelling what happens, which is exactly as disqualifying as one far below — and much easier to talk yourself into accepting. |
| Unresolved reconciliation breaks | 0 | A position the engine and the venue disagree about is a position nobody knows the size of. |
| Explicit per-strategy risk limits | required | Not inherited defaults. Somebody decided what this strategy may lose. |
| Kill switch armed | required | Promoting while trading is halted means promoting without anybody able to watch what happens next. |
| A named human approver | required | Service accounts are refused by name: `system`, `ci`, `bot`, `automation`, `admin`, `root`. An approval attributed to automation is an approval nobody made. |

The requirements are configuration (`PromotionRequirements`), so raising the bar is a
reviewed diff.

## What a promotion is keyed by

Strategy id **and** version **and** config hash. A strategy whose parameters changed is not
the strategy that was promoted, however similar — the parameters *are* the strategy, and the
evidence was gathered about a particular set of them. A parameter change therefore
de-promotes automatically rather than inheriting an approval given for something else.

## Its relationship to the kill switch

Separate, in both directions:

* Promoting **does not** clear a halt.
* A halt **does not** demote.

They answer different questions — *may this strategy trade at all* versus *may anything
trade right now*. A mechanism that conflated them would let a halt quietly undo a decision a
human made, or a promotion quietly undo a halt.

A promoted strategy still cannot trade while the switch is tripped: the venue-boundary guard
refuses the order regardless of promotion state. Promotion is permission, not an override.

## The record

Append-only. A promotion is never edited into a demotion; it is followed by a separate
demotion record. Each record carries the approver, the timestamp, the reason, and the full
assessment — the evidence *and* the requirements it was judged against, so a decision can be
reviewed later against the bar as it stood at the time rather than as it stands now.

Stored in PostgreSQL when a database is configured. Without one the ledger is in memory,
which is correct for research and is not correct for anything that could trade: a promotion
that does not survive a restart is a promotion nobody can audit. The ledger logs a warning
when it is not durable.

## Demotion

Deliberately easier than promotion: no assessment, no bar. Stopping is always allowed, in
the same way the kill switch is always allowed to trip. The approver is still recorded,
because a demotion is also a decision somebody made.

## What is refused

A promotion against a failed assessment raises, rather than being logged as an override. An
override that is merely logged is an override that becomes routine.

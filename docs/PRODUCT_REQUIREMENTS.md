# Meter402 — Product Requirements

**Status:** Living document. Last revised at the close of Phase 0.
**Owner:** Product / CTO

---

## 1. What Meter402 is

Billing infrastructure for autonomous software.

A developer owns an API. They install Meter402, set a price, and their endpoint
starts accepting machine-native payments. An agent that calls the endpoint
receives a machine-readable payment challenge, pays in stablecoin, retries with
a proof, and gets served. The merchant gets a payment, a receipt, a usage
event, a webhook, and analytics.

**Positioning:** Stripe Billing for the machine economy.
**MVP rail:** USDC on Base, over the x402 protocol.

## 2. The problem

Purchasing on the internet assumes a human and a legal entity: an account,
a card, a subscription, an API key issued by hand, an invoice, an approval.
Every step assumes someone can complete a signup form and accept terms.

Autonomous software cannot efficiently negotiate that. What it needs is a
loop that completes in one request cycle:

1. discover a service
2. discover its price
3. decide whether the price is acceptable
4. authorize payment
5. pay
6. receive a verifiable receipt
7. access the resource
8. record the expenditure
9. enforce a spending policy
10. reconcile later

Steps 4 through 7 are where existing infrastructure has no answer. That is the
gap Meter402 fills.

### What we are explicitly not claiming

The agent economy is an emerging market, not a proven one. This document does
not assert that merchants already want machine-native payments — Phase 8 of
the roadmap exists to find out, and §11 below states what would falsify the
thesis. Building on an unvalidated premise is fine; pretending it is validated
is not.

## 3. Customers

B2B developer infrastructure. Not consumers.

**Initial target segments**, roughly in order of expected fit:

| Segment | Why they fit |
| --- | --- |
| MCP server developers | New surface, no billing story at all, agent traffic by definition |
| AI/model inference providers | Per-request economics already; agent traffic already material |
| Specialised data and financial-data APIs | High value per call, small transaction sizes |
| Search and research APIs | Agent-driven traffic already growing |
| GPU and compute providers | Metered by nature |
| Blockchain RPC providers | Already crypto-native, low objection to stablecoin settlement |

**Design partner profile:** small AI-infrastructure startups and MCP vendors —
teams that can integrate in an afternoon and give direct feedback. Explicitly
not large enterprises for the first cohort; their procurement cycle is longer
than our runway to learn.

## 4. North star and secondary metrics

**North star:** successful paid machine requests per month.

Chosen because it is the only metric that moves when the product actually
works end to end. Revenue lags it, signups precede it and mean nothing, and
payment volume can be inflated by a single large merchant.

**Secondary:** total payment volume, active merchants, active agents, merchant
retention, payment success rate, integration time, average payment size.

**Developer-experience KPIs:** time to first test payment (target < 5 min),
time to first live payment (target < 10 min), test-to-live conversion rate,
integration error rate.

## 5. Core product requirements

### 5.1 Merchant-facing

- Account, organization, project, and environment (TEST / LIVE) model.
- Role-based access control enforced server-side, never in the frontend.
- API keys with visible environment prefix, hashed at rest, shown once.
- Endpoint registry with per-endpoint pricing.
- Fixed per-request pricing for MVP; the pricing interface must support usage,
  token, and compute pricing later without touching the payment path.
- Dashboard: overview, transactions, endpoints, agents, analytics, API keys,
  webhooks, team, audit.
- Signed webhooks with retries and manual replay.
- Receipts for every confirmed payment.
- Settlement wallet configuration, with confirmation and audit on change.

### 5.2 Agent-facing

- A machine-readable payment challenge on an unpaid request.
- Verifiable settlement, then immediate access to the resource.
- Stable, machine-readable error codes so an agent can decide whether to
  retry, re-pay, or stop — never string-matching on a message.
- A receipt it can store and later reconcile.

### 5.3 Non-negotiable correctness requirements

These are product requirements, not implementation details, because violating
any of them loses money or trust in a way that cannot be patched afterwards.

| # | Requirement | Enforced by |
| --- | --- | --- |
| R1 | No floating-point arithmetic on monetary amounts, anywhere | `Money` (BigInt minor units) + ESLint rule |
| R2 | A TEST project can never produce a mainnet transaction | `assertChainAllowedForEnvironment`, called at pricing and request creation |
| R3 | Payment data supplied by a client is never trusted | Verification reads everything from our own record; the agent supplies only a tx hash |
| R4 | One transaction can settle at most one payment request | DB `UNIQUE (chain_id, transaction_hash)` + `ReplayGuard` |
| R5 | A payment status can never move backwards | Frozen transition table; all 100 status pairs tested |
| R6 | An infrastructure outage must never fail a valid payment | RPC failures resolve to PENDING, not FAILED |
| R7 | Every query is scoped to an organization | Tenant-bound repositories; cross-tenant access tested |
| R8 | Secrets are never committed, logged, or returned | `.gitignore`, structured-log redaction, hashed key storage |

## 6. Business model

**Subscription tiers** (pricing is configuration, never hardcoded):

| Plan | Price | Transaction fee |
| --- | --- | --- |
| Free | $0 | limited monthly requests |
| Startup | ~$99/mo | ~0.8% |
| Growth | ~$499/mo | ~0.5% |
| Enterprise | custom | custom |

**Enterprise add-ons:** SSO, SLA, dedicated infrastructure, higher limits,
compliance exports, advanced risk, audit log export, private networking,
custom settlement.

**Explicitly not in the business model:** no token, no ICO, no governance or
staking token, no proprietary stablecoin, no new blockchain. Revenue comes
from subscriptions and transaction fees on real volume.

## 7. MVP scope

**In scope:** accounts, organizations, projects, RBAC, API keys, endpoint
configuration, fixed pricing, Base + USDC, x402, payment verification, replay
protection, receipts, transactions dashboard, webhooks, analytics, SDK, MCP
example, TEST mode simulator, documentation, production deployment.

**Out of scope for MVP**, and each for a reason rather than a schedule:

| Not building | Why |
| --- | --- |
| Any token | No product need; adds securities risk and distracts from revenue |
| More than one chain | Multi-chain multiplies the verification surface before we know anyone wants chain two |
| Custom smart contracts | Plain USDC transfers need no contract; a contract holding funds needs an audit we cannot yet justify |
| Consumer wallet app | Wrong customer |
| ML risk models | No training data exists yet; deterministic rules first |
| Mobile app | Wrong surface for developer infrastructure |
| Refunds (beyond schema support) | Post-MVP; the data model reserves room, the flow is manual first |

## 8. Onboarding requirements

The activation path is the product. Target: a developer reaches a successful
test payment in under five minutes.

1. Create account → 2. Verify email → 3. Create organization → 4. Create
project → 5. Choose integration (Node/Express/Fastify/Next.js/MCP/raw HTTP) →
6. Generate TEST key → 7. `npm install @meter402/sdk` → 8. Wrap an endpoint →
9. Run a simulated payment → 10. See it in the dashboard → 11. Configure
settlement wallet → 12. Switch to LIVE.

An **activated merchant** is one that has created a project, created an
endpoint, completed a test payment, and received a first live payment. That
compound definition is deliberate: any single step is a vanity metric.

## 9. Compliance posture

Meter402 is not a bank, exchange, custodian, or stablecoin issuer, and must
never describe itself as one or imply regulatory approval it does not hold.

Architecturally this means **Meter402 never takes custody**. Payments move
directly from the agent's wallet to the merchant's settlement address; we
verify that it happened. That single decision keeps custody, and most of the
money-transmission surface that follows from it, out of the system.

Integration points are designed for but not built: KYC/KYB providers,
sanctions screening, transaction monitoring, regulated custody, on/off ramps.
Qualified counsel must be engaged for the relevant jurisdictions before
production financial operation.

## 10. Success targets

Targets for 90 days after public beta. These are goals, not forecasts, and
must never be reported as achieved results.

- 50 registered developers
- 20 integrated merchants
- 10 active merchants
- 5 paying merchants
- 1M+ metered requests
- 100k+ machine payment attempts

## 11. What would falsify the thesis

Stated up front so the team notices it rather than rationalising it.

If merchants integrate but agent traffic never materialises, or merchants say
the payment rail is not their bottleneck, the adjacent problems worth pivoting
toward are: agent billing and budgets, agent authentication, usage metering
without payment, and agent procurement. The signal to watch is whether
integrated merchants see repeat agent transactions without us prompting them.

Continuing on the original thesis purely because it was the original thesis is
the failure mode this section exists to prevent.

# Security Policy

## Reporting a vulnerability

**Please do not open a public issue for a security vulnerability.**

Email **security@meter402.com** with:

- a description of the issue and its impact
- steps to reproduce, or a proof of concept
- affected component and version or commit
- any suggested remediation

If you would like to encrypt your report, request our PGP key at the same
address first.

### What to expect

| Stage | Target |
| --- | --- |
| Acknowledgement | within 2 business days |
| Initial assessment and severity | within 5 business days |
| Status updates | at least every 7 days while open |
| Fix for critical issues | as fast as we safely can, with a coordinated disclosure date |

We will credit you in the advisory unless you prefer otherwise.

## Scope

**In scope**

- The Meter402 API and control plane
- The merchant dashboard
- Published `@meter402/*` packages
- Payment verification logic
- The webhook delivery system
- This repository's infrastructure and CI configuration

**Out of scope**

- Base, USDC, or any third-party blockchain or token
- Third-party RPC providers
- A merchant's own application
- An agent's wallet custody
- Denial of service through sheer traffic volume
- Findings from automated scanners without a demonstrated impact
- Social engineering of our staff or users

## Safe harbour

We will not pursue legal action for good-faith security research that:

- respects this scope
- avoids privacy violations, data destruction, and service degradation
- uses only your own accounts and test data
- does not access, modify, or retain another user's data
- gives us reasonable time to remediate before public disclosure

If you are unsure whether something is in scope, ask before testing.

## Areas we are most interested in

Given the product, these carry the highest impact:

1. **Payment verification bypass** — anything that yields a `CONFIRMED`
   payment without a corresponding on-chain transfer.
2. **Replay** — using one blockchain transaction to settle more than one
   payment request.
3. **Cross-tenant access** — reading or modifying another organization's data.
4. **Settlement address manipulation** — redirecting a merchant's payouts.
5. **API key compromise** — extraction, forgery, or bypass of revocation.
6. **Webhook forgery** — producing a signature a merchant's verifier accepts.
7. **SSRF via webhook URLs** — reaching internal services or cloud metadata.
8. **TEST/LIVE boundary violations** — causing a test flow to move real funds.

## Our own security posture

See [`docs/SECURITY.md`](docs/SECURITY.md) for engineering standards and
[`docs/THREAT_MODEL.md`](docs/THREAT_MODEL.md) for our adversary analysis,
including an honest list of what is not yet mitigated.

Meter402 never takes custody of funds. Payments move directly from an agent's
wallet to the merchant's settlement address; we verify that it happened. There
is no Meter402 hot wallet to compromise.

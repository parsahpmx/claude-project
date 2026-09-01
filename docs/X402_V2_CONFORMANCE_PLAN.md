# x402 v2 — Conformance Plan

**Status:** written before implementation, as Phase 3 STEP 1 requires.
**Authoritative sources used:** `@x402/core@2.24.0` and `@x402/evm@2.24.0`
(scope `@x402`, published by the x402 project), inspected and **executed**
offline in this environment. Where this document states a wire shape, it was
obtained by running the official client and printing what it produced — not by
reading prose and guessing.

---

## 0. Two findings that change the shape of Phase 3

### 0.1 There are two different "x402" package lineages, and only one is v2

The Phase 3 prompt targets x402 **protocol version 2**. That version is real,
but it is **not** in the package this repository's Phase 0 adapter was written
against.

| Package                    | Latest  | Protocol versions | Network format             |
| -------------------------- | ------- | ----------------- | -------------------------- |
| `x402` (unscoped, legacy)  | 1.2.0   | `[1]` only        | slugs (`"base-sepolia"`)   |
| `@x402/core` (scoped)      | 2.24.0  | `1` and `2`       | CAIP-2 (`"eip155:84532"`)  |

Verified directly:

```
x402@1.2.0        → declare const x402Versions: readonly [1];
@x402/core@2.24.0 → x402Version: z.literal(1) | z.literal(2)
                    type Network = `${string}:${string}`
```

Had Phase 3 been implemented against the unscoped `x402` package, "v2" would
have been unimplementable and the resulting server would have spoken v1 while
claiming v2. **All Phase 3 work targets `@x402/core@2.x` semantics.**

This also confirms the prompt's CAIP-2 guidance was right and the repository's
Phase 0 assumption (`accepts[]` with `maxAmountRequired`, `X-PAYMENT` header)
is **v1 and obsolete for our purposes**. See §6.

### 0.2 This environment cannot reach Base Sepolia or any hosted facilitator

Outbound HTTPS is policy-filtered. Measured:

```
sepolia.base.org:443 → gateway answered 403 to CONNECT (policy denial)
x402.org:443         → gateway answered 403 to CONNECT (policy denial)
registry.npmjs.org   → reachable (on the proxy bypass list)
```

Consequences, stated plainly so no reader mistakes them:

- **STEP 48 (real Base Sepolia end-to-end settlement) cannot be executed
  here.** No testnet RPC, no funded wallet, no hosted facilitator.
- **STEP 43's "independent facilitator interoperability" cannot be executed
  here** against a hosted facilitator.
- **STEP 43's "independent client interoperability" CAN be executed**, and is,
  because signing is local cryptography: the official `@x402/core` +
  `@x402/evm` client produces real EIP-3009 signatures with no network access.

Therefore the **x402 release gate remains OPEN** at the end of Phase 3. What
closes it is listed in §9. This is not a judgement call about code quality —
two of the gate's required conditions are simply not executable in this
environment, and claiming otherwise would be the exact dishonesty STEP 49 and
STEP 59 warn against.

---

## 1. Protocol version

| | |
| --- | --- |
| **SPEC REQUIREMENT** | `x402Version` is a number; v2 is `2`. `@x402/core` accepts `1` and `2`. |
| **METER402 DOMAIN MAPPING** | `X402_V2_VERSION = 2`, a constant in `@meter402/x402`. The domain has no notion of protocol version; it is adapter-local. |
| **IMPLEMENTATION STATUS** | Implemented. Any `x402Version` other than `2` is rejected with a protocol error. v1 payloads are **not** silently reinterpreted. |
| **TEST COVERAGE** | Fixture: `x402Version: 1` rejected. Fixture: missing version rejected. Fixture: `"2"` (string) rejected. |

## 2. `PaymentRequirements` (one entry of `accepts`)

Ground truth from `@x402/core@2.24.0`:

```ts
type PaymentRequirements = {
  scheme: string;              // "exact"
  network: Network;            // CAIP-2, e.g. "eip155:84532"
  asset: string;               // token contract address
  amount: string;              // atomic units, decimal string
  payTo: string;               // recipient address
  maxTimeoutSeconds: number;
  extra: Record<string, unknown>;   // EIP-712 domain for EIP-3009
};
```

Note this differs from v1 in three ways that matter: `amount` replaces
`maxAmountRequired`, `network` is CAIP-2 rather than a slug, and
`resource`/`description`/`mimeType` have moved out to `PaymentRequired.resource`.

| | |
| --- | --- |
| **SPEC REQUIREMENT** | Fields exactly as above. `extra` carries the EIP-712 domain `{ name, version }` for the EIP-3009 asset. |
| **METER402 DOMAIN MAPPING** | Built **only** from the stored `PaymentRequest` snapshot plus the trusted `AssetConfig`. `amount` is `PaymentRequest.amountMinorUnits.toString()` — BigInt to string, never through `Number`. `payTo` is the snapshot recipient. `network` is derived from the snapshot `chainId` through the server-owned registry. |
| **IMPLEMENTATION STATUS** | Implemented in `toPaymentRequired()`. |
| **TEST COVERAGE** | The official `@x402/core` client consumes our `PaymentRequired` and produces a valid payload — that is the conformance assertion, not a hand-written expectation. |

## 3. `PaymentRequired` (the 402 body)

```ts
type PaymentRequired = {
  x402Version: number;
  error?: string;
  resource: ResourceInfo;          // { url, description?, mimeType?, ... }
  accepts: PaymentRequirements[];
  extensions?: Record<string, unknown>;
};
```

| | |
| --- | --- |
| **SPEC REQUIREMENT** | As above. Served with HTTP 402. |
| **METER402 DOMAIN MAPPING** | `resource.url` is the absolute URL of the paid endpoint. `accepts` has exactly one entry in Phase 3 — we quote one price, in one asset, on one network. No proprietary extensions. |
| **IMPLEMENTATION STATUS** | Implemented. `Cache-Control: no-store` retained from Phase 2 (a cached 402 is a replayable payment instruction). |
| **TEST COVERAGE** | Round-trip through the official `decodePaymentRequiredHeader`; official client selects our requirement and signs it. |

## 4. `PaymentPayload` (client → server)

Ground truth, **printed from the official client**:

```json
{
  "x402Version": 2,
  "payload": {
    "authorization": {
      "from": "0x7099...79C8",
      "to": "0x2096...287C",
      "value": "30000",
      "validAfter": "0",
      "validBefore": "1788277405",
      "nonce": "0xb14789f5...8ca4"
    },
    "signature": "0x80729e94...1c"
  },
  "resource": { "url": "...", "description": "...", "mimeType": "..." },
  "accepted": { "scheme": "exact", "network": "eip155:84532", "...": "..." }
}
```

| | |
| --- | --- |
| **SPEC REQUIREMENT** | `payload` is scheme-specific; for EVM `exact` it is an EIP-3009 `TransferWithAuthorization` (`from,to,value,validAfter,validBefore,nonce`) plus a 65-byte `signature`. The client **echoes back** the requirement it chose as `accepted`. |
| **METER402 DOMAIN MAPPING** | **`accepted` is treated as hostile and is never canonical.** It is compared field-by-field against our stored `PaymentRequest`; any divergence is a rejection. The canonical expectation always comes from the database. This is the single most important mapping decision in Phase 3. |
| **IMPLEMENTATION STATUS** | Implemented in `parsePaymentPayload()` (bounded, prototype-safe) and `bindAuthorizationToRequest()`. |
| **TEST COVERAGE** | Negative fixtures for every field of `accepted` mutated away from the `PaymentRequest`; see §8. |

## 5. HTTP transport

Confirmed from `@x402/core/http`:

| Direction | Header | Body |
| --- | --- | --- |
| server → client (402) | `PAYMENT-REQUIRED` (base64 JSON) | also the JSON `PaymentRequired` |
| client → server | `PAYMENT-SIGNATURE` (base64 JSON `PaymentPayload`) | — |
| server → client (200) | `PAYMENT-RESPONSE` (base64 JSON `SettleResponse`) | merchant response |

The v1 header names (`X-PAYMENT`, `X-PAYMENT-RESPONSE`) are **not** emitted by
the v2 adapter.

| | |
| --- | --- |
| **IMPLEMENTATION STATUS** | Implemented. Decoded `PAYMENT-SIGNATURE` is bounded at 8 KiB before parsing (a real payload measured 1056 bytes). Duplicate headers are rejected rather than resolved. |
| **TEST COVERAGE** | Oversized header, duplicated header, non-base64, non-JSON, non-object, prototype-pollution keys. |

## 6. Disposition of the existing v1 code (STEP 2)

| File | Decision | Reason |
| --- | --- | --- |
| `packages/x402/src/constants.ts` | **REPLACE** | v1 constants (`X402_VERSION = 1`, `x-payment`). Superseded by v2 constants. |
| `packages/x402/src/proof.ts` | **REPLACE** | Parses the v1 `X-PAYMENT` payload shape. |
| `packages/x402/src/adapter.ts` | **REPLACE** | Emits v1 `accepts` with `maxAmountRequired` and network slugs. |
| `packages/x402/src/adapter.test.ts` | **REPLACE** | Asserts v1 shapes. Its hostile-input cases are **migrated** — they are protocol-independent and still valuable. |
| `packages/x402/src/index.ts` | **MIGRATE** | Re-export surface updated to v2. |
| `packages/payments/src/test-protocol.ts` | **KEEP, UNCHANGED** | TEST payments are a separate protocol and must keep working. |

The package keeps its name (`@meter402/x402`) and its role: the only place
that knows x402 wire format. Nothing outside it gains an x402 import.

## 7. Payment flow ordering (STEP 29) — resolved from the reference implementation

Not guessed. Extracted from the compiled `@x402/core`:

```js
authorization: { verifyBeforeHandler: true,  settleBeforeHandler: false, settleAfterHandler: true  }
upfront:       { verifyBeforeHandler: false, settleBeforeHandler: true,  settleAfterHandler: false }
escrow:        { verifyBeforeHandler: false, settleBeforeHandler: true,  settleAfterHandler: true  }
```

EVM `exact` defaults to the **`authorization`** flow (EIP-3009), so the
required ordering is:

```
verify  →  merchant handler  →  settle
```

| Point | Meter402 behaviour |
| --- | --- |
| **verification point** | Before the merchant handler runs. Local binding checks first, then facilitator `/verify`. |
| **resource execution point** | Only after verification succeeds. |
| **settlement point** | Only after the handler succeeds. |
| **response point** | `PAYMENT-RESPONSE` header carries the `SettleResponse`. |
| **failure behaviour** | **If the merchant handler fails, settlement never runs and the payer is not charged.** This falls out of the flow phases rather than being a special case we invented (STEP 30). |

## 8. Binding rules (STEPS 18–22) — zero tolerance

Every expectation comes from the stored `PaymentRequest`; none from the client.

| Bound field | Expected source | On mismatch |
| --- | --- | --- |
| `x402Version` | constant `2` | reject |
| `scheme` | constant `exact` | reject |
| `network` | `PaymentRequest.chainId` → CAIP-2 | reject (no substitution) |
| `asset` | trusted `AssetConfig` for that network | reject (defeats lookalike tokens) |
| `amount` / `authorization.value` | `PaymentRequest.amountMinorUnits` | reject — exact equality, no rounding, no tolerance |
| `payTo` / `authorization.to` | `PaymentRequest.recipientAddress` | reject |
| `validBefore` | must not be in the past | reject |
| `validAfter` | must not be in the future | reject |
| `PaymentRequest.expiresAt` | checked independently of the facilitator | reject |

## 9. What closes the x402 release gate

| Condition (STEP 49) | Status after Phase 3 |
| --- | --- |
| Current official v2 spec reviewed | **Done** — `@x402/core@2.24.0`, `@x402/evm@2.24.0` |
| Wire format conforms | **Done** — validated by the official library, not by us |
| Independent client interoperates | **Done** — official client signs against our 402, offline |
| Negative fixtures pass | **Done** |
| Malformed payload tests pass | **Done** |
| Exact scheme behaviour verified | **Done** for binding and flow ordering |
| Replay protection works | **Done** — authorization and transaction, both DB-constrained |
| Independent **facilitator** interoperates | **NOT DONE — network blocked** |
| Base Sepolia E2E succeeds | **NOT DONE — network blocked** |

Two conditions unmet ⇒ **gate stays OPEN**. The safe claim after Phase 3 is
*"x402 v2 wire-conformant against the official reference library, pending
facilitator and testnet verification"* — **not** "x402 v2 compatible", and
certainly not "x402 certified".

## 10. Out of scope, restated

No Solana, no non-Base EVM chains, no additional stablecoins, no `upto` /
`escrow` / batch settlement, no Meter402-owned facilitator, no custom
contracts, no webhook delivery. The webhook **SSRF gate remains OPEN and
untouched** — Phase 3 does not go near merchant-controlled outbound HTTP.

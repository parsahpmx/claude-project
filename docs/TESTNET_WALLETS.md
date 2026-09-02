# Testnet Wallets

Reference for the accounts used in Base Sepolia validation.

> **No private key, seed phrase, or mnemonic appears in this file, and none may
> ever be added to it.** Addresses are public by construction — they are on the
> chain — and are safe to record. Keys are not, and a key committed to a
> repository is compromised from that moment regardless of what the repository's
> access controls say afterwards. See `docs/SECURITY.md`.

## Status

**No funded testnet wallet has been provisioned.** This document defines what
must be recorded when one is, so that the record exists before the wallet does
rather than being reconstructed afterwards.

The reason it has not been provisioned is the same reason the Base Sepolia
end-to-end run has not happened: this environment has no outbound network
access to any Base RPC endpoint or faucet. See
`docs/PHASE_3_5_IMPLEMENTATION_NOTE.md` for the measurement.

## What to record when a wallet is provisioned

| Field | Value |
| --- | --- |
| Payer address | _(to be filled: the agent-side wallet that signs authorizations)_ |
| Recipient address | _(to be filled: the merchant settlement destination)_ |
| Network | Base Sepolia, `eip155:84532` |
| Asset | USDC, `0x036cbd53842c5426634e7929541ec2318f3dcf7e`, 6 decimals |
| Funded with | _(to be filled: testnet ETH for gas, testnet USDC for transfers)_ |
| Faucet used | _(to be filled)_ |

## Where the payer key lives

Not here, and not in the repository.

The payer key is needed only by the **test client** — the process standing in
for a paying agent. Meter402 itself never holds it: the whole point of the x402
exact scheme is that the payer signs an EIP-3009 authorization and the
facilitator submits it, so the server never has custody and never needs
signing material. That property is what makes settlement non-custodial, and it
is worth stating plainly because it is easy to erode by accident.

For a real testnet run, supply the key to the test client through the
environment (`X402_TEST_PAYER_PRIVATE_KEY`), from a secret manager or an
operator's shell, never from a file in the tree.

A key used against a testnet is still a key. Use one generated for this purpose
and nothing else, hold no mainnet value on it, and rotate it if it is ever
pasted anywhere it might be retained — a terminal recording, a CI log, an
issue tracker.

## The key that *is* in the repository

`apps/api/src/test-support/uncertainty.ts` contains a private key constant.
It is the first Hardhat/Anvil development account — a value published in those
projects' documentation, known to everyone, and holding nothing anywhere. It
signs authorizations in offline tests against a fake facilitator, where no
chain is reached and no value exists.

It is committed deliberately, and it is not an exception to the rule above: a
publicly-known development key is a test fixture, not a credential. Never
replace it with a real one, and never fund it.

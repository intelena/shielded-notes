# shielded-notes

Reference model of the Intelena shielded pool: **notes, commitments, nullifiers, an incremental Merkle tree and the spend constraints** — as a dependency-light TypeScript package, a reference Solidity contract and a reference circom circuit that all implement the same [SPEC](./SPEC.md).

> Status: design reference. The Solidity and circom files are **unaudited and not deployable as-is**; the TypeScript model is what wallets, relayers and indexers can test against today.

```
packages/core       @intelena/shielded-notes — TS model (runs in browsers, Workers, Node)
contracts/          ShieldedPool.sol — abstract reference contract
circuits/           spend.circom — reference spend circuit
examples/           transfer.mjs — shield → private transfer → withdraw
SPEC.md             the normative spec
```

## Install

```bash
pnpm add @intelena/shielded-notes     # once published; until then use file:/workspace
```

## 60-second tour

```ts
import { ShieldedPool, NoteWallet, createNote, generateKeyPair } from "@intelena/shielded-notes";

const pool = new ShieldedPool();                 // in-memory twin of the contract
const alice = new NoteWallet(generateKeyPair());
const bob = new NoteWallet(generateKeyPair());

// Shield: only the commitment is public
const note = createNote({ asset: "USDG", amount: 1_000n, ownerPubKey: alice.keys.pubKey });
pool.deposit(note); alice.add(note);

// Private transfer: one nullifier + two fresh commitments hit the chain
const { witness, outputs } = alice.buildSpend(pool, note, { to: { pubKey: bob.keys.pubKey, amount: 400n } });
pool.spend(witness);                             // { ok: true, ... } or { ok: false, reason: "NULLIFIER_SPENT" | ... }

alice.markSpent(note); alice.add(outputs[1]); bob.add(outputs[0]);
alice.balance("USDG"); // 600n — computed locally, never stored on-chain
```

## What's in the box

| Module | Exports |
|---|---|
| `hash` | `hashFields`, `setHasher` (swap SHA-256 for Poseidon), hex/bigint helpers |
| `keys` | `keyPairFromSeed`, `generateKeyPair`, `deriveChildKeyPair` (one seed → many unlinkable identities) |
| `note` | `createNote`, `commitment`, `nullifier`, `sumNotes`, (de)serialize |
| `merkle` | `IncrementalMerkleTree` (depth ≤ 32, append-only, proofs), `verifyProof`, `computeRoot` |
| `pool` | `ShieldedPool` (deposit / spend with root history + nullifier set), `checkSpendWitness` (the circuit's constraints, evaluated in the clear) |
| `wallet` | `NoteWallet` — local note store, balances, `buildSpend()` witness builder |

Every rejection reason (`UNKNOWN_ROOT`, `NULLIFIER_SPENT`, `INVALID_MERKLE_PROOF`, `NOT_OWNER`, `NULLIFIER_MISMATCH`, `ASSET_MISMATCH`, `VALUE_NOT_CONSERVED`, `OUTPUT_COMMITMENT_MISMATCH`, `TOO_MANY_OUTPUTS`) is a typed string, so higher layers can explain failures to users.

## Properties covered by tests

- commitments are hiding (fresh `rho`) and binding (any field change → new commitment)
- nullifiers depend on the spending key and are unlinkable to commitments
- Merkle proofs verify for every leaf and fail on tampered leaf / index / root; tree is append-only and capacity-bounded
- double spend, non-owner spend, value inflation, asset swap and unknown root are rejected
- historical roots (last N) remain spendable; older ones do not

## Related

- [`intelena/association-set`](https://github.com/intelena/association-set) — proof of innocence over deposit commitments
- [`intelena/viewing-keys`](https://github.com/intelena/viewing-keys) — scoped, revocable read access to a user's notes
- [`intelena/leak-score`](https://github.com/intelena/leak-score) — what a route reveals once value leaves the pool

## Develop

```bash
pnpm install && pnpm test && pnpm build && node examples/transfer.mjs
```

MIT © Intelena

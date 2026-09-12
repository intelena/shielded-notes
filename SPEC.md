# Shielded notes — specification v0.1

Normative description of the data structures and checks implemented in `packages/core` (TypeScript model), `contracts/ShieldedPool.sol` (reference contract) and `circuits/spend.circom` (reference circuit). If the three disagree, this document wins.

## 1. Hash

All hashes are `H(domain, fields…)` with a domain string prepended. The reference model uses SHA-256 (`len(domain) ‖ domain ‖ fields`); the circuit uses Poseidon over BN254 with the domain folded into the first input. Every hash below has a fixed arity, so the two are interchangeable at the spec level.

| Domain | Arity | Use |
|---|---|---|
| `intelena/note` | 4 | note commitment |
| `intelena/nullifier` | 2 | nullifier |
| `intelena/pubkey` | 1 | owner public key |
| `intelena/merkle` | 2 | tree node |
| `intelena/zero-leaf` | 1 | empty leaf |
| `intelena/spending-key`, `intelena/child-key` | 1, 3 | key derivation |

## 2. Notes

A note is `(asset, amount, ownerPubKey, rho)`.

- `asset` — lower-cased asset identifier (token address, or `ETH`).
- `amount` — unsigned, ≤ 2¹²⁸ − 1 in circuits.
- `ownerPubKey = H(pubkey, spendingKey)`.
- `rho` — 32 random bytes chosen by the note creator. Fresh per note.

`commitment(note) = H(note, asset, amount, ownerPubKey, rho)`.
Hiding follows from `rho`; binding from the hash. The commitment is the **only** note data ever published.

`nullifier(note, spendingKey) = H(nullifier, rho, spendingKey)`.
Deterministic (a note has exactly one nullifier) and unlinkable to the commitment without `spendingKey`.

## 3. Tree

Append-only incremental Merkle tree, depth 20 (≈1M notes), zero leaf `H(zero-leaf, "intelena")`, zero node at level *i* = `H(merkle, zero[i−1], zero[i−1])`. Node = `H(merkle, left, right)` — order matters. The contract keeps the last 32 roots; a spend may reference any of them, so proofs survive concurrent inserts.

## 4. Deposit

`deposit(commitment, amount)`: value enters, commitment is inserted, `Deposit(commitment, index, amount)` is emitted. `amount` is public; the note owner is not.

## 5. Spend

Public inputs: `root, nullifier, outputCommitments[≤4], asset, publicAmount`.
Private inputs: `note, spendingKey, merklePath, outputs[]`.

Contract checks:
1. `root` is one of the last 32 roots — else `UNKNOWN_ROOT`.
2. `nullifier` not seen — else `NULLIFIER_SPENT`.
3. `|outputCommitments| ≤ 4` — else `TOO_MANY_OUTPUTS`.
4. proof verifies.

Circuit constraints (in the order the TS model reports them):
1. `commitment(note)` is at `merklePath.index` under `root` — `INVALID_MERKLE_PROOF`.
2. `H(pubkey, spendingKey) = note.ownerPubKey` — `NOT_OWNER`.
3. `H(nullifier, note.rho, spendingKey) = nullifier` — `NULLIFIER_MISMATCH`.
4. every output has `asset = note.asset` and `commitment(output_i) = outputCommitments[i]` — `ASSET_MISMATCH` / `OUTPUT_COMMITMENT_MISMATCH`.
5. `note.amount = Σ output.amount + publicAmount` — `VALUE_NOT_CONSERVED`.

Effects: nullifier recorded, output commitments inserted, `publicAmount` sent to the recipient, `Spend(...)` emitted.

## 6. What an observer learns

Per deposit: asset, amount, depositor address, one commitment.
Per spend: one nullifier, ≤4 commitments, `publicAmount` (0 for internal transfers), recipient (withdrawals only).
Not learned: which commitment was spent, how a note was split, who owns any commitment, any user's balance.

## 7. Out of scope here

Encryption of notes for the owner and auditors (`viewing-keys` repo), proof of innocence over deposit commitments (`association-set` repo), relayer fee notes, multi-input spends (join). Multi-input spends extend §5 with one nullifier + one membership proof per input and `Σ inputs = Σ outputs + publicAmount`.

import { commitment, nullifier as deriveNullifier } from "./note.js";
import { pubKeyFromSpendingKey } from "./keys.js";
import { DEFAULT_ROOT_HISTORY, DEFAULT_TREE_DEPTH, IncrementalMerkleTree, verifyProof } from "./merkle.js";
import type { AssetId, Hex32, Note, SpendRejection, SpendResult, SpendWitness } from "./types.js";

export const MAX_OUTPUTS = 4;

export interface PoolOptions {
  depth?: number;
  rootHistory?: number;
}

export interface PoolEvent {
  type: "deposit" | "spend";
  asset: AssetId;
  commitments: Hex32[];
  nullifier?: Hex32;
  publicAmount: bigint;
  root: Hex32;
}

/**
 * In-memory twin of `contracts/ShieldedPool.sol`. It enforces exactly the
 * checks the contract + spend circuit enforce, so wallets, relayers and
 * indexers can be tested against it without a chain.
 *
 * What it does NOT do: verify a SNARK. `checkSpendWitness` evaluates the
 * circuit's constraints directly on the private witness — a stand-in for the
 * proof. In production the contract only ever sees `witness.public`.
 */
export class ShieldedPool {
  readonly tree: IncrementalMerkleTree;
  private readonly rootHistory: number;
  private readonly roots: Hex32[] = [];
  private readonly nullifiers = new Set<Hex32>();
  private readonly balances = new Map<AssetId, bigint>();
  readonly events: PoolEvent[] = [];

  constructor(options: PoolOptions = {}) {
    this.tree = new IncrementalMerkleTree(options.depth ?? DEFAULT_TREE_DEPTH);
    this.rootHistory = options.rootHistory ?? DEFAULT_ROOT_HISTORY;
    this.roots.push(this.tree.root);
  }

  get root(): Hex32 {
    return this.tree.root;
  }

  isKnownRoot(root: Hex32): boolean {
    return this.roots.includes(root);
  }

  isSpent(nullifier: Hex32): boolean {
    return this.nullifiers.has(nullifier);
  }

  /** Total value the contract holds per asset (public information). */
  totalDeposited(asset: AssetId): bigint {
    return this.balances.get(asset) ?? 0n;
  }

  private recordRoot(): void {
    this.roots.push(this.tree.root);
    while (this.roots.length > this.rootHistory) this.roots.shift();
  }

  /** `deposit(asset, amount, commitment)` — value enters, one commitment is inserted. */
  deposit(note: Note): { index: number; commitment: Hex32 } {
    if (note.amount <= 0n) throw new RangeError("deposit amount must be positive");
    const c = commitment(note);
    const index = this.tree.insert(c);
    this.balances.set(note.asset, this.totalDeposited(note.asset) + note.amount);
    this.recordRoot();
    this.events.push({ type: "deposit", asset: note.asset, commitments: [c], publicAmount: note.amount, root: this.root });
    return { index, commitment: c };
  }

  /**
   * `spend(proof, publicInputs)` — the contract-side checks on public inputs
   * plus (in this model) the circuit constraints on the private witness.
   */
  spend(witness: SpendWitness): SpendResult {
    const pub = witness.public;
    if (!this.isKnownRoot(pub.root)) return { ok: false, reason: "UNKNOWN_ROOT" };
    if (this.nullifiers.has(pub.nullifier)) return { ok: false, reason: "NULLIFIER_SPENT" };
    if (pub.outputCommitments.length > MAX_OUTPUTS) return { ok: false, reason: "TOO_MANY_OUTPUTS" };

    const circuit = checkSpendWitness(witness);
    if (circuit !== null) return { ok: false, reason: circuit };

    // Effects
    this.nullifiers.add(pub.nullifier);
    for (const c of pub.outputCommitments) this.tree.insert(c);
    if (pub.publicAmount > 0n) {
      this.balances.set(pub.asset, this.totalDeposited(pub.asset) - pub.publicAmount);
    }
    this.recordRoot();
    this.events.push({
      type: "spend",
      asset: pub.asset,
      commitments: pub.outputCommitments,
      nullifier: pub.nullifier,
      publicAmount: pub.publicAmount,
      root: this.root,
    });
    return { ok: true, nullifier: pub.nullifier, insertedCommitments: pub.outputCommitments, newRoot: this.root };
  }
}

/**
 * The constraints of `circuits/spend.circom`, evaluated in the clear.
 * Returns `null` when every constraint holds, otherwise the first violated one.
 */
export function checkSpendWitness(witness: SpendWitness): SpendRejection | null {
  const { public: pub, private: priv } = witness;
  const { note, spendingKey, merkleProof, outputs } = priv;

  // 1. The note's commitment sits in the tree at the claimed root.
  if (merkleProof.leaf !== commitment(note)) return "INVALID_MERKLE_PROOF";
  if (merkleProof.root !== pub.root || !verifyProof(merkleProof)) return "INVALID_MERKLE_PROOF";

  // 2. The prover knows the spending key behind the note's owner key.
  if (pubKeyFromSpendingKey(spendingKey) !== note.ownerPubKey) return "NOT_OWNER";

  // 3. The published nullifier is derived from this note + key.
  if (deriveNullifier(note, spendingKey) !== pub.nullifier) return "NULLIFIER_MISMATCH";

  // 4. Every output is in the same asset and commitments match.
  if (outputs.length !== pub.outputCommitments.length) return "OUTPUT_COMMITMENT_MISMATCH";
  if (note.asset !== pub.asset) return "ASSET_MISMATCH";
  for (let i = 0; i < outputs.length; i++) {
    const out = outputs[i]!;
    if (out.asset !== note.asset) return "ASSET_MISMATCH";
    if (commitment(out) !== pub.outputCommitments[i]) return "OUTPUT_COMMITMENT_MISMATCH";
  }

  // 5. Value in == value out (+ what leaves the pool publicly).
  const outSum = outputs.reduce((acc, o) => acc + o.amount, 0n);
  if (pub.publicAmount < 0n || note.amount !== outSum + pub.publicAmount) return "VALUE_NOT_CONSERVED";

  return null;
}

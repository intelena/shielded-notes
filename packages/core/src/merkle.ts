import { fromHex, hashFields, stringToBytes } from "./hash.js";
import type { Hex32, MerkleProof } from "./types.js";

export const DEFAULT_TREE_DEPTH = 20;
/** Number of historical roots the pool accepts (proofs built against a slightly stale tree stay valid). */
export const DEFAULT_ROOT_HISTORY = 32;

function hashPair(left: Hex32, right: Hex32): Hex32 {
  return hashFields("intelena/merkle", [fromHex(left), fromHex(right)]);
}

/**
 * Append-only Merkle tree with fixed depth, identical to the on-chain
 * `IncrementalMerkleTree` in `contracts/`. Only the frontier (one node per
 * level) is kept for insertion; full leaves are kept so proofs can be built.
 */
export class IncrementalMerkleTree {
  readonly depth: number;
  private readonly zeros: Hex32[];
  private readonly leaves: Hex32[] = [];
  /** Cached levels for proof generation; level 0 = leaves. */
  private readonly levels: Hex32[][];

  constructor(depth = DEFAULT_TREE_DEPTH) {
    if (!Number.isInteger(depth) || depth < 1 || depth > 32) throw new RangeError("depth must be 1..32");
    this.depth = depth;
    this.zeros = [hashFields("intelena/zero-leaf", [stringToBytes("intelena")])];
    for (let i = 1; i <= depth; i++) {
      const prev = this.zeros[i - 1]!;
      this.zeros.push(hashPair(prev, prev));
    }
    this.levels = Array.from({ length: depth + 1 }, () => []);
  }

  get size(): number {
    return this.leaves.length;
  }

  get capacity(): number {
    return 2 ** this.depth;
  }

  get root(): Hex32 {
    return this.node(this.depth, 0);
  }

  zeroValue(level: number): Hex32 {
    const z = this.zeros[level];
    if (z === undefined) throw new RangeError("level out of range");
    return z;
  }

  private node(level: number, index: number): Hex32 {
    return this.levels[level]?.[index] ?? this.zeroValue(level);
  }

  /** Insert a leaf; returns its index. Cost O(depth). */
  insert(leaf: Hex32): number {
    if (this.leaves.length >= this.capacity) throw new Error("tree is full");
    const index = this.leaves.length;
    this.leaves.push(leaf);
    let current = leaf;
    let i = index;
    for (let level = 0; level < this.depth; level++) {
      this.levels[level]![i] = current;
      const siblingIndex = i % 2 === 0 ? i + 1 : i - 1;
      const sibling = this.node(level, siblingIndex);
      current = i % 2 === 0 ? hashPair(current, sibling) : hashPair(sibling, current);
      i = Math.floor(i / 2);
    }
    this.levels[this.depth]![0] = current;
    return index;
  }

  insertMany(leaves: Hex32[]): number[] {
    return leaves.map((l) => this.insert(l));
  }

  leafAt(index: number): Hex32 | undefined {
    return this.leaves[index];
  }

  indexOf(leaf: Hex32): number {
    return this.leaves.indexOf(leaf);
  }

  proof(index: number): MerkleProof {
    const leaf = this.leaves[index];
    if (leaf === undefined) throw new RangeError("no leaf at index");
    const siblings: Hex32[] = [];
    let i = index;
    for (let level = 0; level < this.depth; level++) {
      siblings.push(this.node(level, i % 2 === 0 ? i + 1 : i - 1));
      i = Math.floor(i / 2);
    }
    return { leaf, index, siblings, root: this.root };
  }
}

/** Recompute the root from a proof — what the circuit does with the private path. */
export function computeRoot(proof: Omit<MerkleProof, "root">): Hex32 {
  let current = proof.leaf;
  let i = proof.index;
  for (const sibling of proof.siblings) {
    current = i % 2 === 0 ? hashPair(current, sibling) : hashPair(sibling, current);
    i = Math.floor(i / 2);
  }
  return current;
}

export function verifyProof(proof: MerkleProof): boolean {
  return computeRoot(proof) === proof.root;
}

/** 32-byte value encoded as 0x-prefixed lowercase hex (66 chars). */
export type Hex32 = `0x${string}`;

/** Asset identifier — an ERC-20 address, or "ETH" for the native asset. */
export type AssetId = string;

/**
 * A note is the unit of ownership inside the shielded pool.
 * Only its commitment is ever published; the note itself stays with the owner.
 */
export interface Note {
  asset: AssetId;
  /** Amount in the asset's smallest unit. */
  amount: bigint;
  /** Owner's public key (= hash of the spending key). */
  ownerPubKey: Hex32;
  /** Per-note randomness (blinding). Makes equal notes unlinkable. */
  rho: Hex32;
}

/** Keys held locally by a pool user. */
export interface KeyPair {
  /** Secret. Needed to spend. */
  spendingKey: Hex32;
  /** Public. Goes into note commitments. */
  pubKey: Hex32;
}

export interface MerkleProof {
  leaf: Hex32;
  /** Index of the leaf in the tree. */
  index: number;
  /** Sibling hashes from leaf level up to (but excluding) the root. */
  siblings: Hex32[];
  root: Hex32;
}

/**
 * Everything the spend circuit sees. Public inputs are what the contract checks;
 * private inputs are known only to the prover.
 */
export interface SpendWitness {
  public: {
    root: Hex32;
    nullifier: Hex32;
    /** Commitments of the newly created output notes. */
    outputCommitments: Hex32[];
    asset: AssetId;
    /** Value leaving the pool (withdrawal) — 0 for an internal transfer. */
    publicAmount: bigint;
  };
  private: {
    note: Note;
    spendingKey: Hex32;
    merkleProof: MerkleProof;
    outputs: Note[];
  };
}

export type SpendRejection =
  | "UNKNOWN_ROOT"
  | "NULLIFIER_SPENT"
  | "INVALID_MERKLE_PROOF"
  | "NOT_OWNER"
  | "NULLIFIER_MISMATCH"
  | "ASSET_MISMATCH"
  | "VALUE_NOT_CONSERVED"
  | "OUTPUT_COMMITMENT_MISMATCH"
  | "TOO_MANY_OUTPUTS";

export type SpendResult =
  | { ok: true; nullifier: Hex32; insertedCommitments: Hex32[]; newRoot: Hex32 }
  | { ok: false; reason: SpendRejection };

import { commitment, createNote, nullifier as deriveNullifier, sumNotes } from "./note.js";
import type { ShieldedPool } from "./pool.js";
import type { AssetId, Hex32, KeyPair, Note, SpendWitness } from "./types.js";

/**
 * Minimal client-side note store: tracks unspent notes for one key pair and
 * builds spend witnesses against a pool (or any object exposing the tree).
 * Balances never leave the device — `balance()` sums local notes.
 */
export class NoteWallet {
  readonly keys: KeyPair;
  private readonly notes = new Map<Hex32, Note>(); // by commitment

  constructor(keys: KeyPair) {
    this.keys = keys;
  }

  add(note: Note): Hex32 {
    if (note.ownerPubKey !== this.keys.pubKey) throw new Error("note is not owned by this wallet");
    const c = commitment(note);
    this.notes.set(c, note);
    return c;
  }

  unspent(asset?: AssetId): Note[] {
    return [...this.notes.values()].filter((n) => asset === undefined || n.asset === asset);
  }

  balance(asset: AssetId): bigint {
    return sumNotes(this.notes.values(), asset);
  }

  /** Mark a note as spent (after the pool accepted its nullifier). */
  markSpent(note: Note): void {
    this.notes.delete(commitment(note));
  }

  /**
   * Build a witness that spends `note`, sending `amount` to `recipientPubKey`,
   * returning change to self and optionally withdrawing `publicAmount`.
   */
  buildSpend(
    pool: ShieldedPool,
    note: Note,
    params: { to?: { pubKey: Hex32; amount: bigint }; publicAmount?: bigint },
  ): { witness: SpendWitness; outputs: Note[] } {
    const c = commitment(note);
    if (!this.notes.has(c)) throw new Error("unknown note");
    const index = pool.tree.indexOf(c);
    if (index < 0) throw new Error("note commitment not found in pool");

    const publicAmount = params.publicAmount ?? 0n;
    const sendAmount = params.to?.amount ?? 0n;
    const change = note.amount - sendAmount - publicAmount;
    if (change < 0n) throw new RangeError("insufficient note value");

    const outputs: Note[] = [];
    if (params.to && sendAmount > 0n) {
      outputs.push(createNote({ asset: note.asset, amount: sendAmount, ownerPubKey: params.to.pubKey }));
    }
    if (change > 0n) {
      outputs.push(createNote({ asset: note.asset, amount: change, ownerPubKey: this.keys.pubKey }));
    }

    const merkleProof = pool.tree.proof(index);
    const witness: SpendWitness = {
      public: {
        root: merkleProof.root,
        nullifier: deriveNullifier(note, this.keys.spendingKey),
        outputCommitments: outputs.map(commitment),
        asset: note.asset,
        publicAmount,
      },
      private: { note, spendingKey: this.keys.spendingKey, merkleProof, outputs },
    };
    return { witness, outputs };
  }
}

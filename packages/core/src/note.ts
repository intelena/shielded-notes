import { bigintToBytes, fromHex, hashFields, isHex32, randomHex32, stringToBytes } from "./hash.js";
import type { AssetId, Hex32, Note } from "./types.js";

export interface CreateNoteInput {
  asset: AssetId;
  amount: bigint;
  ownerPubKey: Hex32;
  /** Optional fixed randomness (tests). Defaults to fresh random bytes. */
  rho?: Hex32;
}

export function createNote(input: CreateNoteInput): Note {
  if (input.amount < 0n) throw new RangeError("amount must be non-negative");
  if (!isHex32(input.ownerPubKey)) throw new TypeError("ownerPubKey must be 32-byte hex");
  if (input.rho !== undefined && !isHex32(input.rho)) throw new TypeError("rho must be 32-byte hex");
  return {
    asset: input.asset,
    amount: input.amount,
    ownerPubKey: input.ownerPubKey,
    rho: input.rho ?? randomHex32(),
  };
}

/**
 * commitment = H("note", asset, amount, ownerPubKey, rho)
 * Hiding (rho is random) and binding (hash) — this is the only thing stored on-chain.
 */
export function commitment(note: Note): Hex32 {
  return hashFields("intelena/note", [
    stringToBytes(note.asset.toLowerCase()),
    bigintToBytes(note.amount),
    fromHex(note.ownerPubKey),
    fromHex(note.rho),
  ]);
}

/**
 * nullifier = H("nullifier", rho, spendingKey)
 * Deterministic per note + owner, so a note can be spent once; unlinkable to the
 * commitment without the spending key.
 */
export function nullifier(note: Note, spendingKey: Hex32): Hex32 {
  return hashFields("intelena/nullifier", [fromHex(note.rho), fromHex(spendingKey)]);
}

/** Total value of a set of notes for one asset — the client-side "balance". */
export function sumNotes(notes: Iterable<Note>, asset?: AssetId): bigint {
  let total = 0n;
  for (const n of notes) if (asset === undefined || n.asset === asset) total += n.amount;
  return total;
}

/** Stable JSON encoding (bigint as decimal string) for storage. */
export function serializeNote(note: Note): string {
  return JSON.stringify({ ...note, amount: note.amount.toString() });
}

export function deserializeNote(json: string): Note {
  const raw = JSON.parse(json) as { asset: string; amount: string; ownerPubKey: string; rho: string };
  if (!isHex32(raw.ownerPubKey) || !isHex32(raw.rho)) throw new TypeError("invalid note");
  return { asset: raw.asset, amount: BigInt(raw.amount), ownerPubKey: raw.ownerPubKey, rho: raw.rho };
}

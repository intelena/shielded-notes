import { describe, expect, it } from "vitest";
import {
  commitment, createNote, deriveChildKeyPair, deserializeNote, generateKeyPair, keyPairFromSeed,
  nullifier, serializeNote, sumNotes,
} from "../src/index.js";

const seed = `0x${"11".repeat(32)}` as const;

describe("keys", () => {
  it("derives deterministically from a seed", () => {
    expect(keyPairFromSeed(seed)).toEqual(keyPairFromSeed(seed));
    expect(keyPairFromSeed(seed).pubKey).not.toBe(keyPairFromSeed(seed).spendingKey);
  });
  it("child keys are unlinkable and distinct per index", () => {
    const root = keyPairFromSeed(seed);
    const a = deriveChildKeyPair(root, 0);
    const b = deriveChildKeyPair(root, 1);
    expect(a.pubKey).not.toBe(b.pubKey);
    expect(a.pubKey).not.toBe(root.pubKey);
    expect(() => deriveChildKeyPair(root, -1)).toThrow();
  });
});

describe("notes", () => {
  const keys = generateKeyPair();
  it("commitments are hiding: same (asset, amount, owner) with different rho differ", () => {
    const a = createNote({ asset: "ETH", amount: 10n, ownerPubKey: keys.pubKey });
    const b = createNote({ asset: "ETH", amount: 10n, ownerPubKey: keys.pubKey });
    expect(commitment(a)).not.toBe(commitment(b));
  });
  it("commitments are binding: any field change changes the commitment", () => {
    const n = createNote({ asset: "ETH", amount: 10n, ownerPubKey: keys.pubKey });
    expect(commitment({ ...n, amount: 11n })).not.toBe(commitment(n));
    expect(commitment({ ...n, asset: "USDG" })).not.toBe(commitment(n));
  });
  it("nullifier depends on the spending key and is unlinkable to the commitment", () => {
    const n = createNote({ asset: "ETH", amount: 10n, ownerPubKey: keys.pubKey });
    const other = generateKeyPair();
    expect(nullifier(n, keys.spendingKey)).not.toBe(nullifier(n, other.spendingKey));
    expect(nullifier(n, keys.spendingKey)).not.toBe(commitment(n));
  });
  it("rejects invalid inputs", () => {
    expect(() => createNote({ asset: "ETH", amount: -1n, ownerPubKey: keys.pubKey })).toThrow();
    expect(() => createNote({ asset: "ETH", amount: 1n, ownerPubKey: "0x12" as never })).toThrow();
  });
  it("sums balances per asset and round-trips serialization", () => {
    const notes = [
      createNote({ asset: "ETH", amount: 3n, ownerPubKey: keys.pubKey }),
      createNote({ asset: "ETH", amount: 4n, ownerPubKey: keys.pubKey }),
      createNote({ asset: "USDG", amount: 100n, ownerPubKey: keys.pubKey }),
    ];
    expect(sumNotes(notes, "ETH")).toBe(7n);
    expect(sumNotes(notes)).toBe(107n);
    const back = deserializeNote(serializeNote(notes[0]!));
    expect(commitment(back)).toBe(commitment(notes[0]!));
  });
});

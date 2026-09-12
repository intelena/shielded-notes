import { describe, expect, it } from "vitest";
import {
  ShieldedPool, NoteWallet, createNote, commitment, generateKeyPair, checkSpendWitness,
  type SpendWitness,
} from "../src/index.js";

function setup() {
  const pool = new ShieldedPool({ depth: 8, rootHistory: 4 });
  const alice = new NoteWallet(generateKeyPair());
  const bob = new NoteWallet(generateKeyPair());
  const note = createNote({ asset: "USDG", amount: 1_000n, ownerPubKey: alice.keys.pubKey });
  pool.deposit(note);
  alice.add(note);
  return { pool, alice, bob, note };
}

describe("ShieldedPool", () => {
  it("deposit inserts a commitment and tracks the public total", () => {
    const { pool, note } = setup();
    expect(pool.tree.indexOf(commitment(note))).toBe(0);
    expect(pool.totalDeposited("USDG")).toBe(1_000n);
    expect(pool.events[0]?.type).toBe("deposit");
  });

  it("internal transfer: value conserved, nothing leaves the pool, nullifier recorded", () => {
    const { pool, alice, bob, note } = setup();
    const { witness, outputs } = alice.buildSpend(pool, note, { to: { pubKey: bob.keys.pubKey, amount: 400n } });
    const res = pool.spend(witness);
    expect(res.ok).toBe(true);
    expect(pool.isSpent(witness.public.nullifier)).toBe(true);
    expect(pool.totalDeposited("USDG")).toBe(1_000n);
    expect(outputs.map((o) => o.amount)).toEqual([400n, 600n]);
    for (const o of outputs) expect(pool.tree.indexOf(commitment(o))).toBeGreaterThan(0);
    alice.markSpent(note);
    alice.add(outputs[1]!);
    bob.add(outputs[0]!);
    expect(alice.balance("USDG")).toBe(600n);
    expect(bob.balance("USDG")).toBe(400n);
  });

  it("withdrawal reduces the public total", () => {
    const { pool, alice, note } = setup();
    const { witness } = alice.buildSpend(pool, note, { publicAmount: 250n });
    expect(pool.spend(witness).ok).toBe(true);
    expect(pool.totalDeposited("USDG")).toBe(750n);
  });

  it("rejects double spends", () => {
    const { pool, alice, note } = setup();
    const { witness } = alice.buildSpend(pool, note, { publicAmount: 1n });
    expect(pool.spend(witness).ok).toBe(true);
    // Replay with a root that is still in history
    const replay: SpendWitness = { ...witness, public: { ...witness.public, root: witness.public.root } };
    expect(pool.spend(replay)).toEqual({ ok: false, reason: "NULLIFIER_SPENT" });
  });

  it("rejects spends by a non-owner", () => {
    const { pool, alice, bob, note } = setup();
    const { witness } = alice.buildSpend(pool, note, { publicAmount: 10n });
    const forged: SpendWitness = {
      ...witness,
      private: { ...witness.private, spendingKey: bob.keys.spendingKey },
    };
    expect(checkSpendWitness(forged)).toBe("NOT_OWNER");
  });

  it("rejects value inflation and asset swaps", () => {
    const { pool, alice, note } = setup();
    const { witness } = alice.buildSpend(pool, note, { publicAmount: 10n });
    const inflated: SpendWitness = { ...witness, public: { ...witness.public, publicAmount: 11n } };
    expect(pool.spend(inflated)).toEqual({ ok: false, reason: "VALUE_NOT_CONSERVED" });
    const swapped: SpendWitness = { ...witness, public: { ...witness.public, asset: "ETH" } };
    expect(pool.spend(swapped)).toEqual({ ok: false, reason: "ASSET_MISMATCH" });
  });

  it("rejects unknown roots but accepts recent historical roots", () => {
    const { pool, alice, note } = setup();
    const { witness } = alice.buildSpend(pool, note, { publicAmount: 10n });
    // Two more deposits move the root; history of 4 still contains the old one.
    const other = generateKeyPair();
    pool.deposit(createNote({ asset: "USDG", amount: 1n, ownerPubKey: other.pubKey }));
    pool.deposit(createNote({ asset: "USDG", amount: 1n, ownerPubKey: other.pubKey }));
    expect(pool.spend(witness).ok).toBe(true);

    const fresh = createNote({ asset: "USDG", amount: 5n, ownerPubKey: alice.keys.pubKey });
    pool.deposit(fresh);
    alice.add(fresh);
    const stale = alice.buildSpend(pool, fresh, { publicAmount: 5n });
    for (let i = 0; i < 5; i++) pool.deposit(createNote({ asset: "USDG", amount: 1n, ownerPubKey: other.pubKey }));
    expect(pool.spend(stale.witness)).toEqual({ ok: false, reason: "UNKNOWN_ROOT" });
  });

  it("wallet refuses to overspend a note", () => {
    const { pool, alice, bob, note } = setup();
    expect(() => alice.buildSpend(pool, note, { to: { pubKey: bob.keys.pubKey, amount: 2_000n } })).toThrow(/insufficient/);
  });
});

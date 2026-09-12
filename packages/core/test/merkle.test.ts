import { describe, expect, it } from "vitest";
import { IncrementalMerkleTree, computeRoot, verifyProof, randomHex32 } from "../src/index.js";

describe("IncrementalMerkleTree", () => {
  it("empty trees of the same depth share a root; depth changes the root", () => {
    expect(new IncrementalMerkleTree(8).root).toBe(new IncrementalMerkleTree(8).root);
    expect(new IncrementalMerkleTree(8).root).not.toBe(new IncrementalMerkleTree(9).root);
  });
  it("produces verifiable proofs for every leaf", () => {
    const tree = new IncrementalMerkleTree(6);
    const leaves = Array.from({ length: 13 }, () => randomHex32());
    tree.insertMany(leaves);
    for (let i = 0; i < leaves.length; i++) {
      const p = tree.proof(i);
      expect(p.leaf).toBe(leaves[i]);
      expect(p.siblings).toHaveLength(6);
      expect(verifyProof(p)).toBe(true);
    }
  });
  it("proofs fail against a tampered leaf, index or root", () => {
    const tree = new IncrementalMerkleTree(5);
    tree.insertMany([randomHex32(), randomHex32(), randomHex32()]);
    const p = tree.proof(1);
    expect(verifyProof({ ...p, leaf: randomHex32() })).toBe(false);
    expect(verifyProof({ ...p, index: 2 })).toBe(false);
    expect(computeRoot({ leaf: p.leaf, index: p.index, siblings: p.siblings })).toBe(p.root);
    tree.insert(randomHex32());
    expect(verifyProof(p)).toBe(true); // still self-consistent…
    expect(p.root).not.toBe(tree.root); // …but against a root the tree has moved past
  });
  it("is append-only and bounded by capacity", () => {
    const tree = new IncrementalMerkleTree(2);
    tree.insertMany([randomHex32(), randomHex32(), randomHex32(), randomHex32()]);
    expect(tree.size).toBe(4);
    expect(() => tree.insert(randomHex32())).toThrow(/full/);
  });
  it("root is order-dependent", () => {
    const a = new IncrementalMerkleTree(4);
    const b = new IncrementalMerkleTree(4);
    const [x, y] = [randomHex32(), randomHex32()];
    a.insertMany([x, y]);
    b.insertMany([y, x]);
    expect(a.root).not.toBe(b.root);
  });
});

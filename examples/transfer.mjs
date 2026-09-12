// Shield → private transfer → withdraw, entirely in memory.
// Run: pnpm build && node examples/transfer.mjs
import { ShieldedPool, NoteWallet, createNote, generateKeyPair } from "@intelena/shielded-notes";

const pool = new ShieldedPool();
const alice = new NoteWallet(generateKeyPair());
const bob = new NoteWallet(generateKeyPair());

// 1. Alice shields 1,000 USDG. Only the commitment hits the chain.
const deposit = createNote({ asset: "USDG", amount: 1_000n, ownerPubKey: alice.keys.pubKey });
pool.deposit(deposit);
alice.add(deposit);
console.log("on-chain sees commitment:", pool.tree.leafAt(0));

// 2. Alice pays Bob 400 privately. On-chain: one nullifier + two fresh commitments.
const t = alice.buildSpend(pool, deposit, { to: { pubKey: bob.keys.pubKey, amount: 400n } });
console.log("transfer:", pool.spend(t.witness));
alice.markSpent(deposit);
alice.add(t.outputs[1]);
bob.add(t.outputs[0]);
console.log("alice balance (local):", alice.balance("USDG"), "bob:", bob.balance("USDG"));

// 3. Bob withdraws 150 to a fresh address. Public total drops; sender stays hidden.
const w = bob.buildSpend(pool, t.outputs[0], { publicAmount: 150n });
console.log("withdraw:", pool.spend(w.witness));
console.log("pool total USDG:", pool.totalDeposited("USDG"));

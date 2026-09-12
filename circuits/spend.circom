pragma circom 2.1.6;

// spend.circom — reference (UNAUDITED). Constraints mirror
// `checkSpendWitness()` in packages/core/src/pool.ts, one to one.
//
// Hash placeholder: the TS model uses domain-separated SHA-256 so it runs
// anywhere; the circuit is written against Poseidon. Both are pluggable —
// only the *shape* of each hash is normative (see SPEC.md).

include "circomlib/poseidon.circom";

template MerkleInclusion(DEPTH) {
    signal input leaf;
    signal input index;            // leaf index, decomposed into path bits
    signal input siblings[DEPTH];
    signal output root;

    component bits = Num2Bits(DEPTH);
    bits.in <== index;

    signal cur[DEPTH + 1];
    cur[0] <== leaf;
    component h[DEPTH];
    for (var i = 0; i < DEPTH; i++) {
        h[i] = Poseidon(2);
        // bit = 0 → (cur, sibling); bit = 1 → (sibling, cur)
        h[i].inputs[0] <== cur[i] + bits.out[i] * (siblings[i] - cur[i]);
        h[i].inputs[1] <== siblings[i] + bits.out[i] * (cur[i] - siblings[i]);
        cur[i + 1] <== h[i].out;
    }
    root <== cur[DEPTH];
}

template NoteCommitment() {
    signal input asset;
    signal input amount;
    signal input ownerPubKey;
    signal input rho;
    signal output out;
    component h = Poseidon(4);
    h.inputs[0] <== asset;
    h.inputs[1] <== amount;
    h.inputs[2] <== ownerPubKey;
    h.inputs[3] <== rho;
    out <== h.out;
}

template Spend(DEPTH, MAX_OUT) {
    // ---- public ----
    signal input root;
    signal input nullifier;
    signal input outputCommitments[MAX_OUT]; // unused slots = 0
    signal input asset;
    signal input publicAmount;

    // ---- private ----
    signal input amount;
    signal input ownerPubKey;
    signal input rho;
    signal input spendingKey;
    signal input index;
    signal input siblings[DEPTH];
    signal input outAmount[MAX_OUT];
    signal input outOwner[MAX_OUT];
    signal input outRho[MAX_OUT];

    // 1. Membership: commitment(note) is in the tree at `root`.
    component c = NoteCommitment();
    c.asset <== asset; c.amount <== amount; c.ownerPubKey <== ownerPubKey; c.rho <== rho;
    component m = MerkleInclusion(DEPTH);
    m.leaf <== c.out; m.index <== index;
    for (var i = 0; i < DEPTH; i++) m.siblings[i] <== siblings[i];
    m.root === root;

    // 2. Ownership: ownerPubKey = H(spendingKey).
    component pk = Poseidon(1);
    pk.inputs[0] <== spendingKey;
    pk.out === ownerPubKey;

    // 3. Nullifier: H(rho, spendingKey).
    component nf = Poseidon(2);
    nf.inputs[0] <== rho; nf.inputs[1] <== spendingKey;
    nf.out === nullifier;

    // 4. Outputs: same asset, commitments match (zero slots must be zero-amount).
    component oc[MAX_OUT];
    signal outSum[MAX_OUT + 1];
    outSum[0] <== 0;
    for (var i = 0; i < MAX_OUT; i++) {
        oc[i] = NoteCommitment();
        oc[i].asset <== asset; oc[i].amount <== outAmount[i];
        oc[i].ownerPubKey <== outOwner[i]; oc[i].rho <== outRho[i];
        // either the slot is unused (commitment 0, amount 0) or it matches
        (outputCommitments[i] - oc[i].out) * outputCommitments[i] === 0;
        outAmount[i] * (1 - (outputCommitments[i] != 0)) === 0; // illustrative; use IsZero in practice
        outSum[i + 1] <== outSum[i] + outAmount[i];
    }

    // 5. Value conservation (amounts are range-checked to 128 bits in practice).
    amount === outSum[MAX_OUT] + publicAmount;
}

component main {public [root, nullifier, outputCommitments, asset, publicAmount]} = Spend(20, 4);

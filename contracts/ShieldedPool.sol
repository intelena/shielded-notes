// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title ShieldedPool — reference (UNAUDITED, not for production)
/// @notice Mirrors `packages/core/src/pool.ts`. Holds one ERC-20 (or ETH) and
///         a Merkle tree of note commitments. Value moves by publishing a
///         nullifier plus a zero-knowledge proof of the constraints in
///         `circuits/spend.circom`.
/// @dev    Hash function, verifier and asset handling are left abstract so the
///         contract reads as a spec. See SPEC.md for the checks in prose.
interface ISpendVerifier {
    /// @param publicInputs [root, nullifier, out0, out1, out2, out3, assetHash, publicAmount]
    function verify(bytes calldata proof, uint256[8] calldata publicInputs) external view returns (bool);
}

abstract contract IncrementalMerkleTree {
    uint32 public constant DEPTH = 20;
    uint32 public constant ROOT_HISTORY = 32;

    uint32 public nextIndex;
    bytes32[DEPTH] internal frontier;
    bytes32[ROOT_HISTORY] public roots;
    uint32 public currentRootIndex;

    function hashPair(bytes32 left, bytes32 right) internal pure virtual returns (bytes32);
    function zeroValue(uint32 level) internal pure virtual returns (bytes32);

    function _insert(bytes32 leaf) internal returns (uint32 index) {
        index = nextIndex;
        require(index < uint32(2) ** DEPTH, "tree full");
        bytes32 current = leaf;
        uint32 i = index;
        for (uint32 level = 0; level < DEPTH; level++) {
            if (i % 2 == 0) {
                frontier[level] = current;
                current = hashPair(current, zeroValue(level));
            } else {
                current = hashPair(frontier[level], current);
            }
            i /= 2;
        }
        currentRootIndex = (currentRootIndex + 1) % ROOT_HISTORY;
        roots[currentRootIndex] = current;
        nextIndex = index + 1;
    }

    function isKnownRoot(bytes32 root) public view returns (bool) {
        if (root == bytes32(0)) return false;
        for (uint32 k = 0; k < ROOT_HISTORY; k++) {
            if (roots[k] == root) return true;
        }
        return false;
    }
}

abstract contract ShieldedPool is IncrementalMerkleTree {
    ISpendVerifier public immutable verifier;
    mapping(bytes32 => bool) public nullifiers;

    event Deposit(bytes32 indexed commitment, uint32 index, uint256 amount);
    event Spend(bytes32 indexed nullifier, bytes32[] outputCommitments, uint256 publicAmount, address to);

    constructor(ISpendVerifier _verifier) {
        verifier = _verifier;
    }

    /// @dev Pull `amount` of the pool asset from `msg.sender` (or msg.value for ETH).
    function _receiveAsset(uint256 amount) internal virtual;
    /// @dev Push `amount` of the pool asset to `to`.
    function _sendAsset(address to, uint256 amount) internal virtual;
    function assetHash() public view virtual returns (uint256);

    /// @notice Shield: value enters, one commitment is inserted. The commitment
    ///         is opaque — nobody but the depositor can link it to a later spend.
    function deposit(bytes32 commitment, uint256 amount) external payable {
        require(amount > 0, "amount");
        _receiveAsset(amount);
        uint32 index = _insert(commitment);
        emit Deposit(commitment, index, amount);
    }

    /// @notice Spend one note into up to 4 new notes, optionally withdrawing
    ///         `publicAmount` to `to`. `to` is bound into the proof by the
    ///         relayer-facing wrapper (omitted here) to stop front-running.
    function spend(
        bytes calldata proof,
        bytes32 root,
        bytes32 nullifier,
        bytes32[] calldata outputCommitments,
        uint256 publicAmount,
        address to
    ) external {
        require(isKnownRoot(root), "UNKNOWN_ROOT");
        require(!nullifiers[nullifier], "NULLIFIER_SPENT");
        require(outputCommitments.length <= 4, "TOO_MANY_OUTPUTS");

        uint256[8] memory inputs;
        inputs[0] = uint256(root);
        inputs[1] = uint256(nullifier);
        for (uint256 i = 0; i < outputCommitments.length; i++) inputs[2 + i] = uint256(outputCommitments[i]);
        inputs[6] = assetHash();
        inputs[7] = publicAmount;
        require(verifier.verify(proof, inputs), "INVALID_PROOF");

        nullifiers[nullifier] = true;
        for (uint256 i = 0; i < outputCommitments.length; i++) _insert(outputCommitments[i]);
        if (publicAmount > 0) _sendAsset(to, publicAmount);

        emit Spend(nullifier, outputCommitments, publicAmount, to);
    }
}

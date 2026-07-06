// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

/// @title BteAnchor
/// @notice Onchain anchor for bte reveals: bidders commit ciphertext hashes,
/// the coordinator publishes the reveal's merkle root over
/// (position, payload) leaves. No onchain pairing verification in v0; the
/// root lets anyone check the revealed payload set against what was
/// committed (see bte-sdk verifyAnchor).
contract BteAnchor {
    /// @notice The only address allowed to publish reveal roots.
    address public immutable coordinator;

    /// @notice conditionId => merkle root (zero until revealed).
    mapping(bytes32 => bytes32) public revealRoots;

    event Committed(bytes32 indexed conditionId, bytes32 indexed ctHash, address indexed sender);
    event Revealed(bytes32 indexed conditionId, bytes32 merkleRoot);

    error NotCoordinator();
    error AlreadyRevealed();
    error ZeroRoot();

    constructor(address coordinator_) {
        coordinator = coordinator_;
    }

    /// @notice Anchor a sealed ciphertext to a condition. Open to anyone;
    /// the event is the record.
    function commit(bytes32 conditionId, bytes32 ctHash) external {
        emit Committed(conditionId, ctHash, msg.sender);
    }

    /// @notice Publish the reveal's merkle root. Once per condition.
    function revealRoot(bytes32 conditionId, bytes32 merkleRoot) external {
        if (msg.sender != coordinator) revert NotCoordinator();
        if (merkleRoot == bytes32(0)) revert ZeroRoot();
        if (revealRoots[conditionId] != bytes32(0)) revert AlreadyRevealed();
        revealRoots[conditionId] = merkleRoot;
        emit Revealed(conditionId, merkleRoot);
    }
}

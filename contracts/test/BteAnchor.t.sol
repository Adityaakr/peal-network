// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {BteAnchor} from "../src/BteAnchor.sol";

contract BteAnchorTest is Test {
    BteAnchor anchor;
    address coordinator = address(0xC0FFEE);
    address bidder = address(0xB1D);

    bytes32 constant COND = keccak256("cond_test");
    bytes32 constant CT = keccak256("ciphertext");
    bytes32 constant ROOT = keccak256("root");

    event Committed(bytes32 indexed conditionId, bytes32 indexed ctHash, address indexed sender);
    event Revealed(bytes32 indexed conditionId, bytes32 merkleRoot);

    function setUp() public {
        anchor = new BteAnchor(coordinator);
    }

    function test_commit_open_to_anyone_and_emits() public {
        vm.prank(bidder);
        vm.expectEmit(true, true, true, true);
        emit Committed(COND, CT, bidder);
        anchor.commit(COND, CT);
    }

    function test_revealRoot_stores_and_emits() public {
        vm.prank(coordinator);
        vm.expectEmit(true, false, false, true);
        emit Revealed(COND, ROOT);
        anchor.revealRoot(COND, ROOT);
        assertEq(anchor.revealRoots(COND), ROOT);
    }

    function test_revealRoot_rejects_non_coordinator() public {
        vm.prank(bidder);
        vm.expectRevert(BteAnchor.NotCoordinator.selector);
        anchor.revealRoot(COND, ROOT);
    }

    function test_revealRoot_rejects_double_reveal() public {
        vm.startPrank(coordinator);
        anchor.revealRoot(COND, ROOT);
        vm.expectRevert(BteAnchor.AlreadyRevealed.selector);
        anchor.revealRoot(COND, keccak256("other"));
        vm.stopPrank();
    }

    function test_revealRoot_rejects_zero_root() public {
        vm.prank(coordinator);
        vm.expectRevert(BteAnchor.ZeroRoot.selector);
        anchor.revealRoot(COND, bytes32(0));
    }

    function testFuzz_commit_any_ids(bytes32 conditionId, bytes32 ctHash, address sender) public {
        vm.assume(sender != address(0));
        vm.prank(sender);
        vm.expectEmit(true, true, true, true);
        emit Committed(conditionId, ctHash, sender);
        anchor.commit(conditionId, ctHash);
    }
}

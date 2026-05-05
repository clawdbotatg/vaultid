// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Test } from "forge-std/Test.sol";
import { console } from "forge-std/console.sol";
import { VaultID } from "../contracts/VaultID.sol";
import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";

/// @dev Minimal mintable ERC20 used as both CLAWD and CV in tests.
contract MockERC20 is ERC20 {
    constructor(string memory n, string memory s) ERC20(n, s) { }

    function mint(address to, uint256 amt) external {
        _mint(to, amt);
    }
}

/// @dev ERC20 that always returns false on transferFrom (to test SafeERC20 path).
contract BadERC20 is ERC20 {
    constructor() ERC20("Bad", "BAD") { }

    function transferFrom(address, address, uint256) public pure override returns (bool) {
        return false;
    }
}

contract VaultIDTest is Test {
    VaultID internal vault;
    MockERC20 internal clawd;
    MockERC20 internal cv;

    address internal owner = address(0xA11CE);
    address internal alice = address(0xA1);
    address internal bob = address(0xB0B);
    address internal carol = address(0xCA0);
    address internal aliceBackup = address(0xBA1);
    address internal bobBackup = address(0xBB0);

    bytes4 internal constant ERC5192_ID = 0xb45a3c0e;

    function setUp() public {
        clawd = new MockERC20("CLAWD", "CLAWD");
        cv = new MockERC20("CV", "CV");
        // Deploy with cvToken = address(0) per the new spec.
        vault = new VaultID(owner, address(clawd), address(0));

        clawd.mint(alice, 1_000_000e18);
        clawd.mint(bob, 1_000_000e18);
        cv.mint(alice, 1_000_000e18);
        cv.mint(bob, 1_000_000e18);
    }

    // ---------- Construction ----------

    function test_constructor_revertsOnZeroOwner() public {
        // Ownable's constructor fires first with OwnableInvalidOwner(0).
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableInvalidOwner.selector, address(0)));
        new VaultID(address(0), address(clawd), address(0));
    }

    function test_constructor_revertsOnZeroClawd() public {
        vm.expectRevert(VaultID.ZeroAddress.selector);
        new VaultID(owner, address(0), address(0));
    }

    function test_constructor_allowsZeroCv() public {
        VaultID v2 = new VaultID(owner, address(clawd), address(0));
        assertEq(address(v2.cvToken()), address(0));
        assertEq(address(v2.clawdToken()), address(clawd));
        assertEq(v2.owner(), owner);
        assertEq(v2.feeRecipient(), owner);
    }

    function test_constructor_allowsNonzeroCv() public {
        VaultID v2 = new VaultID(owner, address(clawd), address(cv));
        assertEq(address(v2.cvToken()), address(cv));
    }

    function test_constructor_setsCategoryLabels() public view {
        assertEq(vault.categoryLabel(0), "Personal");
        assertEq(vault.categoryLabel(1), "Business");
        assertEq(vault.categoryLabel(2), "Developer");
        assertEq(vault.categoryLabel(3), "Validator");
        assertEq(vault.categoryLabel(4), "Treasury");
        assertEq(vault.categoryLabel(5), "Community");
    }

    // ---------- mintWithCLAWD ----------

    function test_mintWithCLAWD_happyPath() public {
        vm.prank(alice);
        clawd.approve(address(vault), type(uint256).max);

        uint256 feeBefore = clawd.balanceOf(owner);
        vm.prank(alice);
        uint256 id = vault.mintWithCLAWD(alice, 0, aliceBackup);

        assertEq(id, 1);
        assertEq(vault.ownerOf(1), alice);
        assertEq(vault.totalMinted(), 1);
        assertEq(clawd.balanceOf(owner), feeBefore + 100e18);

        VaultID.Vault memory v = vault.getVault(1);
        assertEq(v.holder, alice);
        assertEq(v.backupWallet, aliceBackup);
        assertEq(v.category, 0);
        assertTrue(v.active);
        assertEq(v.expiresAt, 0);
    }

    function test_mintWithCLAWD_revertsOnZeroTo() public {
        vm.prank(alice);
        clawd.approve(address(vault), type(uint256).max);
        vm.prank(alice);
        vm.expectRevert(VaultID.ZeroAddress.selector);
        vault.mintWithCLAWD(address(0), 0, aliceBackup);
    }

    function test_mintWithCLAWD_revertsOnZeroBackup() public {
        vm.prank(alice);
        clawd.approve(address(vault), type(uint256).max);
        vm.prank(alice);
        vm.expectRevert(VaultID.ZeroAddress.selector);
        vault.mintWithCLAWD(alice, 0, address(0));
    }

    function test_mintWithCLAWD_revertsWhenBackupEqualsHolder() public {
        vm.prank(alice);
        clawd.approve(address(vault), type(uint256).max);
        vm.prank(alice);
        vm.expectRevert(VaultID.ZeroAddress.selector);
        vault.mintWithCLAWD(alice, 0, alice);
    }

    function test_mintWithCLAWD_revertsOnInvalidCategory() public {
        vm.prank(alice);
        clawd.approve(address(vault), type(uint256).max);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(VaultID.InvalidCategory.selector, uint8(6)));
        vault.mintWithCLAWD(alice, 6, aliceBackup);
    }

    function test_mintWithCLAWD_revertsWhenNoApproval() public {
        vm.prank(alice);
        // No approval -> SafeERC20 should bubble a revert.
        vm.expectRevert();
        vault.mintWithCLAWD(alice, 0, aliceBackup);
    }

    function test_mintWithCLAWD_zeroFee_skipsTransfer() public {
        vm.prank(owner);
        vault.setClawdMintFee(0);
        vm.prank(alice);
        // No approval needed when fee is 0
        uint256 id = vault.mintWithCLAWD(alice, 1, aliceBackup);
        assertEq(id, 1);
        assertEq(vault.ownerOf(1), alice);
    }

    function test_mintWithCLAWD_emitsLockedAndMinted() public {
        vm.prank(alice);
        clawd.approve(address(vault), type(uint256).max);

        vm.expectEmit(true, false, false, false, address(vault));
        emit VaultID.Locked(1);
        vm.expectEmit(true, true, true, true, address(vault));
        emit VaultID.VaultMinted(1, alice, aliceBackup, 0, 0, false);

        vm.prank(alice);
        vault.mintWithCLAWD(alice, 0, aliceBackup);
    }

    // ---------- mintWithCV behavior (CV unset / set) ----------

    function test_mintWithCV_revertsWhenCvUnset() public {
        // cv token is unset by default in setUp.
        vm.prank(alice);
        cv.approve(address(vault), type(uint256).max);
        vm.prank(alice);
        vm.expectRevert(VaultID.CvTokenNotSet.selector);
        vault.mintWithCV(alice, 0, aliceBackup);
    }

    function test_mintWithCV_revertsWithCvNotSetBeforeOtherChecks() public {
        // Even with bogus inputs (zero `to`, equal backup), CvTokenNotSet must fire first.
        vm.prank(alice);
        vm.expectRevert(VaultID.CvTokenNotSet.selector);
        vault.mintWithCV(address(0), 6, address(0));
    }

    function test_setCvToken_isOnlyOwner() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        vault.setCvToken(address(cv));
    }

    function test_setCvToken_emitsAndUpdates() public {
        vm.prank(owner);
        vm.expectEmit(false, false, false, true, address(vault));
        emit VaultID.CvTokenUpdated(address(cv));
        vault.setCvToken(address(cv));
        assertEq(address(vault.cvToken()), address(cv));
    }

    function test_setCvToken_canDisableAgain() public {
        vm.prank(owner);
        vault.setCvToken(address(cv));
        vm.prank(owner);
        vault.setCvToken(address(0));
        assertEq(address(vault.cvToken()), address(0));

        // mintWithCV should revert again now.
        vm.prank(alice);
        cv.approve(address(vault), type(uint256).max);
        vm.prank(alice);
        vm.expectRevert(VaultID.CvTokenNotSet.selector);
        vault.mintWithCV(alice, 0, aliceBackup);
    }

    function test_mintWithCV_worksAfterSetCvToken() public {
        vm.prank(owner);
        vault.setCvToken(address(cv));

        vm.prank(alice);
        cv.approve(address(vault), type(uint256).max);

        uint256 ownerCvBefore = cv.balanceOf(owner);
        vm.prank(alice);
        uint256 id = vault.mintWithCV(alice, 2, aliceBackup);
        assertEq(id, 1);
        assertEq(vault.ownerOf(1), alice);
        assertEq(cv.balanceOf(owner), ownerCvBefore + 100e18);

        VaultID.Vault memory v = vault.getVault(1);
        assertEq(v.category, 2);
        assertTrue(v.active);
    }

    // ---------- Soulbound enforcement ----------

    function test_transferFrom_reverts() public {
        _mintAlice(0);
        vm.prank(alice);
        vm.expectRevert(VaultID.Soulbound.selector);
        vault.transferFrom(alice, bob, 1);
    }

    function test_safeTransferFrom_reverts() public {
        _mintAlice(0);
        vm.prank(alice);
        vm.expectRevert(VaultID.Soulbound.selector);
        vault.safeTransferFrom(alice, bob, 1);
    }

    function test_safeTransferFromWithData_reverts() public {
        _mintAlice(0);
        vm.prank(alice);
        vm.expectRevert(VaultID.Soulbound.selector);
        vault.safeTransferFrom(alice, bob, 1, "");
    }

    function test_approve_reverts() public {
        _mintAlice(0);
        vm.prank(alice);
        vm.expectRevert(VaultID.Soulbound.selector);
        vault.approve(bob, 1);
    }

    function test_setApprovalForAll_reverts() public {
        vm.prank(alice);
        vm.expectRevert(VaultID.Soulbound.selector);
        vault.setApprovalForAll(bob, true);
    }

    function test_supportsInterface_erc5192() public view {
        assertTrue(vault.supportsInterface(ERC5192_ID));
        // Standard ERC721 too
        assertTrue(vault.supportsInterface(0x80ac58cd));
        // Random bogus
        assertFalse(vault.supportsInterface(0x12345678));
    }

    function test_locked_returnsTrue() public {
        _mintAlice(0);
        assertTrue(vault.locked(1));
    }

    function test_locked_revertsForUnknownToken() public {
        vm.expectRevert(abi.encodeWithSelector(VaultID.TokenNotFound.selector, uint256(99)));
        vault.locked(99);
    }

    // ---------- Burn (soft) ----------

    function test_burn_byOwner_softBurns() public {
        _mintAlice(0);
        vm.prank(alice);
        vault.burn(1);
        VaultID.Vault memory v = vault.getVault(1);
        assertFalse(v.active);
        // Token still owned by alice (soft burn).
        assertEq(vault.ownerOf(1), alice);
        // isActive view returns false.
        assertFalse(vault.isActive(1));
    }

    function test_burn_byNonOwner_reverts() public {
        _mintAlice(0);
        vm.prank(bob);
        vm.expectRevert(VaultID.NotTokenOwner.selector);
        vault.burn(1);
    }

    function test_burn_alreadyBurned_reverts() public {
        _mintAlice(0);
        vm.prank(alice);
        vault.burn(1);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(VaultID.TokenAlreadyBurned.selector, uint256(1)));
        vault.burn(1);
    }

    function test_burn_unknownToken_reverts() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(VaultID.TokenNotFound.selector, uint256(7)));
        vault.burn(7);
    }

    // ---------- Expiry ----------

    function test_defaultValidity_expiry() public {
        vm.prank(owner);
        vault.setDefaultValidityPeriod(7 days);

        _mintAlice(0);
        VaultID.Vault memory v = vault.getVault(1);
        assertEq(v.expiresAt, uint64(block.timestamp) + 7 days);
        assertFalse(vault.isExpired(1));
        assertTrue(vault.isActive(1));

        vm.warp(v.expiresAt);
        assertTrue(vault.isExpired(1));
        assertFalse(vault.isActive(1));
    }

    function test_extendExpiry_byOwner() public {
        vm.prank(owner);
        vault.setDefaultValidityPeriod(7 days);
        _mintAlice(0);

        uint64 oldExp = vault.getVault(1).expiresAt;
        uint64 newExp = oldExp + uint64(30 days);

        vm.prank(owner);
        vm.expectEmit(true, false, false, true, address(vault));
        emit VaultID.VaultExpiryExtended(1, newExp);
        vault.extendExpiry(1, newExp);

        assertEq(vault.getVault(1).expiresAt, newExp);
    }

    function test_extendExpiry_canSetToNever() public {
        vm.prank(owner);
        vault.setDefaultValidityPeriod(7 days);
        _mintAlice(0);

        vm.prank(owner);
        vault.extendExpiry(1, 0);
        assertEq(vault.getVault(1).expiresAt, 0);
        // Warp far ahead — should still be active.
        vm.warp(block.timestamp + 365 days);
        assertTrue(vault.isActive(1));
    }

    function test_extendExpiry_revertsOnNonIncrease() public {
        vm.prank(owner);
        vault.setDefaultValidityPeriod(7 days);
        _mintAlice(0);
        uint64 oldExp = vault.getVault(1).expiresAt;

        vm.prank(owner);
        vm.expectRevert(VaultID.InvalidExpiryExtension.selector);
        vault.extendExpiry(1, oldExp); // not strictly greater

        vm.prank(owner);
        vm.expectRevert(VaultID.InvalidExpiryExtension.selector);
        vault.extendExpiry(1, oldExp - 1);
    }

    function test_extendExpiry_onlyOwner() public {
        _mintAlice(0);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        vault.extendExpiry(1, uint64(block.timestamp) + 1 days);
    }

    // ---------- Admin setters ----------

    function test_setClawdMintFee_onlyOwner() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        vault.setClawdMintFee(50e18);
        vm.prank(owner);
        vm.expectEmit(false, false, false, true, address(vault));
        emit VaultID.ClawdMintFeeUpdated(50e18);
        vault.setClawdMintFee(50e18);
        assertEq(vault.clawdMintFee(), 50e18);
    }

    function test_setCvMintFee_onlyOwner() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        vault.setCvMintFee(7e18);
        vm.prank(owner);
        vault.setCvMintFee(7e18);
        assertEq(vault.cvMintFee(), 7e18);
    }

    function test_setFeeRecipient_onlyOwnerAndNonZero() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        vault.setFeeRecipient(bob);
        vm.prank(owner);
        vm.expectRevert(VaultID.ZeroAddress.selector);
        vault.setFeeRecipient(address(0));
        vm.prank(owner);
        vault.setFeeRecipient(carol);
        assertEq(vault.feeRecipient(), carol);

        // New mints should pay carol.
        vm.prank(alice);
        clawd.approve(address(vault), type(uint256).max);
        uint256 carolBefore = clawd.balanceOf(carol);
        vm.prank(alice);
        vault.mintWithCLAWD(alice, 0, aliceBackup);
        assertEq(clawd.balanceOf(carol), carolBefore + 100e18);
    }

    function test_setCategoryLabel_onlyOwner_withValidation() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        vault.setCategoryLabel(0, "X");

        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(VaultID.InvalidCategory.selector, uint8(6)));
        vault.setCategoryLabel(6, "X");

        vm.prank(owner);
        vm.expectRevert(VaultID.LabelTooLong.selector);
        vault.setCategoryLabel(0, "this is way too long for a category label and should fail");

        vm.prank(owner);
        vault.setCategoryLabel(0, "Custom");
        assertEq(vault.categoryLabel(0), "Custom");
    }

    // ---------- Token URI / metadata ----------

    function test_tokenURI_returnsBase64Json() public {
        _mintAlice(0);
        string memory uri = vault.tokenURI(1);
        // Must start with the data URI prefix.
        assertEq(_substr(uri, 0, 29), "data:application/json;base64,");
        // Must be non-trivial.
        assertGt(bytes(uri).length, 200);
    }

    function test_tokenURI_revertsForUnknownToken() public {
        vm.expectRevert(abi.encodeWithSelector(VaultID.TokenNotFound.selector, uint256(42)));
        vault.tokenURI(42);
    }

    function test_tokenURI_allCategories() public {
        // Mint one of each category and ensure tokenURI doesn't revert.
        for (uint8 c = 0; c < 6; c++) {
            address holder = address(uint160(uint256(0x1000 + c)));
            address backup = address(uint160(uint256(0x2000 + c)));
            clawd.mint(holder, 1_000e18);
            vm.prank(holder);
            clawd.approve(address(vault), type(uint256).max);
            vm.prank(holder);
            vault.mintWithCLAWD(holder, c, backup);
            string memory uri = vault.tokenURI(c + 1);
            assertGt(bytes(uri).length, 200);
        }
    }

    // ---------- View helpers ----------

    function test_isActive_falseForUnknown() public view {
        assertFalse(vault.isActive(123));
    }

    function test_isExpired_revertsForUnknown() public {
        vm.expectRevert(abi.encodeWithSelector(VaultID.TokenNotFound.selector, uint256(123)));
        vault.isExpired(123);
    }

    function test_getVault_revertsForUnknown() public {
        vm.expectRevert(abi.encodeWithSelector(VaultID.TokenNotFound.selector, uint256(123)));
        vault.getVault(123);
    }

    // ---------- Internal helpers ----------

    function _mintAlice(uint8 cat) internal {
        vm.prank(alice);
        clawd.approve(address(vault), type(uint256).max);
        vm.prank(alice);
        vault.mintWithCLAWD(alice, cat, aliceBackup);
    }

    function _substr(string memory s, uint256 start, uint256 len) internal pure returns (string memory) {
        bytes memory b = bytes(s);
        bytes memory out = new bytes(len);
        for (uint256 i = 0; i < len; i++) {
            out[i] = b[start + i];
        }
        return string(out);
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Test } from "forge-std/Test.sol";
import { console } from "forge-std/console.sol";
import { VaultID } from "../contracts/VaultID.sol";
import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { Ownable2Step } from "@openzeppelin/contracts/access/Ownable2Step.sol";

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

    // Sample mint metadata used by the helpers.
    string internal constant SAMPLE_URI = "ipfs://bafyExampleEncryptedBundleCID";
    bytes32 internal constant SAMPLE_HASH = keccak256("sample-bundle-plaintext");

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
        uint256 id = vault.mintWithCLAWD(alice, 0, aliceBackup, SAMPLE_URI, SAMPLE_HASH);

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
        assertEq(v.encryptedContentURI, SAMPLE_URI);
        assertEq(v.contentHash, SAMPLE_HASH);
    }

    function test_mintWithCLAWD_revertsOnZeroTo() public {
        vm.prank(alice);
        clawd.approve(address(vault), type(uint256).max);
        vm.prank(alice);
        vm.expectRevert(VaultID.ZeroAddress.selector);
        vault.mintWithCLAWD(address(0), 0, aliceBackup, SAMPLE_URI, SAMPLE_HASH);
    }

    function test_mintWithCLAWD_revertsOnZeroBackup() public {
        vm.prank(alice);
        clawd.approve(address(vault), type(uint256).max);
        vm.prank(alice);
        vm.expectRevert(VaultID.ZeroAddress.selector);
        vault.mintWithCLAWD(alice, 0, address(0), SAMPLE_URI, SAMPLE_HASH);
    }

    function test_mintWithCLAWD_revertsWhenBackupEqualsHolder() public {
        vm.prank(alice);
        clawd.approve(address(vault), type(uint256).max);
        vm.prank(alice);
        vm.expectRevert(VaultID.BackupWalletEqualsHolder.selector);
        vault.mintWithCLAWD(alice, 0, alice, SAMPLE_URI, SAMPLE_HASH);
    }

    function test_mintWithCLAWD_revertsOnInvalidCategory() public {
        vm.prank(alice);
        clawd.approve(address(vault), type(uint256).max);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(VaultID.InvalidCategory.selector, uint8(6)));
        vault.mintWithCLAWD(alice, 6, aliceBackup, SAMPLE_URI, SAMPLE_HASH);
    }

    function test_mintWithCLAWD_revertsOnEmptyURI() public {
        vm.prank(alice);
        clawd.approve(address(vault), type(uint256).max);
        vm.prank(alice);
        vm.expectRevert(VaultID.EmptyContentURI.selector);
        vault.mintWithCLAWD(alice, 0, aliceBackup, "", SAMPLE_HASH);
    }

    function test_mintWithCLAWD_revertsOnZeroContentHash() public {
        vm.prank(alice);
        clawd.approve(address(vault), type(uint256).max);
        vm.prank(alice);
        vm.expectRevert(VaultID.ZeroContentHash.selector);
        vault.mintWithCLAWD(alice, 0, aliceBackup, SAMPLE_URI, bytes32(0));
    }

    function test_mintWithCLAWD_revertsWhenNoApproval() public {
        vm.prank(alice);
        // No approval -> SafeERC20 should bubble a revert.
        vm.expectRevert();
        vault.mintWithCLAWD(alice, 0, aliceBackup, SAMPLE_URI, SAMPLE_HASH);
    }

    function test_mintWithCLAWD_zeroFee_skipsTransfer() public {
        vm.prank(owner);
        vault.setClawdMintFee(0);
        vm.prank(alice);
        // No approval needed when fee is 0
        uint256 id = vault.mintWithCLAWD(alice, 1, aliceBackup, SAMPLE_URI, SAMPLE_HASH);
        assertEq(id, 1);
        assertEq(vault.ownerOf(1), alice);
    }

    function test_mintWithCLAWD_emitsLockedAndMinted() public {
        vm.prank(alice);
        clawd.approve(address(vault), type(uint256).max);

        vm.expectEmit(true, false, false, false, address(vault));
        emit VaultID.Locked(1);
        vm.expectEmit(true, true, true, true, address(vault));
        emit VaultID.VaultMinted(1, alice, aliceBackup, 0, 0, false, SAMPLE_HASH, SAMPLE_URI);

        vm.prank(alice);
        vault.mintWithCLAWD(alice, 0, aliceBackup, SAMPLE_URI, SAMPLE_HASH);
    }

    /// @dev Defense-in-depth ordering: fee transfer happens BEFORE _safeMint.
    ///      Verify the happy-path balance change is correct end-to-end.
    function test_mintWithCLAWD_feePulledBeforeMint() public {
        vm.prank(alice);
        clawd.approve(address(vault), type(uint256).max);

        uint256 aliceBefore = clawd.balanceOf(alice);
        uint256 ownerBefore = clawd.balanceOf(owner);

        vm.prank(alice);
        vault.mintWithCLAWD(alice, 0, aliceBackup, SAMPLE_URI, SAMPLE_HASH);

        assertEq(clawd.balanceOf(alice), aliceBefore - 100e18);
        assertEq(clawd.balanceOf(owner), ownerBefore + 100e18);
        assertEq(vault.ownerOf(1), alice);
    }

    // ---------- mintWithCV behavior (CV unset / set) ----------

    function test_mintWithCV_revertsWhenCvUnset() public {
        // cv token is unset by default in setUp.
        vm.prank(alice);
        cv.approve(address(vault), type(uint256).max);
        vm.prank(alice);
        vm.expectRevert(VaultID.CvTokenNotSet.selector);
        vault.mintWithCV(alice, 0, aliceBackup, SAMPLE_URI, SAMPLE_HASH);
    }

    function test_mintWithCV_revertsWithCvNotSetBeforeOtherChecks() public {
        // Even with bogus inputs (zero `to`, equal backup), CvTokenNotSet must fire first.
        vm.prank(alice);
        vm.expectRevert(VaultID.CvTokenNotSet.selector);
        vault.mintWithCV(address(0), 6, address(0), "", bytes32(0));
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

    /// @dev One-shot setter: after `cvToken` is set, subsequent calls revert.
    function test_setCvToken_isOneShot_revertsOnSecondCall() public {
        vm.prank(owner);
        vault.setCvToken(address(cv));

        // Calling with a different ERC-20 must revert with CvTokenAlreadySet.
        MockERC20 otherToken = new MockERC20("OTHER", "OTHER");
        vm.prank(owner);
        vm.expectRevert(VaultID.CvTokenAlreadySet.selector);
        vault.setCvToken(address(otherToken));

        // Calling again with address(0) (attempt to "disable") must also revert.
        vm.prank(owner);
        vm.expectRevert(VaultID.CvTokenAlreadySet.selector);
        vault.setCvToken(address(0));

        // cvToken is unchanged from the first set.
        assertEq(address(vault.cvToken()), address(cv));
    }

    function test_mintWithCV_worksAfterSetCvToken() public {
        vm.prank(owner);
        vault.setCvToken(address(cv));

        vm.prank(alice);
        cv.approve(address(vault), type(uint256).max);

        uint256 ownerCvBefore = cv.balanceOf(owner);
        vm.prank(alice);
        uint256 id = vault.mintWithCV(alice, 2, aliceBackup, SAMPLE_URI, SAMPLE_HASH);
        assertEq(id, 1);
        assertEq(vault.ownerOf(1), alice);
        assertEq(cv.balanceOf(owner), ownerCvBefore + 100e18);

        VaultID.Vault memory v = vault.getVault(1);
        assertEq(v.category, 2);
        assertTrue(v.active);
        assertEq(v.encryptedContentURI, SAMPLE_URI);
        assertEq(v.contentHash, SAMPLE_HASH);
    }

    function test_mintWithCV_revertsOnEmptyURI() public {
        vm.prank(owner);
        vault.setCvToken(address(cv));
        vm.prank(alice);
        cv.approve(address(vault), type(uint256).max);
        vm.prank(alice);
        vm.expectRevert(VaultID.EmptyContentURI.selector);
        vault.mintWithCV(alice, 0, aliceBackup, "", SAMPLE_HASH);
    }

    function test_mintWithCV_revertsOnZeroContentHash() public {
        vm.prank(owner);
        vault.setCvToken(address(cv));
        vm.prank(alice);
        cv.approve(address(vault), type(uint256).max);
        vm.prank(alice);
        vm.expectRevert(VaultID.ZeroContentHash.selector);
        vault.mintWithCV(alice, 0, aliceBackup, SAMPLE_URI, bytes32(0));
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

    function test_extendExpiry_canSetToNever_fromFinite() public {
        vm.prank(owner);
        vault.setDefaultValidityPeriod(7 days);
        _mintAlice(0);

        // Vault starts with a finite expiry — owner can extend to "never".
        vm.prank(owner);
        vault.extendExpiry(1, 0);
        assertEq(vault.getVault(1).expiresAt, 0);
        // Warp far ahead — should still be active.
        vm.warp(block.timestamp + 365 days);
        assertTrue(vault.isActive(1));
    }

    /// @dev M-02 fix: a never-expire vault cannot be downgraded to a finite expiry.
    function test_extendExpiry_neverExpire_cannotBeDowngradedToFinite() public {
        // defaultValidityPeriod is 0 by default — vault is minted as "never expires".
        _mintAlice(0);
        VaultID.Vault memory v = vault.getVault(1);
        assertEq(v.expiresAt, 0);

        vm.prank(owner);
        vm.expectRevert(VaultID.InvalidExpiryExtension.selector);
        vault.extendExpiry(1, uint64(block.timestamp) + 30 days);

        // Setting "never" → "never" is a no-op but allowed (no downgrade).
        vm.prank(owner);
        vault.extendExpiry(1, 0);
        assertEq(vault.getVault(1).expiresAt, 0);
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

    /// @dev L-02 fix: extending a burned vault must revert.
    function test_extendExpiry_burned_reverts() public {
        vm.prank(owner);
        vault.setDefaultValidityPeriod(7 days);
        _mintAlice(0);
        vm.prank(alice);
        vault.burn(1);

        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(VaultID.TokenAlreadyBurned.selector, uint256(1)));
        vault.extendExpiry(1, uint64(block.timestamp) + 30 days);
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

    /// @dev L-03: fee setters must reject values above MAX_MINT_FEE; boundary OK.
    function test_setClawdMintFee_capBoundary() public {
        uint256 cap = vault.MAX_MINT_FEE();

        // Boundary: exactly at cap is allowed.
        vm.prank(owner);
        vault.setClawdMintFee(cap);
        assertEq(vault.clawdMintFee(), cap);

        // One above cap reverts.
        vm.prank(owner);
        vm.expectRevert(VaultID.FeeTooLarge.selector);
        vault.setClawdMintFee(cap + 1);
    }

    function test_setCvMintFee_capBoundary() public {
        uint256 cap = vault.MAX_MINT_FEE();

        vm.prank(owner);
        vault.setCvMintFee(cap);
        assertEq(vault.cvMintFee(), cap);

        vm.prank(owner);
        vm.expectRevert(VaultID.FeeTooLarge.selector);
        vault.setCvMintFee(cap + 1);
    }

    /// @dev I-07: validity period setter must reject values above MAX_VALIDITY_PERIOD.
    function test_setDefaultValidityPeriod_capBoundary() public {
        uint64 cap = vault.MAX_VALIDITY_PERIOD();

        vm.prank(owner);
        vault.setDefaultValidityPeriod(cap);
        assertEq(vault.defaultValidityPeriod(), cap);

        vm.prank(owner);
        vm.expectRevert(VaultID.ValidityPeriodTooLarge.selector);
        vault.setDefaultValidityPeriod(cap + 1);
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
        vault.mintWithCLAWD(alice, 0, aliceBackup, SAMPLE_URI, SAMPLE_HASH);
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

    // ---------- Ownable2Step + renounce ----------

    /// @dev L-01: ownership transfer follows the 2-step Ownable2Step flow.
    function test_transferOwnership_isTwoStep() public {
        // Step 1: owner queues the transfer; ownership not yet handed over.
        vm.prank(owner);
        vault.transferOwnership(bob);
        assertEq(vault.owner(), owner);
        assertEq(vault.pendingOwner(), bob);

        // Pending owner cannot perform owner-only actions yet.
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, bob));
        vault.setClawdMintFee(1);

        // Step 2: pending owner accepts.
        vm.prank(bob);
        vault.acceptOwnership();
        assertEq(vault.owner(), bob);
        assertEq(vault.pendingOwner(), address(0));

        // Old owner is no longer authorized.
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, owner));
        vault.setClawdMintFee(1);
    }

    /// @dev I-08: renounceOwnership is permanently disabled.
    function test_renounceOwnership_disabled() public {
        vm.prank(owner);
        vm.expectRevert(VaultID.RenouncementDisabled.selector);
        vault.renounceOwnership();
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
            vault.mintWithCLAWD(holder, c, backup, SAMPLE_URI, SAMPLE_HASH);
            string memory uri = vault.tokenURI(c + 1);
            assertGt(bytes(uri).length, 200);
        }
    }

    /// @dev I-01: a category label containing JSON-meaningful chars must be escaped.
    function test_tokenURI_jsonEscapesLabel() public {
        // Set label with a literal `"` and a `\` — these must be escaped in the JSON.
        vm.prank(owner);
        vault.setCategoryLabel(0, "a\"b\\c");

        _mintAlice(0);

        string memory uri = vault.tokenURI(1);

        // The data URI prefix is "data:application/json;base64,".
        bytes memory uriBytes = bytes(uri);
        // Strip the prefix and base64-decode the remainder.
        string memory b64 = _substr(uri, 29, uriBytes.length - 29);
        bytes memory json = _b64decode(b64);

        // The decoded JSON must contain the escaped form (`a\"b\\c` ⇒ literal: `a\"b\\c`)
        // i.e. the bytes `a`, `\`, `"`, `b`, `\`, `\`, `c`.
        bytes memory expectedFragment = abi.encodePacked('"value":"', bytes1("a"), bytes1(0x5c), bytes1(0x22), bytes1("b"), bytes1(0x5c), bytes1(0x5c), bytes1("c"), bytes1(0x22));
        assertTrue(_contains(json, expectedFragment), "escaped label not found in JSON");
    }

    /// @dev tokenURI must NOT include encryptedContentURI nor contentHash.
    function test_tokenURI_doesNotLeakStorageOnlyMetadata() public {
        _mintAlice(0);
        string memory uri = vault.tokenURI(1);
        bytes memory uriBytes = bytes(uri);
        string memory b64 = _substr(uri, 29, uriBytes.length - 29);
        bytes memory json = _b64decode(b64);

        // Sample URI must NOT appear anywhere.
        assertFalse(_contains(json, bytes(SAMPLE_URI)), "encryptedContentURI leaked into tokenURI");
        // Hex form of the contentHash must NOT appear either.
        // (Cheap proxy: check for the first 6 hex chars of SAMPLE_HASH.)
        bytes memory hexPrefix = _hex6(SAMPLE_HASH);
        assertFalse(_contains(json, hexPrefix), "contentHash leaked into tokenURI");
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

    /// @dev getVault returns the URI + hash exactly as supplied at mint.
    function test_getVault_returnsContentMetadata() public {
        string memory uri = "ipfs://bafyMyVeryOwnCID";
        bytes32 hash = keccak256("plaintext-bundle-v1");

        vm.prank(alice);
        clawd.approve(address(vault), type(uint256).max);
        vm.prank(alice);
        vault.mintWithCLAWD(alice, 3, aliceBackup, uri, hash);

        VaultID.Vault memory v = vault.getVault(1);
        assertEq(v.encryptedContentURI, uri);
        assertEq(v.contentHash, hash);
    }

    // ---------- Internal helpers ----------

    function _mintAlice(uint8 cat) internal {
        vm.prank(alice);
        clawd.approve(address(vault), type(uint256).max);
        vm.prank(alice);
        vault.mintWithCLAWD(alice, cat, aliceBackup, SAMPLE_URI, SAMPLE_HASH);
    }

    function _substr(string memory s, uint256 start, uint256 len) internal pure returns (string memory) {
        bytes memory b = bytes(s);
        bytes memory out = new bytes(len);
        for (uint256 i = 0; i < len; i++) {
            out[i] = b[start + i];
        }
        return string(out);
    }

    function _contains(bytes memory haystack, bytes memory needle) internal pure returns (bool) {
        if (needle.length == 0) return true;
        if (needle.length > haystack.length) return false;
        for (uint256 i = 0; i <= haystack.length - needle.length; i++) {
            bool match_ = true;
            for (uint256 j = 0; j < needle.length; j++) {
                if (haystack[i + j] != needle[j]) {
                    match_ = false;
                    break;
                }
            }
            if (match_) return true;
        }
        return false;
    }

    /// @dev First 6 lowercase hex chars (no 0x prefix) of a bytes32.
    function _hex6(bytes32 x) internal pure returns (bytes memory) {
        bytes memory hexChars = "0123456789abcdef";
        bytes memory out = new bytes(6);
        for (uint256 i = 0; i < 3; i++) {
            uint8 b = uint8(x[i]);
            out[i * 2] = hexChars[b >> 4];
            out[i * 2 + 1] = hexChars[b & 0x0f];
        }
        return out;
    }

    /// @dev Minimal base64 decoder for tests. No padding-strict checks — Base64.encode
    ///      from OZ always pads correctly.
    function _b64decode(string memory s) internal pure returns (bytes memory) {
        bytes memory data = bytes(s);
        // Build reverse table inline (only 64 chars + padding).
        // Map: A-Z=0-25, a-z=26-51, 0-9=52-61, +=62, /=63, '='=0 (padding).
        require(data.length % 4 == 0, "bad b64 length");
        uint256 padding = 0;
        if (data.length > 0 && data[data.length - 1] == 0x3d) padding++;
        if (data.length > 1 && data[data.length - 2] == 0x3d) padding++;
        bytes memory out = new bytes((data.length / 4) * 3 - padding);
        uint256 j = 0;
        for (uint256 i = 0; i < data.length; i += 4) {
            uint256 a = _b64char(data[i]);
            uint256 b = _b64char(data[i + 1]);
            uint256 c = _b64char(data[i + 2]);
            uint256 d = _b64char(data[i + 3]);
            uint256 chunk = (a << 18) | (b << 12) | (c << 6) | d;
            if (j < out.length) out[j++] = bytes1(uint8(chunk >> 16));
            if (j < out.length) out[j++] = bytes1(uint8((chunk >> 8) & 0xff));
            if (j < out.length) out[j++] = bytes1(uint8(chunk & 0xff));
        }
        return out;
    }

    function _b64char(bytes1 c) internal pure returns (uint256) {
        uint8 v = uint8(c);
        if (v >= 0x41 && v <= 0x5a) return v - 0x41; // A-Z
        if (v >= 0x61 && v <= 0x7a) return v - 0x61 + 26; // a-z
        if (v >= 0x30 && v <= 0x39) return v - 0x30 + 52; // 0-9
        if (v == 0x2b) return 62; // +
        if (v == 0x2f) return 63; // /
        if (v == 0x3d) return 0; // = (padding)
        revert("bad b64 char");
    }
}

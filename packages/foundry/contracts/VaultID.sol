// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { ERC721 } from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { Ownable2Step } from "@openzeppelin/contracts/access/Ownable2Step.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { Strings } from "@openzeppelin/contracts/utils/Strings.sol";
import { Base64 } from "@openzeppelin/contracts/utils/Base64.sol";

/**
 * @title VaultID
 * @notice Soulbound ERC-721 identity vault for the LeftClaw ecosystem.
 *
 * Each VaultID NFT is a non-transferable on-chain identity bound to a single
 * owner wallet. It carries a category, an immutable backup wallet, an optional
 * expiry, and is rendered fully on-chain as an SVG badge. Each vault also
 * carries an `encryptedContentURI` (IPFS CID of an encrypted bundle) and a
 * `contentHash` (keccak256 of the original plaintext bundle) — both are
 * storage-only metadata, retrievable via `getVault(tokenId)`, and never
 * exposed in the public-facing on-chain `tokenURI` JSON/SVG output.
 *
 * Vaults can be minted in two ways:
 *  - `mintWithCLAWD` — by paying `clawdMintFee` of the CLAWD token (always available).
 *  - `mintWithCV`    — by paying `cvMintFee` of the CV token (only available
 *                      once the owner has wired up a real CV ERC-20 via
 *                      `setCvToken`; reverts with `CvTokenNotSet` otherwise).
 *
 * Soulbound semantics follow ERC-5192: tokens are locked at mint and never unlock.
 *
 * Vaults are non-transferable and may be soft-burned by their owner (the badge
 * is marked inactive, but the token itself stays in place so the burn is
 * permanently observable on-chain).
 *
 * @dev `balanceOf` reflects the total number of vaults ever minted to a holder
 *      including those that have been soft-burned (i.e. `active == false`).
 *      Off-chain integrators that need a "live count" should iterate over
 *      tokens and consult `getVault` / `isActive` rather than relying on
 *      `balanceOf`.
 */
contract VaultID is ERC721, Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using Strings for uint256;
    using Strings for address;

    // ---------------------------------------------------------------------
    // Constants
    // ---------------------------------------------------------------------

    /// @dev ERC-5192 interface id (as defined in EIP-5192).
    bytes4 private constant _INTERFACE_ID_ERC5192 = 0xb45a3c0e;

    /// @notice Number of supported categories (0..NUM_CATEGORIES-1).
    uint8 public constant NUM_CATEGORIES = 6;

    /// @notice Hard cap on either mint fee (CLAWD or CV). Generous, prevents bricking.
    uint256 public constant MAX_MINT_FEE = 1_000_000_000 * 10 ** 18; // 1B units (in fee-token wei)

    /// @notice Hard cap on `defaultValidityPeriod` (100 years in seconds).
    uint64 public constant MAX_VALIDITY_PERIOD = 100 * 365 days;

    // ---------------------------------------------------------------------
    // Types
    // ---------------------------------------------------------------------

    struct Vault {
        address holder; // original holder; remains set even after soft burn
        address backupWallet; // immutable; set once at mint, never changes
        uint8 category; // 0..NUM_CATEGORIES-1
        uint64 mintedAt; // unix seconds
        uint64 expiresAt; // 0 = never expires
        bool active; // false after soft burn
        string encryptedContentURI; // IPFS CID of the encrypted bundle
        bytes32 contentHash; // keccak256 of the original plaintext bundle
    }

    // ---------------------------------------------------------------------
    // Storage
    // ---------------------------------------------------------------------

    /// @notice CLAWD ERC-20 used to pay the CLAWD mint fee. Immutable.
    IERC20 public immutable clawdToken;

    /// @notice CV ERC-20 used to pay the CV mint fee. May be unset (zero) initially.
    /// @dev Mutable but ONE-SHOT — owner may call `setCvToken` to wire in a real
    ///      ERC-20 exactly once, while it's still the zero address. Once set,
    ///      `setCvToken` reverts with `CvTokenAlreadySet`.
    IERC20 public cvToken;

    /// @notice CLAWD-denominated mint fee (in CLAWD wei). Configurable by owner.
    uint256 public clawdMintFee;

    /// @notice CV-denominated mint fee (in CV wei). Configurable by owner.
    uint256 public cvMintFee;

    /// @notice Address that receives collected mint fees. Defaults to owner.
    address public feeRecipient;

    /// @notice Default validity period applied at mint (seconds). 0 = no expiry.
    uint64 public defaultValidityPeriod;

    /// @dev Monotonically increasing token id counter (starts at 1).
    uint256 private _nextTokenId = 1;

    /// @dev Per-token vault data.
    mapping(uint256 => Vault) private _vaults;

    /// @dev Human-readable label per category (e.g. "Personal", "Business").
    mapping(uint8 => string) public categoryLabel;

    // ---------------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------------

    event VaultMinted(
        uint256 indexed tokenId,
        address indexed holder,
        address indexed backupWallet,
        uint8 category,
        uint64 expiresAt,
        bool paidWithCv,
        bytes32 contentHash,
        string encryptedContentURI
    );
    event VaultBurned(uint256 indexed tokenId, address indexed holder);
    event VaultExpiryExtended(uint256 indexed tokenId, uint64 newExpiresAt);
    event CategoryLabelSet(uint8 indexed category, string label);
    event ClawdMintFeeUpdated(uint256 newFee);
    event CvMintFeeUpdated(uint256 newFee);
    event CvTokenUpdated(address newCvToken);
    event FeeRecipientUpdated(address newRecipient);
    event DefaultValidityPeriodUpdated(uint64 newPeriod);

    // ERC-5192
    event Locked(uint256 tokenId);
    /// @dev Declared for ABI completeness; never emitted (vaults never unlock).
    event Unlocked(uint256 tokenId);

    // ---------------------------------------------------------------------
    // Errors
    // ---------------------------------------------------------------------

    error ZeroAddress();
    error InvalidCategory(uint8 category);
    error TokenNotFound(uint256 tokenId);
    error NotTokenOwner();
    error TokenAlreadyBurned(uint256 tokenId);
    error TokenExpired(uint256 tokenId);
    error Soulbound();
    error CvTokenNotSet();
    error CvTokenAlreadySet();
    error InvalidExpiryExtension();
    error LabelTooLong();
    error EmptyContentURI();
    error ZeroContentHash();
    error FeeTooLarge();
    error ValidityPeriodTooLarge();
    error BackupWalletEqualsHolder();
    error RenouncementDisabled();

    // ---------------------------------------------------------------------
    // Constructor
    // ---------------------------------------------------------------------

    /**
     * @param _initialOwner Owner of the contract (also default fee recipient).
     * @param _clawdToken   Required. CLAWD ERC-20 used for `mintWithCLAWD`.
     * @param _cvToken      Optional. CV ERC-20 used for `mintWithCV`. May be zero;
     *                      if zero, `mintWithCV` is disabled until `setCvToken`
     *                      is called by the owner.
     */
    constructor(address _initialOwner, address _clawdToken, address _cvToken)
        ERC721("LeftClaw VaultID", "VAULTID")
        Ownable(_initialOwner)
    {
        if (_initialOwner == address(0)) revert ZeroAddress();
        if (_clawdToken == address(0)) revert ZeroAddress();

        clawdToken = IERC20(_clawdToken);
        cvToken = IERC20(_cvToken); // zero allowed
        feeRecipient = _initialOwner;

        // Sensible defaults
        clawdMintFee = 100e18; // 100 CLAWD
        cvMintFee = 100e18; // 100 CV (only matters once cvToken is set)
        defaultValidityPeriod = 0; // no expiry by default

        // Default category labels (owner can rename)
        categoryLabel[0] = "Personal";
        categoryLabel[1] = "Business";
        categoryLabel[2] = "Developer";
        categoryLabel[3] = "Validator";
        categoryLabel[4] = "Treasury";
        categoryLabel[5] = "Community";
    }

    // ---------------------------------------------------------------------
    // Admin
    // ---------------------------------------------------------------------

    /**
     * @notice One-shot setter for the CV ERC-20. May only be called while
     *         `cvToken == address(0)`. Once set, the CV token is permanently
     *         locked — there is no path to disable or change it.
     * @dev Reverts with `CvTokenAlreadySet` if already configured.
     */
    function setCvToken(address newCvToken) external onlyOwner {
        if (address(cvToken) != address(0)) revert CvTokenAlreadySet();
        cvToken = IERC20(newCvToken);
        emit CvTokenUpdated(newCvToken);
    }

    function setClawdMintFee(uint256 newFee) external onlyOwner {
        if (newFee > MAX_MINT_FEE) revert FeeTooLarge();
        clawdMintFee = newFee;
        emit ClawdMintFeeUpdated(newFee);
    }

    function setCvMintFee(uint256 newFee) external onlyOwner {
        if (newFee > MAX_MINT_FEE) revert FeeTooLarge();
        cvMintFee = newFee;
        emit CvMintFeeUpdated(newFee);
    }

    function setFeeRecipient(address newRecipient) external onlyOwner {
        if (newRecipient == address(0)) revert ZeroAddress();
        feeRecipient = newRecipient;
        emit FeeRecipientUpdated(newRecipient);
    }

    function setDefaultValidityPeriod(uint64 newPeriod) external onlyOwner {
        if (newPeriod > MAX_VALIDITY_PERIOD) revert ValidityPeriodTooLarge();
        defaultValidityPeriod = newPeriod;
        emit DefaultValidityPeriodUpdated(newPeriod);
    }

    function setCategoryLabel(uint8 category, string calldata label) external onlyOwner {
        if (category >= NUM_CATEGORIES) revert InvalidCategory(category);
        if (bytes(label).length > 32) revert LabelTooLong();
        categoryLabel[category] = label;
        emit CategoryLabelSet(category, label);
    }

    /**
     * @notice Renouncing ownership is permanently disabled — the contract has
     *         too many admin functions (fee recipient, expiry extension, etc.)
     *         to safely orphan. Use `transferOwnership` to a new owner instead.
     */
    function renounceOwnership() public view override onlyOwner {
        revert RenouncementDisabled();
    }

    // ---------------------------------------------------------------------
    // Minting
    // ---------------------------------------------------------------------

    /**
     * @notice Mint a VaultID by paying `clawdMintFee` in CLAWD.
     * @dev Only standard ERC-20 tokens are supported. Fee-on-transfer or
     *      rebasing tokens will not work correctly — the contract assumes
     *      `safeTransferFrom(amount)` moves exactly `amount` units.
     * @param to                  Recipient (vault holder). Must be non-zero.
     * @param category            Category id (0..NUM_CATEGORIES-1).
     * @param backupWallet        Immutable backup wallet for this vault. Must be
     *                            non-zero and not equal to `to`.
     * @param encryptedContentURI IPFS CID of the encrypted bundle. Must be non-empty.
     * @param contentHash         keccak256 of the original plaintext bundle. Must be non-zero.
     */
    function mintWithCLAWD(
        address to,
        uint8 category,
        address backupWallet,
        string calldata encryptedContentURI,
        bytes32 contentHash
    ) external nonReentrant returns (uint256 tokenId) {
        tokenId = _mintVault(to, category, backupWallet, encryptedContentURI, contentHash, false);
    }

    /**
     * @notice Mint a VaultID by paying `cvMintFee` in CV.
     * @dev Reverts with `CvTokenNotSet` if the owner has not yet wired in a CV ERC-20.
     *      Only standard ERC-20 tokens are supported. Fee-on-transfer or rebasing
     *      tokens will not work correctly.
     */
    function mintWithCV(
        address to,
        uint8 category,
        address backupWallet,
        string calldata encryptedContentURI,
        bytes32 contentHash
    ) external nonReentrant returns (uint256 tokenId) {
        // Per spec: this must be the very first check.
        if (address(cvToken) == address(0)) revert CvTokenNotSet();
        tokenId = _mintVault(to, category, backupWallet, encryptedContentURI, contentHash, true);
    }

    function _mintVault(
        address to,
        uint8 category,
        address backupWallet,
        string calldata encryptedContentURI,
        bytes32 contentHash,
        bool paidWithCv
    ) internal returns (uint256 tokenId) {
        // ---- Validate inputs ----
        if (to == address(0)) revert ZeroAddress();
        if (backupWallet == address(0)) revert ZeroAddress();
        if (backupWallet == to) revert BackupWalletEqualsHolder();
        if (category >= NUM_CATEGORIES) revert InvalidCategory(category);
        if (bytes(encryptedContentURI).length == 0) revert EmptyContentURI();
        if (contentHash == bytes32(0)) revert ZeroContentHash();

        // ---- Write Vault struct ----
        tokenId = _nextTokenId++;
        uint64 expiresAt = defaultValidityPeriod == 0 ? 0 : uint64(block.timestamp) + defaultValidityPeriod;

        _vaults[tokenId] = Vault({
            holder: to,
            backupWallet: backupWallet,
            category: category,
            mintedAt: uint64(block.timestamp),
            expiresAt: expiresAt,
            active: true,
            encryptedContentURI: encryptedContentURI,
            contentHash: contentHash
        });

        // ---- Pull fee BEFORE _safeMint (defense-in-depth ordering) ----
        if (paidWithCv) {
            if (cvMintFee > 0) {
                cvToken.safeTransferFrom(msg.sender, feeRecipient, cvMintFee);
            }
        } else {
            if (clawdMintFee > 0) {
                clawdToken.safeTransferFrom(msg.sender, feeRecipient, clawdMintFee);
            }
        }

        // ---- Mint and emit ----
        _safeMint(to, tokenId);
        emit Locked(tokenId);
        emit VaultMinted(tokenId, to, backupWallet, category, expiresAt, paidWithCv, contentHash, encryptedContentURI);
    }

    // ---------------------------------------------------------------------
    // Lifecycle
    // ---------------------------------------------------------------------

    /**
     * @notice Soft-burn the caller's vault. The token stays in place but is
     *         marked inactive and visually overlaid as BURNED on the SVG.
     */
    function burn(uint256 tokenId) external {
        Vault storage v = _vaults[tokenId];
        if (v.holder == address(0)) revert TokenNotFound(tokenId);
        if (ownerOf(tokenId) != msg.sender) revert NotTokenOwner();
        if (!v.active) revert TokenAlreadyBurned(tokenId);
        v.active = false;
        emit VaultBurned(tokenId, msg.sender);
    }

    /**
     * @notice Owner can extend a vault's expiry (e.g. after off-chain renewal).
     * @dev Setting `newExpiresAt` to 0 is NOT allowed once a finite expiry was
     *      set. A vault minted with `defaultValidityPeriod == 0` (never expires)
     *      cannot be downgraded to a finite expiry. Burned vaults cannot be
     *      extended.
     */
    function extendExpiry(uint256 tokenId, uint64 newExpiresAt) external onlyOwner {
        Vault storage v = _vaults[tokenId];
        if (v.holder == address(0)) revert TokenNotFound(tokenId);
        if (!v.active) revert TokenAlreadyBurned(tokenId);
        // Never-expire vaults must stay never-expire — owner cannot downgrade.
        if (v.expiresAt == 0 && newExpiresAt != 0) revert InvalidExpiryExtension();
        if (newExpiresAt != 0 && newExpiresAt <= v.expiresAt) revert InvalidExpiryExtension();
        v.expiresAt = newExpiresAt;
        emit VaultExpiryExtended(tokenId, newExpiresAt);
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    function totalMinted() external view returns (uint256) {
        return _nextTokenId - 1;
    }

    function getVault(uint256 tokenId) external view returns (Vault memory) {
        Vault memory v = _vaults[tokenId];
        if (v.holder == address(0)) revert TokenNotFound(tokenId);
        return v;
    }

    function isExpired(uint256 tokenId) public view returns (bool) {
        Vault memory v = _vaults[tokenId];
        if (v.holder == address(0)) revert TokenNotFound(tokenId);
        return v.expiresAt != 0 && block.timestamp >= v.expiresAt;
    }

    function isActive(uint256 tokenId) public view returns (bool) {
        Vault memory v = _vaults[tokenId];
        if (v.holder == address(0)) return false;
        if (!v.active) return false;
        if (v.expiresAt != 0 && block.timestamp >= v.expiresAt) return false;
        return true;
    }

    // ---------------------------------------------------------------------
    // ERC-5192 (soulbound)
    // ---------------------------------------------------------------------

    function locked(uint256 tokenId) external view returns (bool) {
        if (_ownerOf(tokenId) == address(0)) revert TokenNotFound(tokenId);
        return true;
    }

    function supportsInterface(bytes4 interfaceId) public view virtual override(ERC721) returns (bool) {
        return interfaceId == _INTERFACE_ID_ERC5192 || super.supportsInterface(interfaceId);
    }

    // ---------------------------------------------------------------------
    // Soulbound enforcement
    // ---------------------------------------------------------------------

    /**
     * @dev Override ERC-721 transfer hook so tokens are soulbound: only mints
     *      (auth == address(0)) are allowed. Any actual transfer reverts.
     *      Burns aren't reachable here because we don't expose `_burn`.
     */
    function _update(address to, uint256 tokenId, address auth)
        internal
        virtual
        override
        returns (address)
    {
        address from = _ownerOf(tokenId);
        if (from != address(0)) {
            // Any post-mint movement is forbidden.
            revert Soulbound();
        }
        return super._update(to, tokenId, auth);
    }

    // Block setApprovalForAll / approve outright — there's no legitimate use
    // for approvals on a soulbound token, and surfacing the error here makes
    // wallets stop offering the action.
    function approve(address, uint256) public pure override {
        revert Soulbound();
    }

    function setApprovalForAll(address, bool) public pure override {
        revert Soulbound();
    }

    // Note: `transferFrom` and `safeTransferFrom` are not overridden here —
    // their reverts come from `_update` above. Approvals are blocked at the
    // entry points so wallets fail loudly instead of silently approving a token
    // that can never move.

    // ---------------------------------------------------------------------
    // Metadata (fully on-chain SVG)
    // ---------------------------------------------------------------------

    /**
     * @notice On-chain JSON+SVG metadata for `tokenId`.
     * @dev Returns metadata even for soft-burned vaults (the SVG shows a
     *      BURNED overlay). This is intentional so the burn is visible
     *      forever via marketplaces / explorers. Integrators that need the
     *      live status should consult `isActive`.
     *      `encryptedContentURI` and `contentHash` are NEVER embedded here —
     *      they are storage-only metadata, accessible via `getVault`.
     */
    function tokenURI(uint256 tokenId) public view virtual override returns (string memory) {
        Vault memory v = _vaults[tokenId];
        if (v.holder == address(0)) revert TokenNotFound(tokenId);

        string memory name = string(abi.encodePacked("VaultID #", tokenId.toString()));
        string memory description =
            "Soulbound identity vault for the LeftClaw ecosystem. Non-transferable, on-chain rendered.";

        string memory image =
            string(abi.encodePacked("data:image/svg+xml;base64,", Base64.encode(bytes(_renderSVG(tokenId, v)))));

        string memory attrs = _buildAttributes(v);

        bytes memory json = abi.encodePacked(
            '{"name":"',
            name,
            '","description":"',
            description,
            '","image":"',
            image,
            '","attributes":',
            attrs,
            "}"
        );

        return string(abi.encodePacked("data:application/json;base64,", Base64.encode(json)));
    }

    function _buildAttributes(Vault memory v) internal view returns (string memory) {
        string memory part1 = string(
            abi.encodePacked(
                '[{"trait_type":"Category","value":"',
                _jsonEscape(_safeCategoryLabel(v.category)),
                '"},{"trait_type":"Holder","value":"',
                v.holder.toHexString(),
                '"},{"trait_type":"Backup Wallet","value":"',
                v.backupWallet.toHexString(),
                '"},'
            )
        );
        string memory expiresStr = v.expiresAt == 0
            ? "null"
            : uint256(v.expiresAt).toString();
        string memory part2 = string(
            abi.encodePacked(
                '{"trait_type":"Minted At","display_type":"date","value":',
                uint256(v.mintedAt).toString(),
                '},{"trait_type":"Expires At","display_type":"date","value":',
                expiresStr,
                "},"
            )
        );
        string memory part3 = string(
            abi.encodePacked(
                '{"trait_type":"Active","value":"',
                isVaultActive(v) ? "true" : "false",
                '"},{"trait_type":"Soulbound","value":"true"}]'
            )
        );
        return string(abi.encodePacked(part1, part2, part3));
    }

    function isVaultActive(Vault memory v) internal view returns (bool) {
        if (!v.active) return false;
        if (v.expiresAt != 0 && block.timestamp >= v.expiresAt) return false;
        return true;
    }

    function _safeCategoryLabel(uint8 category) internal view returns (string memory) {
        string memory label = categoryLabel[category];
        if (bytes(label).length == 0) return string(abi.encodePacked("Category ", uint256(category).toString()));
        return label;
    }

    /**
     * @dev Minimal JSON string escape: handles the two structural characters
     *      (`"` and `\`) that would otherwise break JSON parsing. Other ASCII
     *      control characters (\x00..\x1F) are not expected in category labels
     *      (which are bounded to 32 bytes and set by the contract owner), but
     *      callers writing labels should keep this constraint in mind.
     */
    function _jsonEscape(string memory s) internal pure returns (string memory) {
        bytes memory b = bytes(s);
        // Worst-case: every byte needs escaping (doubles length).
        bytes memory out = new bytes(b.length * 2);
        uint256 j = 0;
        for (uint256 i = 0; i < b.length; i++) {
            bytes1 c = b[i];
            if (c == 0x22 /* " */ || c == 0x5c /* \ */ ) {
                out[j++] = 0x5c; // backslash
                out[j++] = c;
            } else {
                out[j++] = c;
            }
        }
        // Trim to actual length.
        bytes memory trimmed = new bytes(j);
        for (uint256 k = 0; k < j; k++) trimmed[k] = out[k];
        return string(trimmed);
    }

    // ---------------------------------------------------------------------
    // SVG rendering
    // ---------------------------------------------------------------------

    function _renderSVG(uint256 tokenId, Vault memory v) internal view returns (string memory) {
        // Split into smaller helpers to avoid stack-too-deep.
        string memory header = _svgHeader(v.category);
        string memory body = _svgBody(tokenId, v);
        string memory icon = _svgIcon(v.category);
        string memory footer = _svgFooter(v);
        return string(abi.encodePacked(header, icon, body, footer, "</svg>"));
    }

    function _svgHeader(uint8 category) internal pure returns (string memory) {
        // Pick a per-category gradient palette.
        (string memory c1, string memory c2) = _palette(category);
        return string(
            abi.encodePacked(
                '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 600">',
                "<defs>",
                '<linearGradient id="g" x1="0" y1="0" x2="1" y2="1">',
                '<stop offset="0%" stop-color="',
                c1,
                '"/>',
                '<stop offset="100%" stop-color="',
                c2,
                '"/>',
                "</linearGradient>",
                "</defs>",
                '<rect width="400" height="600" rx="24" fill="url(#g)"/>',
                '<text x="24" y="44" fill="#ffffff" font-family="monospace" font-size="18" font-weight="700">LeftClaw VaultID</text>'
            )
        );
    }

    function _svgBody(uint256 tokenId, Vault memory v) internal view returns (string memory) {
        return string(
            abi.encodePacked(
                '<text x="24" y="72" fill="#ffffffcc" font-family="monospace" font-size="13">#',
                tokenId.toString(),
                " | ",
                _safeCategoryLabel(v.category),
                "</text>",
                '<text x="24" y="430" fill="#ffffffcc" font-family="monospace" font-size="11">Holder</text>',
                '<text x="24" y="450" fill="#ffffff" font-family="monospace" font-size="12">',
                _shortAddr(v.holder),
                "</text>",
                '<text x="24" y="478" fill="#ffffffcc" font-family="monospace" font-size="11">Backup</text>',
                '<text x="24" y="498" fill="#ffffff" font-family="monospace" font-size="12">',
                _shortAddr(v.backupWallet),
                "</text>"
            )
        );
    }

    function _svgFooter(Vault memory v) internal pure returns (string memory) {
        string memory expiresLine = v.expiresAt == 0
            ? "Expires: Never"
            : string(abi.encodePacked("Expires: ", uint256(v.expiresAt).toString()));

        // BURNED overlay if soft-burned.
        string memory overlay = v.active
            ? ""
            : string(
                abi.encodePacked(
                    '<rect x="0" y="0" width="400" height="600" fill="#000000aa"/>',
                    '<text x="200" y="310" text-anchor="middle" fill="#ff5555" font-family="monospace" font-size="48" font-weight="700" transform="rotate(-20 200 310)">BURNED</text>'
                )
            );

        return string(
            abi.encodePacked(
                '<text x="24" y="540" fill="#ffffffcc" font-family="monospace" font-size="11">',
                expiresLine,
                "</text>",
                '<text x="24" y="558" fill="#ffffff99" font-family="monospace" font-size="10">soulbound \xE2\x80\xA2 erc-5192</text>',
                overlay
            )
        );
    }

    function _palette(uint8 category) internal pure returns (string memory, string memory) {
        // 6 distinct palettes, one per category.
        if (category == 0) return ("#1f2937", "#4f46e5"); // Personal — slate/indigo
        if (category == 1) return ("#0f172a", "#0ea5e9"); // Business — navy/sky
        if (category == 2) return ("#0b1023", "#22d3ee"); // Developer — deep/teal
        if (category == 3) return ("#1a0b2e", "#a855f7"); // Validator — violet
        if (category == 4) return ("#1c1917", "#f59e0b"); // Treasury — gold
        return ("#0a1f0c", "#22c55e"); // Community — green
    }

    function _svgIcon(uint8 category) internal pure returns (string memory) {
        // Small monochrome glyph centered around (200, 220), 96x96 box.
        // Each category gets a distinct pictogram.
        string memory g; // glyph element(s)
        if (category == 0) {
            // Personal — person silhouette
            g = string(
                abi.encodePacked(
                    '<circle cx="200" cy="190" r="28" fill="#ffffff"/>',
                    '<path d="M152 280 q48 -56 96 0 v32 h-96 z" fill="#ffffff"/>'
                )
            );
        } else if (category == 1) {
            // Business — briefcase
            g = string(
                abi.encodePacked(
                    '<rect x="160" y="190" width="80" height="60" rx="6" fill="#ffffff"/>',
                    '<rect x="184" y="178" width="32" height="14" rx="3" fill="#ffffff"/>',
                    '<rect x="160" y="216" width="80" height="4" fill="#00000033"/>'
                )
            );
        } else if (category == 2) {
            // Developer — angle brackets </>
            g = '<text x="200" y="240" text-anchor="middle" fill="#ffffff" font-family="monospace" font-size="56" font-weight="700">&lt;/&gt;</text>';
        } else if (category == 3) {
            // Validator — shield with check
            g = string(
                abi.encodePacked(
                    '<path d="M200 170 l40 14 v40 q0 36 -40 56 q-40 -20 -40 -56 v-40 z" fill="#ffffff"/>',
                    '<path d="M180 222 l14 14 l28 -28" stroke="#1a0b2e" stroke-width="6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'
                )
            );
        } else if (category == 4) {
            // Treasury — coin stack
            g = string(
                abi.encodePacked(
                    '<ellipse cx="200" cy="200" rx="48" ry="14" fill="#ffffff"/>',
                    '<rect x="152" y="200" width="96" height="20" fill="#ffffff"/>',
                    '<ellipse cx="200" cy="220" rx="48" ry="14" fill="#ffffff"/>',
                    '<rect x="152" y="220" width="96" height="20" fill="#ffffffcc"/>',
                    '<ellipse cx="200" cy="240" rx="48" ry="14" fill="#ffffffcc"/>'
                )
            );
        } else {
            // Community — three connected dots
            g = string(
                abi.encodePacked(
                    '<circle cx="172" cy="216" r="14" fill="#ffffff"/>',
                    '<circle cx="228" cy="216" r="14" fill="#ffffff"/>',
                    '<circle cx="200" cy="172" r="14" fill="#ffffff"/>',
                    '<line x1="172" y1="216" x2="228" y2="216" stroke="#ffffff" stroke-width="4"/>',
                    '<line x1="172" y1="216" x2="200" y2="172" stroke="#ffffff" stroke-width="4"/>',
                    '<line x1="228" y1="216" x2="200" y2="172" stroke="#ffffff" stroke-width="4"/>'
                )
            );
        }
        return g;
    }

    function _shortAddr(address a) internal pure returns (string memory) {
        bytes memory full = bytes(a.toHexString());
        // 0x + 4 + 3 dots + 4 = 13 chars total in the output buffer.
        bytes memory out = new bytes(13);
        out[0] = "0";
        out[1] = "x";
        for (uint256 i = 0; i < 4; i++) out[2 + i] = full[2 + i];
        out[6] = ".";
        out[7] = ".";
        out[8] = ".";
        for (uint256 i = 0; i < 4; i++) out[9 + i] = full[full.length - 4 + i];
        return string(out);
    }
}

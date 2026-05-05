# NEXT_STEPS — VaultID

This file lists everything the worker did NOT ship in Stage 6 and what the
client needs to do to make VaultID fully production-ready.

## Client provisioning required (out of scope for the worker)

1. **Pinata account + JWT** — sign up at <https://pinata.cloud>, mint a JWT with
   permissions `pinFileToIPFS` and `pinJSONToIPFS`, store it as a Worker
   secret named `PINATA_JWT` (see `worker/README.md`). The JWT must never be
   exposed in the static bundle in production.

2. **Cloudflare Worker** — follow `worker/README.md` to deploy the upload
   proxy to your own subdomain. After deploy, set
   `NEXT_PUBLIC_WORKER_URL=https://<your-worker>` in
   `packages/nextjs/.env.local` and rebuild the static bundle. The worker
   verifies CLAWD allowance before forwarding to Pinata; without it, the dApp
   either runs in DEV MODE (direct Pinata, JWT exposed) or refuses to upload.

3. **Alchemy key** — already used by the frontend. The Worker also needs one
   for `eth_call` to Base. A free key from <https://dashboard.alchemy.com> is
   sufficient.

4. **CV token** — the contract's `cvToken` is `address(0)` at deploy time.
   Until the owner calls `setCvToken(<address>)`, the CV mint path is disabled
   in the UI. The contract enforces `CvTokenNotSet` revert.

5. **NEXT_PUBLIC_PRODUCTION_URL** — set this to the absolute origin where the
   static export is served (e.g. `https://vaultid.example.eth.limo` or the
   bgipfs gateway URL). It feeds OG/Twitter image absolute URLs.

## Punted features (in spec but not shipped)

| Feature | Why it was punted | Where it should land |
|---|---|---|
| **Canvas-based image redaction** (HTML5 brush blackout / blur, destructive bake before encryption) | Adds a multi-component editor; the encryption pipeline is the higher-leverage win for this stage | New `/redact` route + `<RedactCanvas/>` component that operates on a `File` and returns a redacted `File` to feed into Step 1 of `/create` |
| **"Download All" zip** on `/vault` | Requires JSZip dep + bulk decrypt UX; single-vault download already works | Add `jszip` and a `<DownloadAll/>` button that iterates the user's vaults, decrypts each, and zips the file outputs |
| **Auto-detect backup pubkey from on-chain tx history** | Adds a multi-RPC hunt across multiple chains and a complex UX fallback chain | Use Etherscan/Alchemy `eth_getTransactionByHash` for a discovered tx the backup wallet sent, recover pubkey from the signature. Today users paste a backup signature instead — this is documented inside the Create form. |
| **Pass mode fullscreen API** | Shipped a fixed-overlay version that works on mobile and desktop without permissions; native fullscreen would be one extra request | Wrap the current `<PassMode/>` component in `requestFullscreen()` and exit on Escape |
| **Settings page** | Footer + connect button cover the read-only essentials for now | New `/settings` route with: connected wallet, derived vault key fingerprint, "forget keys" button |
| **In-app CV mint UI** | CV token is `address(0)` so the path is unavailable until the client calls `setCvToken`. Once set, `/create` already has CLAWD support — adding a CV toggle is ~30 lines | Toggle in `/create` between "pay with CLAWD" and "pay with CV"; check `cvMintFee` and switch the contract call |

## Frontend QA — items the worker pre-emptively addressed

The Stage 7 ship-blocker checklist (see `CLAUDE.md`) was applied during
implementation:

- ✓ Wallet connect button (RainbowKit), not text
- ✓ Wrong-network state shows a "Switch to Base" button via `<ConnectGate/>`
- ✓ Approve button stays disabled through receipt + a 1.5s allowance cooldown
- ✓ Approve flow traced: `approve(VAULTID, fee)` → VaultID calls
  `transferFrom(holder, feeRecipient, fee)` → frontend `allowance(holder,
  VAULTID)` matches that spender. ABI for CLAWD includes all OZ v5 ERC-20
  custom errors so reverts decode.
- ✓ SE2 footer branding (Fork me, BuidlGuidl, Support, `nativeCurrencyPrice`
  badge) replaced with VaultID footer
- ✓ Tab title template updated to `%s | VaultID`
- ✓ Favicon replaced with VaultID gold lock SVG
- ✓ README + thumbnail replaced
- ✓ Phantom wallet added to RainbowKit list
- ✓ `appName` in `wagmiConnectors.tsx` set to `"VaultID"`
- ✓ `--radius-field` set to `0.5rem` in both theme blocks
- ✓ `<Address/>` displayed in footer with Basescan link
- ✓ `OG image` uses `NEXT_PUBLIC_PRODUCTION_URL` first
- ✓ Errors decoded via `getParsedErrorWithAllAbis` against VaultID + CLAWD ABIs
- ✓ `/blockexplorer` renamed to `_blockexplorer-disabled` for static export
- ✓ `polyfill-localstorage.cjs` placed at `packages/nextjs/`
- ✓ Pre-existing `useScaffoldEventHistory.ts:132` TS error fixed
- ✓ All token amounts include "CLAWD is a community token. USD value: N/A."
  context (CLAWD has no Uniswap pool / official price feed)

## Mobile deep-linking

The `writeAndOpen` pattern (fire TX, then `setTimeout(openWallet, 2000)`) was
not wired in the current build because RainbowKit's mobile flow already opens
the wallet on a TX request. If you see mobile users miss the wallet handoff in
practice, wrap `writeContractAsync` calls in a helper that also fires
`window.location.href = "metamask://"` (or the corresponding deep link) after
2000ms.

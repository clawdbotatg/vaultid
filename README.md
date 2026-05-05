# VaultID

**Proof, passes, and memories — privately yours.**

VaultID is a soulbound, end-to-end encrypted vault on Base. Mint a token that
holds files + a private note. Only the holder (and an optional backup wallet)
can decrypt; anyone can publicly verify category, expiry, and integrity.

- **Soulbound** ERC-721 — non-transferable on-chain
- **AES-256-GCM** content + **ECIES (secp256k1 + HKDF + AES-GCM)** wrapped keys
- **CLAWD** mint fee — payable from the holder's wallet
- **Cloudflare Worker** uploads ciphertext to **Pinata**; the JWT never reaches the browser
- **IPFS-deployable** static export — the dApp itself runs without a backend

## Stack

- Smart contract: `packages/foundry/contracts/VaultID.sol`
- Frontend: `packages/nextjs/` (Next.js App Router, RainbowKit, Wagmi, Viem, TailwindCSS + DaisyUI)
- Upload proxy: `worker/` (Cloudflare Worker — TypeScript, deployed via `wrangler`)
- Deployment target: Base mainnet (chain id `8453`)

## Live deployment

| | Address |
|---|---|
| VaultID | [`0x6252F44e1C92F3dD614B11Cc6e8699a8cCf26558`](https://basescan.org/address/0x6252F44e1C92F3dD614B11Cc6e8699a8cCf26558) (verified) |
| CLAWD (Base) | [`0x9f86dB9fc6f7c9408e8Fda3Ff8ce4e78ac7a6b07`](https://basescan.org/address/0x9f86dB9fc6f7c9408e8Fda3Ff8ce4e78ac7a6b07) |
| Owner | `0xFE968dE21eb0E77d5877477C31a04A3075c0086E` |

## Quickstart

```bash
yarn install
# Configure your env (see packages/nextjs/.env.example)
cp packages/nextjs/.env.example packages/nextjs/.env.local

# Static export (production build for IPFS)
cd packages/nextjs
NEXT_PUBLIC_IPFS_BUILD=true NODE_OPTIONS="--require ./polyfill-localstorage.cjs" yarn build

# Output: packages/nextjs/out/
```

## How encryption works (one paragraph)

Each user wallet derives a deterministic vault keypair on first sign-in: the
wallet signs a fixed message (`PRIMARY_KEY_AUTH_MESSAGE`); we hash that
signature into a secp256k1 scalar that becomes the vault private key. The
public key is used as the recipient for ECIES. Per-vault, we generate a fresh
AES-256-GCM key, encrypt the bundle, then ECIES-wrap the AES key once per
recipient (holder + optional backup). The wrapped envelope is JSON-encoded and
uploaded to IPFS via the Worker. `keccak256(plaintext bundle)` is published
on-chain as `contentHash` so anyone can later prove integrity if the holder
chooses to reveal.

## Crypto details

| | |
|---|---|
| Wrap | secp256k1 ECDH → HKDF-SHA256("VaultID/ECIES/v1", 32) → AES-256-GCM |
| Bundle | AES-256-GCM (96-bit nonce, fresh per vault) |
| Hash | keccak256 of the JSON-encoded plaintext bundle bytes |
| Key derivation | sha256(walletSig) reduced into secp256k1 [1, n) |

The wallet's real signing key is never exposed; everything happens client-side
in the browser.

## Configure the Worker

Without a Cloudflare Worker, the dApp falls back to direct Pinata uploads
using `NEXT_PUBLIC_PINATA_JWT` — useful for local testing only, since that
JWT would be embedded in the static bundle.

For production, see `worker/README.md`. You'll set:

- `PINATA_JWT` (Worker secret)
- `ALCHEMY_API_KEY` (Worker secret) — used for Base RPC
- `FRONTEND_ORIGIN` (Worker var) — CORS origin (e.g. your IPFS gateway URL)
- `VAULTID_ADDRESS`, `CLAWD_ADDRESS`, `MIN_ALLOWANCE_WEI` (Worker vars)

Then in the frontend env: `NEXT_PUBLIC_WORKER_URL=https://<your-worker>`.

## Routes

| Path | Description |
|---|---|
| `/` | Landing page |
| `/create` | Encrypt + mint (requires connect + sign) |
| `/vault` | List of vaults you hold |
| `/vault/view?id=N` | Open vault N (decrypt locally) |
| `/verify?id=N` | Public verification (no wallet required) |

## Known gaps

See `NEXT_STEPS.md`.

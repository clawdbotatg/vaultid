# VaultID Upload Worker

A Cloudflare Worker that gates encrypted-bundle uploads to Pinata on a CLAWD
allowance check, so the Pinata JWT never reaches a browser.

## What it does

1. Receives an HTTPS POST from the VaultID frontend with:
   - `envelope` — the encrypted bundle JSON
   - `callerAddress` — the user's wallet
   - `message` — the canonical auth message (anti-replay)
   - `signature` — EIP-191 signature over `message`
2. Verifies the signature recovers to `callerAddress`.
3. `eth_call`s `CLAWD.allowance(callerAddress, VAULTID_ADDRESS)` on Base via
   Alchemy. If allowance < required, returns 402.
4. Forwards the envelope to Pinata `pinFileToIPFS` with `PINATA_JWT`.
5. Returns `{ cid }`.

CORS is restricted to `FRONTEND_ORIGIN` (set via `wrangler.toml [vars]` or
`wrangler deploy --var FRONTEND_ORIGIN=...`).

## Deploy (one-time)

```bash
# 1. Install wrangler
npm install -g wrangler

# 2. Authenticate to your Cloudflare account
wrangler login

# 3. From this directory, install local deps
yarn install
# or: npm install

# 4. Set secrets (NEVER commit these)
wrangler secret put PINATA_JWT
# Paste your Pinata JWT when prompted.

wrangler secret put ALCHEMY_API_KEY
# Paste your Alchemy API key when prompted.

# 5. Edit wrangler.toml [vars]:
#    - FRONTEND_ORIGIN: the absolute origin where your frontend lives
#      (e.g. "https://<cid>.ipfs.community.bgipfs.com" or your ENS gateway)
#    - VAULTID_ADDRESS, CLAWD_ADDRESS: pre-filled to the deployed values
#    - MIN_ALLOWANCE_WEI: 0 to look up clawdMintFee live, or a fixed wei value

# 6. Deploy
wrangler deploy

# Note the URL — set it as NEXT_PUBLIC_WORKER_URL in the frontend .env.local
# and rebuild the static bundle.
```

## Test the deploy

```bash
# Health check
curl https://<your-worker-url>/

# Should return: {"ok":true,"vault":"0x6252F4…","clawd":"0x9f86…"}
```

## Update secrets later

```bash
wrangler secret put PINATA_JWT      # replace
wrangler secret list                # see what's set
```

## Local development

```bash
yarn dev
# Worker runs on http://localhost:8787 with wrangler.toml secrets bound.
```

For local dev, add a `.dev.vars` file (not committed) with:

```
PINATA_JWT=...
ALCHEMY_API_KEY=...
```

## Troubleshooting

- **403 origin not allowed** — the request `Origin` header doesn't match
  `FRONTEND_ORIGIN`. Set it to the exact origin of your frontend, including
  scheme + port if non-standard. Use `*` only for testing.
- **402 insufficient CLAWD allowance** — the user must call
  `CLAWD.approve(VAULTID_ADDRESS, fee)` before retrying. The frontend handles
  this automatically.
- **502 mint fee read failed / allowance read failed** — Alchemy key invalid,
  or rate-limited. Rotate the key.
- **CORS in dev** — when you run `yarn dev` and hit the worker from
  `localhost:3000`, set `FRONTEND_ORIGIN=*` in `wrangler.toml [vars]` for the
  dev session, or list `http://localhost:3000` explicitly.

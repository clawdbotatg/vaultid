// VaultID upload Worker
// =======================
// POST /upload
//   body: { envelope, callerAddress, message, signature }
//   - Verifies `signature` recovers to `callerAddress`.
//   - Verifies `message` is the canonical VaultID auth string (anti-replay).
//   - eth_call's CLAWD `allowance(callerAddress, VAULTID_ADDRESS)` on Base.
//     Rejects if allowance < MIN_ALLOWANCE_WEI. If MIN_ALLOWANCE_WEI is 0,
//     looks up VaultID.clawdMintFee() and uses that.
//   - On success, JSON-encodes the envelope and uploads it to Pinata as a
//     file via pinFileToIPFS.
//
// CORS: Only the configured FRONTEND_ORIGIN may POST. OPTIONS pre-flights
// return the same single origin.
//
// Secrets: PINATA_JWT, ALCHEMY_API_KEY (set via `wrangler secret put`).

import { hashMessage, recoverAddress, hexToBigInt, encodeFunctionData, decodeFunctionResult } from "viem";

type Env = {
  PINATA_JWT: string;
  ALCHEMY_API_KEY: string;
  FRONTEND_ORIGIN: string;
  VAULTID_ADDRESS: `0x${string}`;
  CLAWD_ADDRESS: `0x${string}`;
  MIN_ALLOWANCE_WEI: string;
  ALCHEMY_BASE_PATH: string;
};

const PRIMARY_KEY_AUTH_MESSAGE =
  "VaultID — sign once to unlock encrypted access for this device. Replay-safe.";

const ALLOWANCE_ABI = [
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

const MINT_FEE_ABI = [
  {
    type: "function",
    name: "clawdMintFee",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

const cors = (env: Env) => ({
  "access-control-allow-origin": env.FRONTEND_ORIGIN || "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type",
  "access-control-max-age": "86400",
  vary: "Origin",
});

const json = (data: unknown, init: ResponseInit, env: Env) =>
  new Response(JSON.stringify(data), {
    ...init,
    headers: { "content-type": "application/json", ...cors(env), ...(init.headers ?? {}) },
  });

const isAddress = (s: unknown): s is `0x${string}` =>
  typeof s === "string" && /^0x[0-9a-fA-F]{40}$/.test(s);
const isHex = (s: unknown): s is `0x${string}` => typeof s === "string" && /^0x[0-9a-fA-F]*$/.test(s);

async function rpc<T = unknown>(env: Env, method: string, params: unknown[]): Promise<T> {
  const url = `https://${env.ALCHEMY_BASE_PATH}.g.alchemy.com/v2/${env.ALCHEMY_API_KEY}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!res.ok) throw new Error(`RPC ${method} failed: ${res.status}`);
  const j = (await res.json()) as { result?: T; error?: { message: string } };
  if (j.error) throw new Error(`RPC ${method} error: ${j.error.message}`);
  return j.result as T;
}

async function readClawdAllowance(env: Env, owner: `0x${string}`): Promise<bigint> {
  const data = encodeFunctionData({
    abi: ALLOWANCE_ABI,
    functionName: "allowance",
    args: [owner, env.VAULTID_ADDRESS],
  });
  const result = (await rpc<`0x${string}`>(env, "eth_call", [
    { to: env.CLAWD_ADDRESS, data },
    "latest",
  ])) as `0x${string}`;
  return decodeFunctionResult({ abi: ALLOWANCE_ABI, functionName: "allowance", data: result }) as bigint;
}

async function readClawdMintFee(env: Env): Promise<bigint> {
  const data = encodeFunctionData({ abi: MINT_FEE_ABI, functionName: "clawdMintFee" });
  const result = (await rpc<`0x${string}`>(env, "eth_call", [
    { to: env.VAULTID_ADDRESS, data },
    "latest",
  ])) as `0x${string}`;
  return decodeFunctionResult({ abi: MINT_FEE_ABI, functionName: "clawdMintFee", data: result }) as bigint;
}

async function uploadToPinata(env: Env, name: string, jsonContent: unknown): Promise<string> {
  const blob = new Blob([JSON.stringify(jsonContent)], { type: "application/json" });
  const form = new FormData();
  form.append("file", blob, `${name}.json`);
  form.append("pinataMetadata", JSON.stringify({ name: `vaultid-${name}` }));
  const res = await fetch("https://api.pinata.cloud/pinning/pinFileToIPFS", {
    method: "POST",
    headers: { authorization: `Bearer ${env.PINATA_JWT}` },
    body: form,
  });
  if (!res.ok) throw new Error(`Pinata error ${res.status}: ${await res.text().catch(() => "")}`);
  const data = (await res.json()) as { IpfsHash?: string };
  if (!data.IpfsHash) throw new Error("Pinata did not return an IpfsHash.");
  return data.IpfsHash;
}

const isOriginAllowed = (env: Env, originHeader: string | null): boolean => {
  if (!originHeader) return false;
  if (env.FRONTEND_ORIGIN === "*") return true;
  return env.FRONTEND_ORIGIN.split(",").map(s => s.trim()).includes(originHeader);
};

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const origin = req.headers.get("origin");

    // CORS preflight.
    if (req.method === "OPTIONS") {
      if (!isOriginAllowed(env, origin)) {
        return new Response("forbidden", { status: 403 });
      }
      return new Response(null, { status: 204, headers: cors(env) });
    }

    // Health check.
    const url = new URL(req.url);
    if (req.method === "GET" && url.pathname === "/") {
      return json({ ok: true, vault: env.VAULTID_ADDRESS, clawd: env.CLAWD_ADDRESS }, { status: 200 }, env);
    }

    if (req.method !== "POST" || url.pathname !== "/upload") {
      return json({ error: "not found" }, { status: 404 }, env);
    }
    if (!isOriginAllowed(env, origin)) {
      return json({ error: "origin not allowed" }, { status: 403 }, env);
    }

    let body: { envelope?: unknown; callerAddress?: unknown; message?: unknown; signature?: unknown };
    try {
      body = await req.json();
    } catch {
      return json({ error: "invalid json" }, { status: 400 }, env);
    }

    const { envelope, callerAddress, message, signature } = body;
    if (!envelope || typeof envelope !== "object") {
      return json({ error: "envelope missing or not an object" }, { status: 400 }, env);
    }
    if (!isAddress(callerAddress)) return json({ error: "bad callerAddress" }, { status: 400 }, env);
    if (typeof message !== "string") return json({ error: "bad message" }, { status: 400 }, env);
    if (!isHex(signature) || signature.length < 132) return json({ error: "bad signature" }, { status: 400 }, env);

    // Anti-replay: only accept the canonical primary auth message. If you ever
    // change PRIMARY_KEY_AUTH_MESSAGE in the frontend, change it here too.
    if (message !== PRIMARY_KEY_AUTH_MESSAGE) {
      return json({ error: "unrecognized auth message" }, { status: 400 }, env);
    }

    // Verify signature recovers to callerAddress.
    let recovered: `0x${string}`;
    try {
      recovered = await recoverAddress({ hash: hashMessage(message), signature: signature as `0x${string}` });
    } catch (e) {
      return json({ error: "signature recovery failed" }, { status: 400 }, env);
    }
    if (recovered.toLowerCase() !== callerAddress.toLowerCase()) {
      return json({ error: "signature does not match callerAddress" }, { status: 401 }, env);
    }

    // Allowance gate.
    let minWei: bigint;
    try {
      const fixed = (env.MIN_ALLOWANCE_WEI || "0").trim();
      minWei =
        fixed && fixed !== "0"
          ? BigInt(fixed.startsWith("0x") ? hexToBigInt(fixed as `0x${string}`).toString() : fixed)
          : await readClawdMintFee(env);
    } catch (e) {
      return json({ error: `failed to read mint fee: ${(e as Error).message}` }, { status: 502 }, env);
    }

    let allowance: bigint;
    try {
      allowance = await readClawdAllowance(env, callerAddress);
    } catch (e) {
      return json({ error: `failed to read allowance: ${(e as Error).message}` }, { status: 502 }, env);
    }

    if (allowance < minWei) {
      return json(
        {
          error: "insufficient CLAWD allowance",
          required: minWei.toString(),
          actual: allowance.toString(),
          spender: env.VAULTID_ADDRESS,
        },
        { status: 402 },
        env,
      );
    }

    // Forward to Pinata.
    let cid: string;
    try {
      cid = await uploadToPinata(env, `vault-${Date.now().toString(36)}`, envelope);
    } catch (e) {
      return json({ error: `pinata upload failed: ${(e as Error).message}` }, { status: 502 }, env);
    }

    return json({ cid }, { status: 200 }, env);
  },
};

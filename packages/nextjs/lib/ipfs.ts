// VaultID IPFS upload abstraction.
//
// Two modes:
//
// 1) Cloudflare Worker (PROD): the frontend POSTs the encrypted envelope JSON
//    to `${NEXT_PUBLIC_WORKER_URL}/upload` along with a wallet signature
//    proving ownership of the caller. The Worker verifies CLAWD allowance >=
//    mint fee for VaultID on Base, then forwards to Pinata using its private
//    JWT. Returns the CID. This is the safe path; the Pinata JWT never leaves
//    the worker.
//
// 2) Direct Pinata (DEV ONLY): if `NEXT_PUBLIC_WORKER_URL` is empty AND
//    `NEXT_PUBLIC_PINATA_JWT` is set, upload straight to Pinata. The JWT will
//    be embedded in the static bundle — only acceptable for local testing or
//    short-lived demos. The UI flags this clearly as "DEV MODE".
import type { EncryptedEnvelope } from "./crypto";

export type UploadResult = {
  cid: string;
  uri: `ipfs://${string}`;
  mode: "worker" | "direct";
};

export type UploadOptions = {
  callerAddress: `0x${string}`;
  signedAuthMessage: string;
  signature: `0x${string}`;
};

const WORKER_URL = (process.env.NEXT_PUBLIC_WORKER_URL || "").trim();
const PINATA_JWT = (process.env.NEXT_PUBLIC_PINATA_JWT || "").trim();

export const uploadMode = (): "worker" | "direct" | "missing" => {
  if (WORKER_URL) return "worker";
  if (PINATA_JWT) return "direct";
  return "missing";
};

export async function uploadEncryptedEnvelope(envelope: EncryptedEnvelope, opts: UploadOptions): Promise<UploadResult> {
  const mode = uploadMode();
  if (mode === "missing") {
    throw new Error(
      "Upload not configured. Either set NEXT_PUBLIC_WORKER_URL (production) or NEXT_PUBLIC_PINATA_JWT (dev).",
    );
  }
  if (mode === "worker") return uploadViaWorker(envelope, opts);
  return uploadDirect(envelope);
}

// -- Worker mode -------------------------------------------------------------

async function uploadViaWorker(envelope: EncryptedEnvelope, opts: UploadOptions): Promise<UploadResult> {
  const body = {
    envelope, // server JSON-stringifies + uploads as a file
    callerAddress: opts.callerAddress,
    message: opts.signedAuthMessage,
    signature: opts.signature,
  };
  const url = new URL("/upload", WORKER_URL).toString();
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Worker upload failed (${res.status}): ${txt || res.statusText}`);
  }
  const json = (await res.json()) as { cid?: string; error?: string };
  if (!json.cid) throw new Error(json.error ?? "Worker did not return a CID.");
  return { cid: json.cid, uri: `ipfs://${json.cid}`, mode: "worker" };
}

// -- Direct mode (dev only) --------------------------------------------------

async function uploadDirect(envelope: EncryptedEnvelope): Promise<UploadResult> {
  // Pinata pinFileToIPFS endpoint accepts multipart/form-data.
  const blob = new Blob([JSON.stringify(envelope)], { type: "application/json" });
  const form = new FormData();
  form.append("file", blob, "vault.json");
  form.append("pinataMetadata", JSON.stringify({ name: "vaultid-encrypted-bundle" }));
  const res = await fetch("https://api.pinata.cloud/pinning/pinFileToIPFS", {
    method: "POST",
    headers: { authorization: `Bearer ${PINATA_JWT}` },
    body: form,
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Pinata upload failed (${res.status}): ${txt || res.statusText}`);
  }
  const json = (await res.json()) as { IpfsHash?: string };
  if (!json.IpfsHash) throw new Error("Pinata did not return an IpfsHash.");
  return { cid: json.IpfsHash, uri: `ipfs://${json.IpfsHash}`, mode: "direct" };
}

// -- Read helper -------------------------------------------------------------

const PUBLIC_GATEWAYS = [
  "https://gateway.pinata.cloud/ipfs/",
  "https://cloudflare-ipfs.com/ipfs/",
  "https://ipfs.io/ipfs/",
  "https://nftstorage.link/ipfs/",
];

export async function fetchEncryptedEnvelope(uri: string): Promise<EncryptedEnvelope> {
  const cid = uri.startsWith("ipfs://") ? uri.slice("ipfs://".length) : uri;
  let lastErr: unknown;
  for (const gw of PUBLIC_GATEWAYS) {
    try {
      const res = await fetch(`${gw}${cid}`);
      if (!res.ok) {
        lastErr = new Error(`${gw}${cid} → ${res.status}`);
        continue;
      }
      return (await res.json()) as EncryptedEnvelope;
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error(`Failed to fetch encrypted bundle from any public IPFS gateway. Last error: ${String(lastErr)}`);
}

// VaultID domain helpers — categories, tokenURI decoding, status pills.
import deployedContracts from "~~/contracts/deployedContracts";

export const VAULTID_ADDRESS = deployedContracts[8453].VaultID.address as `0x${string}`;
export const CLAWD_ADDRESS = "0x9f86dB9fc6f7c9408e8Fda3Ff8ce4e78ac7a6b07" as const;
export const VAULTID_ABI = deployedContracts[8453].VaultID.abi;

// Mirror the on-chain enum order. The contract uses uint8 0..5.
export const CATEGORIES = ["Pass", "Receipt", "Certificate", "Identity", "Memory", "Other"] as const;
export type Category = (typeof CATEGORIES)[number];

export const categoryFromIndex = (i: number): Category => {
  return (CATEGORIES[i] ?? "Other") as Category;
};

export const indexFromCategory = (c: Category): number => {
  const i = CATEGORIES.indexOf(c);
  return i < 0 ? 5 : i;
};

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;

// A `Vault` struct mirroring `getVault(tokenId)`.
export type OnChainVault = {
  holder: `0x${string}`;
  backupWallet: `0x${string}`;
  category: number;
  mintedAt: bigint;
  expiresAt: bigint;
  active: boolean;
  encryptedContentURI: string;
  contentHash: `0x${string}`;
};

export type VaultStatus = "active" | "expired" | "burned";

export const vaultStatus = (v: OnChainVault, nowSec: number = Math.floor(Date.now() / 1000)): VaultStatus => {
  if (!v.active) return "burned";
  if (v.expiresAt > 0n && Number(v.expiresAt) <= nowSec) return "expired";
  return "active";
};

// Decode `data:application/json;base64,...` tokenURI returned by VaultID.
export type TokenMetadata = {
  name?: string;
  description?: string;
  image?: string;
  attributes?: Array<{ trait_type: string; value: string | number }>;
};

export const decodeTokenURI = (uri: string): TokenMetadata | null => {
  try {
    const prefix = "data:application/json;base64,";
    if (!uri.startsWith(prefix)) {
      // Could be a plain http/ipfs URI; we don't fetch here.
      return null;
    }
    const b64 = uri.slice(prefix.length);
    const jsonStr = typeof atob === "function" ? atob(b64) : Buffer.from(b64, "base64").toString("utf-8");
    return JSON.parse(jsonStr) as TokenMetadata;
  } catch {
    return null;
  }
};

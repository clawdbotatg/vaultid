"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { NextPage } from "next";
import { base } from "viem/chains";
import { useAccount, usePublicClient, useReadContract } from "wagmi";
import { ConnectGate } from "~~/components/ConnectGate";
import {
  OnChainVault,
  VAULTID_ABI,
  VAULTID_ADDRESS,
  categoryFromIndex,
  decodeTokenURI,
  vaultStatus,
} from "~~/lib/vault";

const StatusPill = ({ status }: { status: "active" | "expired" | "burned" }) => {
  if (status === "active") return <span className="vault-pill border-success/40 text-success">Active</span>;
  if (status === "expired") return <span className="vault-pill border-warning/40 text-warning">Expired</span>;
  return <span className="vault-pill border-error/40 text-error">Burned</span>;
};

type VaultEntry = {
  tokenId: bigint;
  vault: OnChainVault;
  imageDataUri?: string;
};

const Page: NextPage = () => (
  <main className="max-w-5xl mx-auto px-4 py-10">
    <header className="mb-8 flex flex-col md:flex-row md:items-end md:justify-between gap-3">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">My vault</h1>
        <p className="opacity-70 m-0">All vaults you currently hold on Base.</p>
      </div>
      <Link href="/create" className="btn btn-primary btn-md">
        + New vault
      </Link>
    </header>
    <ConnectGate>
      <VaultList />
    </ConnectGate>
  </main>
);

const VaultList = () => {
  const { address } = useAccount();
  const publicClient = usePublicClient({ chainId: base.id });
  const { data: totalMinted } = useReadContract({
    address: VAULTID_ADDRESS,
    abi: VAULTID_ABI,
    functionName: "totalMinted",
    chainId: base.id,
  });
  const total = (totalMinted as bigint | undefined) ?? 0n;

  const [entries, setEntries] = useState<VaultEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!address || !publicClient || total === 0n) {
      setEntries([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      const myAddr = address.toLowerCase();
      // Walk the existing tokenIds (1..total). We use multicall via viem.
      const totalNum = Number(total);
      const ids = Array.from({ length: totalNum }, (_, i) => BigInt(i + 1));
      // Multicall: ownerOf for each (will revert if burned; treat as "not mine").
      const owners = await publicClient.multicall({
        contracts: ids.map(id => ({
          address: VAULTID_ADDRESS,
          abi: VAULTID_ABI,
          functionName: "ownerOf" as const,
          args: [id] as const,
        })),
        allowFailure: true,
      });
      const myIds = ids.filter((_, i) => {
        const r = owners[i];
        return r.status === "success" && (r.result as `0x${string}`).toLowerCase() === myAddr;
      });
      if (myIds.length === 0) {
        if (!cancelled) {
          setEntries([]);
          setLoading(false);
        }
        return;
      }
      const [vaults, tokenURIs] = await Promise.all([
        publicClient.multicall({
          contracts: myIds.map(id => ({
            address: VAULTID_ADDRESS,
            abi: VAULTID_ABI,
            functionName: "getVault" as const,
            args: [id] as const,
          })),
          allowFailure: false,
        }),
        publicClient.multicall({
          contracts: myIds.map(id => ({
            address: VAULTID_ADDRESS,
            abi: VAULTID_ABI,
            functionName: "tokenURI" as const,
            args: [id] as const,
          })),
          allowFailure: true,
        }),
      ]);
      const out: VaultEntry[] = myIds.map((tokenId, idx) => {
        const v = vaults[idx] as unknown as OnChainVault;
        const u = tokenURIs[idx];
        const meta = u.status === "success" ? decodeTokenURI(u.result as string) : null;
        return { tokenId, vault: v, imageDataUri: meta?.image };
      });
      if (!cancelled) {
        // newest first
        out.sort((a, b) => Number(b.tokenId - a.tokenId));
        setEntries(out);
        setLoading(false);
      }
    })().catch(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [address, publicClient, total]);

  if (loading) {
    return <div className="vault-card-muted p-6 text-center text-sm opacity-70">Loading your vaults…</div>;
  }
  if (entries.length === 0) {
    return (
      <div className="vault-card p-8 text-center">
        <h2 className="text-xl font-semibold mb-2">No vaults yet</h2>
        <p className="opacity-70 mb-5 text-sm">Create your first encrypted vault and it will appear here.</p>
        <Link href="/create" className="btn btn-primary btn-md">
          Create a vault
        </Link>
      </div>
    );
  }

  return (
    <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {entries.map(e => (
        <VaultCard key={e.tokenId.toString()} entry={e} />
      ))}
    </div>
  );
};

const VaultCard = ({ entry }: { entry: VaultEntry }) => {
  const status = vaultStatus(entry.vault);
  const category = categoryFromIndex(entry.vault.category);
  const minted = useMemo(
    () => (entry.vault.mintedAt > 0n ? new Date(Number(entry.vault.mintedAt) * 1000).toLocaleDateString() : "—"),
    [entry.vault.mintedAt],
  );
  return (
    <Link
      href={`/vault/view?id=${entry.tokenId.toString()}`}
      className="vault-card p-4 hover:vault-glow transition-shadow"
    >
      <div className="aspect-square w-full bg-base-200 rounded-md overflow-hidden flex items-center justify-center">
        {entry.imageDataUri ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={entry.imageDataUri} alt={`Vault #${entry.tokenId}`} className="w-full h-full object-contain" />
        ) : (
          <div className="text-xs opacity-50">no preview</div>
        )}
      </div>
      <div className="mt-3 flex items-center justify-between gap-2">
        <span className="font-semibold">Vault #{entry.tokenId.toString()}</span>
        <StatusPill status={status} />
      </div>
      <div className="mt-2 flex items-center justify-between text-xs opacity-70">
        <span>{category}</span>
        <span>Minted {minted}</span>
      </div>
    </Link>
  );
};

export default Page;

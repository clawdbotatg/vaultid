"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Address } from "@scaffold-ui/components";
import type { NextPage } from "next";
import { base } from "viem/chains";
import { useReadContract } from "wagmi";
import { OnChainVault, VAULTID_ABI, VAULTID_ADDRESS, categoryFromIndex, vaultStatus } from "~~/lib/vault";

const Page: NextPage = () => (
  <main className="max-w-3xl mx-auto px-4 py-10">
    <Suspense fallback={<p className="opacity-70 text-sm">Loading…</p>}>
      <VerifyWrapper />
    </Suspense>
  </main>
);

const VerifyWrapper = () => {
  const sp = useSearchParams();
  const router = useRouter();
  const initial = sp.get("id") ?? "";
  const [draft, setDraft] = useState(initial);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (/^\d+$/.test(draft)) router.push(`/verify?id=${draft}`);
  };

  return (
    <>
      <header className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight">Verify a vault</h1>
        <p className="opacity-70 m-0">
          Confirm a vault&rsquo;s authenticity, category, expiry, and integrity. Public, no wallet required.
        </p>
      </header>
      <form onSubmit={submit} className="vault-card p-4 mb-6 flex gap-2 items-center">
        <input
          className="vault-input flex-1"
          placeholder="Vault token id, e.g. 1"
          inputMode="numeric"
          pattern="[0-9]*"
          value={draft}
          onChange={e => setDraft(e.target.value.replace(/[^0-9]/g, ""))}
        />
        <button className="btn btn-primary btn-md" type="submit" disabled={!/^\d+$/.test(draft)}>
          Verify
        </button>
      </form>
      {initial && /^\d+$/.test(initial) ? <VerifyResult tokenId={BigInt(initial)} /> : null}
    </>
  );
};

const VerifyResult = ({ tokenId }: { tokenId: bigint }) => {
  const { data, error, isLoading } = useReadContract({
    address: VAULTID_ADDRESS,
    abi: VAULTID_ABI,
    functionName: "getVault",
    args: [tokenId],
    chainId: base.id,
  });

  if (isLoading) {
    return (
      <div className="vault-card-muted p-6 text-sm opacity-70 text-center">Loading vault #{tokenId.toString()}…</div>
    );
  }
  if (error) {
    return (
      <div className="vault-card p-6">
        <h2 className="text-lg font-semibold m-0 mb-2">Vault not found</h2>
        <p className="text-sm opacity-70 m-0">Token id {tokenId.toString()} is not registered on Base.</p>
      </div>
    );
  }
  const vault = data as OnChainVault;
  const status = vaultStatus(vault);
  const category = categoryFromIndex(vault.category);
  const isLive = status === "active";

  return (
    <div className="vault-card p-6">
      <header className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h2 className="text-2xl font-bold m-0">Vault #{tokenId.toString()}</h2>
          <p className="opacity-70 m-0 text-sm">
            On Base · contract{" "}
            <a
              href={`https://basescan.org/address/${VAULTID_ADDRESS}`}
              target="_blank"
              rel="noreferrer"
              className="link vault-gold"
            >
              {VAULTID_ADDRESS.slice(0, 6)}…{VAULTID_ADDRESS.slice(-4)} ↗
            </a>
          </p>
        </div>
        <StatusBadge status={status} />
      </header>
      <div className="vault-divider mb-4" />
      <dl className="grid sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
        <Pair label="Status">{isLive ? "Active" : status === "expired" ? "Expired" : "Burned"}</Pair>
        <Pair label="Category">{category}</Pair>
        <Pair label="Holder">
          <Address address={vault.holder} chain={base} format="short" />
        </Pair>
        <Pair label="Backup wallet">
          {vault.backupWallet === "0x0000000000000000000000000000000000000000" ? (
            <span className="opacity-60">none</span>
          ) : (
            <Address address={vault.backupWallet} chain={base} format="short" />
          )}
        </Pair>
        <Pair label="Minted">
          {vault.mintedAt > 0n ? new Date(Number(vault.mintedAt) * 1000).toLocaleString() : "—"}
        </Pair>
        <Pair label="Expires">
          {vault.expiresAt > 0n ? new Date(Number(vault.expiresAt) * 1000).toLocaleString() : "perpetual"}
        </Pair>
        <Pair label="Content hash" full>
          <span className="text-xs break-all opacity-80">{vault.contentHash}</span>
        </Pair>
      </dl>
      <div className="vault-card-muted p-3 mt-5 text-xs opacity-80">
        <strong className="vault-gold">Note:</strong> verification reads on-chain state only. Encrypted contents stay on
        IPFS and can only be opened by the holder or backup wallet.
      </div>
      <div className="mt-4 flex justify-end">
        <Link href="/" className="link link-hover text-sm">
          ← back to home
        </Link>
      </div>
    </div>
  );
};

const StatusBadge = ({ status }: { status: "active" | "expired" | "burned" }) => {
  if (status === "active") return <span className="vault-pill border-success/40 text-success font-medium">Active</span>;
  if (status === "expired")
    return <span className="vault-pill border-warning/40 text-warning font-medium">Expired</span>;
  return <span className="vault-pill border-error/40 text-error font-medium">Burned</span>;
};

const Pair = ({ label, children, full = false }: { label: string; children: React.ReactNode; full?: boolean }) => (
  <div className={full ? "sm:col-span-2" : ""}>
    <dt className="text-xs opacity-60 uppercase tracking-wide">{label}</dt>
    <dd className="m-0 mt-1">{children}</dd>
  </div>
);

export default Page;

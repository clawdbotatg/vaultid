"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Address } from "@scaffold-ui/components";
import type { NextPage } from "next";
import { base } from "viem/chains";
import { useAccount, usePublicClient, useReadContract, useWriteContract } from "wagmi";
import { ConnectGate } from "~~/components/ConnectGate";
import { useVaultKey } from "~~/components/VaultKeyProvider";
import { EncryptedFile, PlaintextBundle, decryptBundle, encryptedFileToBlob } from "~~/lib/crypto";
import { fetchEncryptedEnvelope } from "~~/lib/ipfs";
import { OnChainVault, VAULTID_ABI, VAULTID_ADDRESS, categoryFromIndex, vaultStatus } from "~~/lib/vault";
import { notification } from "~~/utils/scaffold-eth";
import { getParsedErrorWithAllAbis } from "~~/utils/scaffold-eth/contract";

const Page: NextPage = () => (
  <main className="max-w-5xl mx-auto px-4 py-10">
    <Suspense fallback={<p className="opacity-70 text-sm">Loading…</p>}>
      <ViewWrapper />
    </Suspense>
  </main>
);

const ViewWrapper = () => {
  const sp = useSearchParams();
  const id = sp.get("id");
  if (!id || !/^\d+$/.test(id)) {
    return (
      <div className="vault-card p-8 text-center max-w-md mx-auto">
        <h1 className="text-xl font-semibold mb-2">Vault not found</h1>
        <p className="opacity-70 text-sm mb-5">
          Provide a valid token id, e.g. <code>?id=1</code>.
        </p>
        <Link href="/vault" className="btn btn-primary btn-md">
          Back to my vault
        </Link>
      </div>
    );
  }
  return (
    <ConnectGate requireUnlock>
      <ViewBody tokenId={BigInt(id)} />
    </ConnectGate>
  );
};

type DecryptState =
  | { phase: "idle" }
  | { phase: "fetching" }
  | { phase: "decrypting" }
  | { phase: "ready"; bundle: PlaintextBundle }
  | { phase: "error"; message: string };

const ViewBody = ({ tokenId }: { tokenId: bigint }) => {
  const router = useRouter();
  const { address } = useAccount();
  const { privKey } = useVaultKey();
  const publicClient = usePublicClient({ chainId: base.id });
  const { writeContractAsync } = useWriteContract();

  const { data: vaultData, refetch: refetchVault } = useReadContract({
    address: VAULTID_ADDRESS,
    abi: VAULTID_ABI,
    functionName: "getVault",
    args: [tokenId],
    chainId: base.id,
  });
  const { data: tokenURI } = useReadContract({
    address: VAULTID_ADDRESS,
    abi: VAULTID_ABI,
    functionName: "tokenURI",
    args: [tokenId],
    chainId: base.id,
  });
  void tokenURI;

  const vault = vaultData as OnChainVault | undefined;

  const [state, setState] = useState<DecryptState>({ phase: "idle" });
  const [showBurnModal, setShowBurnModal] = useState(false);
  const [burnPending, setBurnPending] = useState(false);
  const [passMode, setPassMode] = useState(false);

  // Auto-decrypt once vault + key are available.
  useEffect(() => {
    if (!vault || !privKey || !address) return;
    if (state.phase !== "idle") return;
    let cancelled = false;
    (async () => {
      setState({ phase: "fetching" });
      try {
        const env = await fetchEncryptedEnvelope(vault.encryptedContentURI);
        if (cancelled) return;
        setState({ phase: "decrypting" });
        const bundle = decryptBundle(env, privKey, address as `0x${string}`);
        if (cancelled) return;
        setState({ phase: "ready", bundle });
      } catch (e) {
        if (cancelled) return;
        setState({ phase: "error", message: (e as Error)?.message ?? "Failed to decrypt." });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [vault, privKey, address, state.phase]);

  const status = vault ? vaultStatus(vault) : "active";
  const category = vault ? categoryFromIndex(vault.category) : "Other";

  const burn = async () => {
    if (!publicClient) return;
    setBurnPending(true);
    try {
      const hash = await writeContractAsync({
        address: VAULTID_ADDRESS,
        abi: VAULTID_ABI,
        functionName: "burn",
        args: [tokenId],
        chainId: base.id,
      });
      await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 });
      notification.success("Vault burned.");
      await refetchVault();
      setShowBurnModal(false);
      setTimeout(() => router.push("/vault"), 1200);
    } catch (e) {
      notification.error(getParsedErrorWithAllAbis(e, base.id));
    } finally {
      setBurnPending(false);
    }
  };

  if (!vault) {
    return (
      <div className="vault-card-muted p-6 text-sm opacity-70 text-center">Loading vault #{tokenId.toString()}…</div>
    );
  }

  const isOwner = address && address.toLowerCase() === vault.holder.toLowerCase();

  return (
    <div className="grid lg:grid-cols-[1fr_320px] gap-6">
      <section className="vault-card p-6">
        <header className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div>
            <h1 className="text-2xl font-bold m-0">Vault #{tokenId.toString()}</h1>
            <div className="flex flex-wrap items-center gap-2 mt-1 text-sm opacity-70">
              <span>{category}</span>
              <span>·</span>
              <StatusPill status={status} />
            </div>
          </div>
          {isOwner && state.phase === "ready" && (
            <div className="flex gap-2">
              <button className="btn btn-outline btn-sm" onClick={() => setPassMode(true)}>
                Pass mode
              </button>
              {status !== "burned" && (
                <button className="btn btn-error btn-outline btn-sm" onClick={() => setShowBurnModal(true)}>
                  Burn
                </button>
              )}
            </div>
          )}
        </header>
        <div className="vault-divider mb-6" />
        {!isOwner ? (
          <p className="opacity-80 text-sm">
            You are not the holder of this vault. Use the public verify page to confirm authenticity:{" "}
            <Link href={`/verify?id=${tokenId.toString()}`} className="link vault-gold">
              /verify?id={tokenId.toString()}
            </Link>
            .
          </p>
        ) : state.phase === "fetching" ? (
          <p className="opacity-80 text-sm">Fetching encrypted bundle from IPFS…</p>
        ) : state.phase === "decrypting" ? (
          <p className="opacity-80 text-sm">Decrypting locally…</p>
        ) : state.phase === "error" ? (
          <div className="alert alert-error rounded-lg text-sm">{state.message}</div>
        ) : state.phase === "ready" ? (
          <BundleView bundle={state.bundle} passMode={passMode} onClosePassMode={() => setPassMode(false)} />
        ) : (
          <p className="opacity-60 text-sm">Preparing to decrypt…</p>
        )}
      </section>
      <aside className="space-y-4">
        <div className="vault-card-muted p-4 text-sm">
          <h3 className="font-semibold mb-2">Details</h3>
          <Row label="Holder">
            <Address address={vault.holder} chain={base} format="short" />
          </Row>
          <Row label="Backup">
            {vault.backupWallet === "0x0000000000000000000000000000000000000000" ? (
              <span className="opacity-60">none</span>
            ) : (
              <Address address={vault.backupWallet} chain={base} format="short" />
            )}
          </Row>
          <Row label="Minted">
            {vault.mintedAt > 0n ? new Date(Number(vault.mintedAt) * 1000).toLocaleString() : "—"}
          </Row>
          <Row label="Expiry">
            {vault.expiresAt > 0n ? new Date(Number(vault.expiresAt) * 1000).toLocaleString() : "perpetual"}
          </Row>
          <Row label="Content hash">
            <span className="text-xs break-all opacity-70">{vault.contentHash}</span>
          </Row>
          <Row label="Encrypted URI">
            <span className="text-xs break-all opacity-70">{vault.encryptedContentURI}</span>
          </Row>
        </div>
        <Link href={`/verify?id=${tokenId.toString()}`} className="btn btn-outline btn-md w-full">
          Public verify link ↗
        </Link>
      </aside>

      {showBurnModal && (
        <div className="fixed inset-0 z-30 bg-black/60 flex items-center justify-center p-4">
          <div className="vault-card p-6 max-w-md w-full">
            <h2 className="text-lg font-bold mb-1">Burn this vault?</h2>
            <p className="text-sm opacity-80 m-0">
              Burning is <strong>irreversible</strong>. The token will be marked burned on-chain, and the encrypted
              bundle stays on IPFS forever — but the vault will read as &ldquo;Burned&rdquo; in every UI.
            </p>
            <div className="flex justify-end gap-2 mt-5">
              <button className="btn btn-ghost btn-sm" onClick={() => setShowBurnModal(false)} disabled={burnPending}>
                Cancel
              </button>
              <button className="btn btn-error btn-sm" onClick={burn} disabled={burnPending}>
                {burnPending ? "Burning…" : "Burn permanently"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="flex justify-between gap-3 py-1.5 border-b border-base-content/5 last:border-b-0">
    <span className="opacity-60">{label}</span>
    <span className="text-right max-w-[200px] break-all">{children}</span>
  </div>
);

const StatusPill = ({ status }: { status: "active" | "expired" | "burned" }) => {
  if (status === "active") return <span className="vault-pill border-success/40 text-success">Active</span>;
  if (status === "expired") return <span className="vault-pill border-warning/40 text-warning">Expired</span>;
  return <span className="vault-pill border-error/40 text-error">Burned</span>;
};

const BundleView = ({
  bundle,
  passMode,
  onClosePassMode,
}: {
  bundle: PlaintextBundle;
  passMode: boolean;
  onClosePassMode: () => void;
}) => {
  // Materialize files into blob URLs.
  const blobs = useMemo(
    () =>
      bundle.files.map(f => {
        const blob = encryptedFileToBlob(f);
        return { ...f, url: URL.createObjectURL(blob) };
      }),
    [bundle.files],
  );
  useEffect(() => {
    return () => {
      for (const b of blobs) URL.revokeObjectURL(b.url);
    };
  }, [blobs]);

  if (passMode) {
    return <PassMode bundle={bundle} blobs={blobs} onClose={onClosePassMode} />;
  }

  return (
    <div className="space-y-5">
      {bundle.note && (
        <div className="vault-card-muted p-4 border-l-4 border-primary/60">
          <h4 className="text-sm font-semibold opacity-70 m-0 mb-2">Note</h4>
          <p className="m-0 whitespace-pre-wrap text-sm">{bundle.note}</p>
        </div>
      )}
      {blobs.length > 0 ? (
        <div className="grid sm:grid-cols-2 gap-3">
          {blobs.map((f, i) => (
            <FilePreview key={i} file={f} />
          ))}
        </div>
      ) : (
        <p className="opacity-70 text-sm m-0">No files in this vault.</p>
      )}
    </div>
  );
};

const FilePreview = ({ file }: { file: EncryptedFile & { url: string } }) => {
  const isImage = file.type.startsWith("image/");
  const isPdf = file.type === "application/pdf";
  return (
    <figure className="vault-card-muted overflow-hidden">
      <div className="aspect-square w-full bg-base-200 flex items-center justify-center">
        {isImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={file.url} alt={file.name} className="w-full h-full object-contain" />
        ) : isPdf ? (
          <iframe src={file.url} className="w-full h-full" title={file.name} />
        ) : (
          <div className="text-xs opacity-60">{file.type || "file"}</div>
        )}
      </div>
      <figcaption className="px-3 py-2 text-xs flex justify-between items-center gap-2">
        <span className="truncate">{file.name}</span>
        <a href={file.url} download={file.name} className="link link-hover vault-gold">
          download
        </a>
      </figcaption>
    </figure>
  );
};

const PassMode = ({
  bundle,
  blobs,
  onClose,
}: {
  bundle: PlaintextBundle;
  blobs: Array<EncryptedFile & { url: string }>;
  onClose: () => void;
}) => {
  const primary = blobs.find(b => b.type.startsWith("image/")) ?? blobs[0];
  return (
    <div className="fixed inset-0 z-40 vault-bg-obsidian text-vault-warmwhite flex flex-col">
      <header className="flex items-center justify-between px-5 py-3 border-b border-primary/30">
        <span className="text-sm opacity-80">Pass mode · {bundle.meta.category}</span>
        <button className="btn btn-sm btn-ghost text-vault-warmwhite" onClick={onClose}>
          Close
        </button>
      </header>
      <div className="flex-1 flex items-center justify-center p-6">
        {primary && primary.type.startsWith("image/") ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={primary.url} alt={primary.name} className="max-w-full max-h-[80vh] object-contain" />
        ) : primary && primary.type === "application/pdf" ? (
          <iframe src={primary.url} className="w-full h-[80vh]" title={primary.name} />
        ) : bundle.note ? (
          <p className="max-w-prose text-lg whitespace-pre-wrap">{bundle.note}</p>
        ) : (
          <p className="opacity-60">Empty vault.</p>
        )}
      </div>
    </div>
  );
};

export default Page;

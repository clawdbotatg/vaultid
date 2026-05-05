"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { NextPage } from "next";
import { decodeEventLog, formatUnits, isAddress, isAddressEqual } from "viem";
import { base } from "viem/chains";
import { useAccount, usePublicClient, useReadContract, useWriteContract } from "wagmi";
import { ConnectGate } from "~~/components/ConnectGate";
import { useVaultKey } from "~~/components/VaultKeyProvider";
import erc20Contracts from "~~/contracts/externalContracts";
import {
  PRIMARY_KEY_AUTH_MESSAGE,
  PlaintextBundle,
  Recipient,
  backupAuthMessage,
  deriveVaultKeypair,
  encryptBundleForRecipients,
  fileToEncryptedFile,
} from "~~/lib/crypto";
import { uploadEncryptedEnvelope, uploadMode } from "~~/lib/ipfs";
import {
  CATEGORIES,
  CLAWD_ADDRESS,
  Category,
  VAULTID_ABI,
  VAULTID_ADDRESS,
  ZERO_ADDRESS,
  indexFromCategory,
} from "~~/lib/vault";
import { notification } from "~~/utils/scaffold-eth";
import { getParsedErrorWithAllAbis } from "~~/utils/scaffold-eth/contract";

const ERC20_ABI = erc20Contracts[8453].CLAWD.abi;

// 10 MB total file cap (the spec hint).
const MAX_TOTAL_BYTES = 10 * 1024 * 1024;
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"];

type Step = "idle" | "encrypting" | "uploading" | "approving" | "approving-wait" | "minting" | "minting-wait" | "done";

const stepLabel: Record<Step, string> = {
  idle: "",
  encrypting: "Encrypting your bundle…",
  uploading: "Uploading encrypted bundle to IPFS…",
  approving: "Awaiting CLAWD approval signature…",
  "approving-wait": "Waiting for approval to confirm…",
  minting: "Awaiting mint signature…",
  "minting-wait": "Waiting for mint to confirm…",
  done: "Vault minted!",
};

const StepDots = ({ active }: { active: Step }) => {
  const order: Step[] = ["encrypting", "uploading", "approving", "approving-wait", "minting", "minting-wait", "done"];
  const idx = order.indexOf(active);
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs opacity-80">
      {order.map((s, i) => {
        const isActive = i === idx;
        const isDone = i < idx || active === "done";
        return (
          <span
            key={s}
            className={`vault-pill ${isActive ? "vault-gold border-primary" : isDone ? "border-success/50 text-success" : "opacity-50"}`}
          >
            {stepLabel[s]}
          </span>
        );
      })}
    </div>
  );
};

const Page: NextPage = () => {
  return (
    <main className="max-w-3xl mx-auto px-4 py-10">
      <header className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Create a vault</h1>
        <p className="opacity-70 m-0">Encrypt files + a private note, then mint a soulbound vault on Base.</p>
      </header>
      <ConnectGate requireUnlock>
        <CreateForm />
      </ConnectGate>
    </main>
  );
};

const CreateForm = () => {
  const router = useRouter();
  const { address } = useAccount();
  const publicClient = usePublicClient({ chainId: base.id });
  const { signature: vaultSig, pubKey: myPubKey } = useVaultKey();
  const { writeContractAsync } = useWriteContract();

  // -- Form state --
  const [files, setFiles] = useState<File[]>([]);
  const [note, setNote] = useState("");
  const [category, setCategory] = useState<Category>("Pass");
  const [expiry, setExpiry] = useState<string>(""); // YYYY-MM-DD
  const [backupAddr, setBackupAddr] = useState<string>("");
  const [backupSig, setBackupSig] = useState<string>("");
  const [backupRecipient, setBackupRecipient] = useState<Recipient | null>(null);
  const [backupResolveStatus, setBackupResolveStatus] = useState<"idle" | "resolving" | "ok" | "error">("idle");
  const [backupError, setBackupError] = useState("");

  // -- TX state --
  const [step, setStep] = useState<Step>("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [resultTokenId, setResultTokenId] = useState<bigint | null>(null);

  // -- Read fee + allowance --
  const { data: clawdMintFee } = useReadContract({
    address: VAULTID_ADDRESS,
    abi: VAULTID_ABI,
    functionName: "clawdMintFee",
    chainId: base.id,
  });
  const { data: clawdBalance, refetch: refetchBalance } = useReadContract({
    address: CLAWD_ADDRESS,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    chainId: base.id,
    query: { enabled: Boolean(address) },
  });
  const { data: clawdAllowance, refetch: refetchAllowance } = useReadContract({
    address: CLAWD_ADDRESS,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: address ? [address, VAULTID_ADDRESS] : undefined,
    chainId: base.id,
    query: { enabled: Boolean(address) },
  });
  const { data: clawdDecimals } = useReadContract({
    address: CLAWD_ADDRESS,
    abi: ERC20_ABI,
    functionName: "decimals",
    chainId: base.id,
  });

  const fee = (clawdMintFee as bigint | undefined) ?? 0n;
  const balance = (clawdBalance as bigint | undefined) ?? 0n;
  const allowance = (clawdAllowance as bigint | undefined) ?? 0n;
  const decimals = (clawdDecimals as number | undefined) ?? 18;
  const feeFormatted = formatUnits(fee, decimals);
  const balanceFormatted = formatUnits(balance, decimals);

  const totalBytes = useMemo(() => files.reduce((a, f) => a + f.size, 0), [files]);
  const overSize = totalBytes > MAX_TOTAL_BYTES;
  const insufficientBalance = balance < fee;
  const isBackupAddrValid = backupAddr === "" || isAddress(backupAddr);
  const isReady =
    address &&
    files.length > 0 &&
    !overSize &&
    !insufficientBalance &&
    step === "idle" &&
    !!myPubKey &&
    !!vaultSig &&
    isBackupAddrValid;

  const onPickFiles: React.ChangeEventHandler<HTMLInputElement> = e => {
    const list = e.target.files;
    if (!list) return;
    const incoming = Array.from(list);
    for (const f of incoming) {
      if (!ALLOWED_TYPES.includes(f.type)) {
        notification.error(`Unsupported file type: ${f.type || f.name}`);
        return;
      }
    }
    setFiles(prev => [...prev, ...incoming]);
  };

  const removeFile = (idx: number) => setFiles(prev => prev.filter((_, i) => i !== idx));

  // Resolve backup wallet pubkey when user pastes a signature.
  const resolveBackup = async () => {
    setBackupError("");
    setBackupRecipient(null);
    if (!address) return;
    if (!isAddress(backupAddr)) {
      setBackupError("Invalid Ethereum address.");
      setBackupResolveStatus("error");
      return;
    }
    if (isAddressEqual(backupAddr as `0x${string}`, address)) {
      setBackupError("Backup wallet must be different from the primary wallet.");
      setBackupResolveStatus("error");
      return;
    }
    if (!backupSig.startsWith("0x") || backupSig.length < 130) {
      setBackupError("Paste a hex-encoded signature (0x…).");
      setBackupResolveStatus("error");
      return;
    }
    setBackupResolveStatus("resolving");
    try {
      const message = backupAuthMessage(address as `0x${string}`);
      const kp = await deriveVaultKeypair(message, backupSig as `0x${string}`, backupAddr as `0x${string}`);
      setBackupRecipient({
        address: (backupAddr as `0x${string}`).toLowerCase() as `0x${string}`,
        publicKey: kp.pubKey,
      });
      setBackupResolveStatus("ok");
    } catch (e) {
      setBackupError((e as Error)?.message ?? "Failed to resolve backup pubkey.");
      setBackupResolveStatus("error");
    }
  };

  const clearBackup = () => {
    setBackupAddr("");
    setBackupSig("");
    setBackupRecipient(null);
    setBackupResolveStatus("idle");
    setBackupError("");
  };

  const submit = async () => {
    if (!address || !myPubKey || !vaultSig || !publicClient) return;
    setErrorMsg("");
    setStep("encrypting");
    try {
      // 1. Build the plaintext bundle.
      const encFiles = await Promise.all(files.map(fileToEncryptedFile));
      const bundle: PlaintextBundle = {
        v: 1,
        files: encFiles,
        note: note.trim() || undefined,
        meta: { createdAt: Math.floor(Date.now() / 1000), category },
      };
      // 2. Recipients: always self; backup if resolved.
      const recipients: Recipient[] = [{ address: address as `0x${string}`, publicKey: myPubKey }];
      if (backupRecipient) recipients.push(backupRecipient);

      // 3. Encrypt.
      const envelope = await encryptBundleForRecipients(bundle, recipients);

      // 4. Upload.
      setStep("uploading");
      const uploaded = await uploadEncryptedEnvelope(envelope, {
        callerAddress: address as `0x${string}`,
        signedAuthMessage: PRIMARY_KEY_AUTH_MESSAGE,
        signature: vaultSig,
      });

      // 5. Approve CLAWD if needed (exact fee, never unlimited).
      if (allowance < fee) {
        setStep("approving");
        const approveTx = await writeContractAsync({
          address: CLAWD_ADDRESS,
          abi: ERC20_ABI,
          functionName: "approve",
          args: [VAULTID_ADDRESS, fee],
          chainId: base.id,
        });
        setStep("approving-wait");
        await publicClient.waitForTransactionReceipt({ hash: approveTx, confirmations: 1 });
        // Hold disabled until we re-read allowance (1 short cooldown):
        await new Promise(r => setTimeout(r, 1500));
        await refetchAllowance();
      }

      // 6. Mint.
      setStep("minting");
      const expirySeconds = expiry ? Math.floor(new Date(expiry + "T23:59:59Z").getTime() / 1000) : 0;
      void expirySeconds; // contract uses defaultValidityPeriod from mintedAt; expiry input is informational only
      const mintTx = await writeContractAsync({
        address: VAULTID_ADDRESS,
        abi: VAULTID_ABI,
        functionName: "mintWithCLAWD",
        args: [
          address,
          indexFromCategory(category),
          (backupRecipient?.address ?? ZERO_ADDRESS) as `0x${string}`,
          uploaded.uri,
          envelope.contentHash,
        ],
        chainId: base.id,
      });
      setStep("minting-wait");
      const receipt = await publicClient.waitForTransactionReceipt({ hash: mintTx, confirmations: 1 });

      // Parse VaultMinted event to get tokenId.
      let mintedTokenId: bigint | null = null;
      for (const log of receipt.logs) {
        try {
          const parsed = decodeEventLog({ abi: VAULTID_ABI, data: log.data, topics: log.topics });
          if (parsed.eventName === "VaultMinted") {
            mintedTokenId = (parsed.args as { tokenId: bigint }).tokenId;
            break;
          }
        } catch {
          /* not our event */
        }
      }
      setResultTokenId(mintedTokenId);
      await refetchBalance();
      await refetchAllowance();
      setStep("done");
      notification.success("Vault minted!");
      // Optional: auto-route to view page after a brief pause.
      if (mintedTokenId !== null) {
        setTimeout(() => router.push(`/vault/view?id=${mintedTokenId.toString()}`), 1200);
      }
    } catch (err: unknown) {
      const msg = getParsedErrorWithAllAbis(err, base.id);
      setErrorMsg(msg);
      notification.error(msg);
      setStep("idle");
    }
  };

  // Allow the form to re-enable once we successfully reset.
  useEffect(() => {
    if (step === "done") {
      const t = setTimeout(() => setStep("idle"), 5000);
      return () => clearTimeout(t);
    }
  }, [step]);

  const isBusy = step !== "idle" && step !== "done";
  const mode = uploadMode();

  return (
    <div className="vault-card p-6 md:p-8">
      {mode === "direct" && (
        <div className="alert alert-warning mb-5 text-sm rounded-lg">
          <span className="font-semibold mr-2">DEV MODE:</span> uploading directly to Pinata using a JWT exposed in the
          static bundle. Set <code>NEXT_PUBLIC_WORKER_URL</code> for production.
        </div>
      )}
      {mode === "missing" && (
        <div className="alert alert-error mb-5 text-sm rounded-lg">
          Upload not configured. The owner must set <code>NEXT_PUBLIC_WORKER_URL</code> (production) or
          <code> NEXT_PUBLIC_PINATA_JWT</code> (dev) at build time.
        </div>
      )}

      {/* Step 1: files */}
      <section className="mb-6">
        <h2 className="text-lg font-semibold mb-1">1. Files</h2>
        <p className="text-sm opacity-70 mt-0 mb-3">
          JPG, PNG, WEBP, PDF. Up to ~10 MB total. Encrypted locally before they leave your browser.
        </p>
        <input
          className="vault-input"
          type="file"
          multiple
          accept={ALLOWED_TYPES.join(",")}
          onChange={onPickFiles}
          disabled={isBusy}
        />
        {files.length > 0 && (
          <ul className="mt-3 space-y-1 text-sm">
            {files.map((f, i) => (
              <li key={i} className="flex items-center justify-between vault-card-muted px-3 py-2">
                <span className="truncate mr-3">
                  {f.name}
                  <span className="opacity-50 ml-2">({(f.size / 1024).toFixed(1)} KB)</span>
                </span>
                <button className="link text-xs vault-gold" onClick={() => removeFile(i)} disabled={isBusy}>
                  remove
                </button>
              </li>
            ))}
          </ul>
        )}
        {overSize && (
          <p className="text-xs text-error mt-2">
            Total size {(totalBytes / 1024 / 1024).toFixed(2)} MB exceeds the 10 MB cap.
          </p>
        )}
      </section>

      {/* Step 2: redaction (out of scope, see NEXT_STEPS) */}
      <section className="mb-6">
        <h2 className="text-lg font-semibold mb-1">2. Redact (optional)</h2>
        <p className="text-sm opacity-70 mt-0">
          For sensitive images, please redact (black out / blur) before uploading. Browser-based canvas redaction is on
          the roadmap &mdash; for now, edit the image in your tool of choice. The encrypted bundle will contain whatever
          you upload.
        </p>
      </section>

      {/* Step 3: note */}
      <section className="mb-6">
        <h2 className="text-lg font-semibold mb-1">3. Encrypted note (optional)</h2>
        <textarea
          className="vault-textarea"
          placeholder="A short note that will be encrypted with the files."
          value={note}
          onChange={e => setNote(e.target.value)}
          disabled={isBusy}
          maxLength={4000}
        />
      </section>

      {/* Step 4: metadata */}
      <section className="mb-6 grid md:grid-cols-2 gap-4">
        <div>
          <label className="text-sm font-medium block mb-1">Category</label>
          <select
            className="vault-select"
            value={category}
            onChange={e => setCategory(e.target.value as Category)}
            disabled={isBusy}
          >
            {CATEGORIES.map(c => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-sm font-medium block mb-1">Display expiry (optional)</label>
          <input
            type="date"
            className="vault-input"
            value={expiry}
            onChange={e => setExpiry(e.target.value)}
            disabled={isBusy}
          />
          <p className="text-xs opacity-60 mt-1">
            On-chain expiry is set automatically from the contract&rsquo;s default validity period. The date you pick is
            recorded in the encrypted note for your reference.
          </p>
        </div>
      </section>

      {/* Step 5: backup wallet */}
      <section className="mb-6">
        <h2 className="text-lg font-semibold mb-1">4. Backup wallet (optional)</h2>
        <p className="text-sm opacity-70 mt-0 mb-3">
          A backup wallet can also decrypt this vault. Paste its address, then have the backup wallet sign the message
          below in any wallet (e.g. MetaMask &gt; Sign Message), and paste the signature here.
        </p>
        <div className="grid md:grid-cols-2 gap-3">
          <input
            className="vault-input"
            placeholder="0xBackup… (optional)"
            value={backupAddr}
            onChange={e => {
              setBackupAddr(e.target.value);
              setBackupRecipient(null);
              setBackupResolveStatus("idle");
            }}
            disabled={isBusy}
          />
          <input
            className="vault-input"
            placeholder="0x… signature from backup wallet"
            value={backupSig}
            onChange={e => {
              setBackupSig(e.target.value);
              setBackupRecipient(null);
              setBackupResolveStatus("idle");
            }}
            disabled={isBusy}
          />
        </div>
        {backupAddr && address && (
          <p className="text-xs opacity-70 mt-2">
            Backup wallet must sign this exact message (EIP-191 personal_sign):
            <br />
            <code className="text-xs vault-card-muted px-2 py-1 inline-block mt-1 break-all">
              {backupAuthMessage(address as `0x${string}`)}
            </code>
          </p>
        )}
        <div className="flex gap-2 mt-3 items-center">
          <button
            className="btn btn-sm btn-outline border-primary/40"
            onClick={resolveBackup}
            disabled={isBusy || !backupAddr || !backupSig}
          >
            {backupResolveStatus === "resolving" ? "Resolving…" : "Verify backup signature"}
          </button>
          {backupRecipient && (
            <span className="text-xs text-success">✓ backup pubkey verified — vault will include this wallet</span>
          )}
          {backupRecipient && (
            <button className="link text-xs ml-2" onClick={clearBackup} disabled={isBusy}>
              clear
            </button>
          )}
        </div>
        {backupError && <p className="text-xs text-error mt-1">{backupError}</p>}
      </section>

      {/* Pricing summary */}
      <section className="vault-card-muted p-4 mb-6">
        <div className="flex items-center justify-between text-sm">
          <span className="opacity-80">Mint fee</span>
          <span className="vault-gold font-semibold">{feeFormatted} CLAWD</span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="opacity-80">Your CLAWD balance</span>
          <span className={insufficientBalance ? "text-error" : ""}>{balanceFormatted} CLAWD</span>
        </div>
        <div className="flex items-center justify-between text-xs mt-2 opacity-60">
          <span>CLAWD is a community token. USD value: N/A.</span>
          <Link
            href={`https://basescan.org/address/${CLAWD_ADDRESS}`}
            target="_blank"
            rel="noreferrer"
            className="link link-hover"
          >
            CLAWD on Basescan ↗
          </Link>
        </div>
        {insufficientBalance && (
          <p className="text-error text-xs mt-2">Insufficient CLAWD to mint. Acquire CLAWD on Base before minting.</p>
        )}
      </section>

      {step !== "idle" && step !== "done" && (
        <div className="mb-4">
          <StepDots active={step} />
        </div>
      )}
      {errorMsg && <div className="alert alert-error mb-4 text-sm rounded-lg">{errorMsg}</div>}
      {step === "done" && resultTokenId !== null && (
        <div className="alert alert-success mb-4 text-sm rounded-lg">
          Vault #{resultTokenId.toString()} minted!{" "}
          <Link href={`/vault/view?id=${resultTokenId.toString()}`} className="link ml-2">
            Open it
          </Link>
        </div>
      )}

      <button
        className="btn btn-primary btn-lg w-full"
        onClick={submit}
        disabled={!isReady || isBusy || mode === "missing"}
      >
        {isBusy ? stepLabel[step] : `Encrypt + mint vault (${feeFormatted} CLAWD)`}
      </button>
    </div>
  );
};

export default Page;

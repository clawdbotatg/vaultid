"use client";

import Link from "next/link";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import type { NextPage } from "next";
import { useAccount, useConnect } from "wagmi";

const Pillars = () => (
  <div className="grid md:grid-cols-3 gap-4 max-w-5xl mx-auto mt-14 px-4">
    <div className="vault-card p-6">
      <div className="vault-pill vault-gold border-primary/40 mb-3">Encrypted</div>
      <h3 className="font-semibold text-lg">Yours alone</h3>
      <p className="text-sm opacity-75 m-0">
        Files and notes are encrypted in your browser before they leave. We never see them. The chain stores only a
        fingerprint and a pointer to the ciphertext.
      </p>
    </div>
    <div className="vault-card p-6">
      <div className="vault-pill vault-gold border-primary/40 mb-3">Soulbound</div>
      <h3 className="font-semibold text-lg">Bound to you</h3>
      <p className="text-sm opacity-75 m-0">
        Vault tokens cannot be transferred or sold. Only the holder &mdash; and an optional backup wallet &mdash; can
        ever decrypt them. Lose the wallet, lose access.
      </p>
    </div>
    <div className="vault-card p-6">
      <div className="vault-pill vault-gold border-primary/40 mb-3">Verifiable</div>
      <h3 className="font-semibold text-lg">Provable forever</h3>
      <p className="text-sm opacity-75 m-0">
        Anyone with the vault ID can confirm category, expiry, and integrity. Show your pass; reveal nothing else.
      </p>
    </div>
  </div>
);

const HeroIllustration = () => (
  <svg
    viewBox="0 0 320 200"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className="w-full max-w-md drop-shadow-[0_8px_32px_rgba(201,168,76,0.25)]"
  >
    <defs>
      <linearGradient id="boxGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#1A1A2E" />
        <stop offset="1" stopColor="#0F0F1C" />
      </linearGradient>
      <linearGradient id="goldGrad" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#E3C66E" />
        <stop offset="1" stopColor="#C9A84C" />
      </linearGradient>
    </defs>
    <rect x="40" y="36" width="240" height="148" rx="14" fill="url(#boxGrad)" stroke="#C9A84C" strokeWidth="1.4" />
    <path
      d="M120 80V62a40 40 0 0 1 80 0v18"
      stroke="url(#goldGrad)"
      strokeWidth="3"
      fill="none"
      strokeLinecap="round"
    />
    <rect x="100" y="80" width="120" height="80" rx="10" fill="url(#goldGrad)" />
    <circle cx="160" cy="118" r="11" fill="#1A1A2E" />
    <rect x="156" y="114" width="8" height="22" rx="3" fill="#1A1A2E" />
    <path
      d="M70 30c0 4-3 7-7 7s-7-3-7-7 3-7 7-7"
      stroke="#FAF3E0"
      strokeOpacity="0.4"
      strokeWidth="1"
      fill="none"
      strokeLinecap="round"
    />
    <circle cx="270" cy="170" r="3" fill="#FAF3E0" opacity="0.45" />
    <circle cx="60" cy="160" r="2" fill="#FAF3E0" opacity="0.35" />
    <circle cx="280" cy="50" r="2" fill="#FAF3E0" opacity="0.4" />
  </svg>
);

const Home: NextPage = () => {
  const { isConnected } = useAccount();
  const { connectors, connect, isPending } = useConnect();

  // The burner connector is exposed as a wallet — find it for the
  // "Create Wallet" button. The burner connector is rainbowkit's
  // burner-wallet which is registered when burnerWalletMode allows.
  const burnerConnector = connectors.find(c => c.id === "burnerWallet" || c.name?.toLowerCase().includes("burner"));

  return (
    <div className="vault-bg-obsidian text-vault-warmwhite">
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute -top-32 -right-24 w-96 h-96 rounded-full bg-primary/15 blur-3xl" />
          <div className="absolute -bottom-32 -left-32 w-96 h-96 rounded-full bg-primary/10 blur-3xl" />
        </div>
        <div className="relative max-w-6xl mx-auto px-4 pt-12 pb-20 md:pt-20 md:pb-28 grid md:grid-cols-2 gap-10 items-center">
          <div>
            <span className="vault-pill vault-gold border-primary/40 mb-5">Soulbound vaults on Base</span>
            <h1 className="text-4xl md:text-5xl font-bold leading-tight tracking-tight mt-4 mb-4 vault-text-warm">
              Proof, passes, and memories &mdash; <span className="vault-gold">privately yours.</span>
            </h1>
            <p className="text-base md:text-lg opacity-80 max-w-prose">
              VaultID lets you mint a private, soulbound token that wraps any document, ticket, certificate, or memory.
              Only you can open it. Anyone you choose can verify it.
            </p>
            <div className="flex flex-wrap gap-3 mt-7">
              {isConnected ? (
                <Link href="/create" className="btn btn-primary btn-md min-w-44">
                  Create your first vault
                </Link>
              ) : (
                <ConnectButton.Custom>
                  {({ openConnectModal }) => (
                    <button className="btn btn-primary btn-md min-w-44" onClick={openConnectModal}>
                      Connect Wallet
                    </button>
                  )}
                </ConnectButton.Custom>
              )}
              {!isConnected && burnerConnector && (
                <button
                  className="btn btn-outline btn-md text-vault-warmwhite border-primary/50 hover:bg-primary/15"
                  disabled={isPending}
                  onClick={() => connect({ connector: burnerConnector })}
                >
                  {isPending ? "Creating…" : "Create Wallet"}
                </button>
              )}
              <Link
                href="/verify"
                className="btn btn-ghost btn-md text-vault-warmwhite hover:bg-primary/10 border border-primary/30"
              >
                Verify a vault
              </Link>
            </div>
            <p className="text-xs opacity-60 mt-6">
              Each vault costs a small CLAWD fee &mdash; payable from your connected wallet. No subscription, no
              account.
            </p>
          </div>
          <div className="flex justify-center md:justify-end">
            <HeroIllustration />
          </div>
        </div>
      </section>

      <Pillars />

      <section className="max-w-5xl mx-auto px-4 mt-20 mb-24">
        <h2 className="text-2xl md:text-3xl font-bold text-center mb-2">How it works</h2>
        <div className="vault-divider mx-auto max-w-md mb-10" />
        <ol className="grid md:grid-cols-4 gap-4">
          {[
            { n: 1, t: "Pick contents", d: "Up to ~10 MB total. JPG, PNG, WEBP, PDF. Optional encrypted note." },
            { n: 2, t: "Encrypt locally", d: "Files are sealed with AES-256 in your browser. Keys never leave it." },
            { n: 3, t: "Mint on Base", d: "We pin ciphertext to IPFS and mint a soulbound token referencing it." },
            { n: 4, t: "Show or verify", d: "Open it yourself, share a verification link, or burn it forever." },
          ].map(s => (
            <li key={s.n} className="vault-card-muted p-5">
              <div className="text-3xl font-semibold vault-gold mb-2 leading-none">
                {s.n.toString().padStart(2, "0")}
              </div>
              <h4 className="font-semibold mb-1">{s.t}</h4>
              <p className="text-sm opacity-75 m-0">{s.d}</p>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
};

export default Home;

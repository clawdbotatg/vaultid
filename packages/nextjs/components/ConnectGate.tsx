"use client";

// ConnectGate enforces the four-state UX flow from the frontend-ux skill:
//   1) Not connected   →  show <Connect Wallet> button
//   2) Wrong network   →  show <Switch to Base> button
//   3) Vault locked    →  show <Unlock> button (signs once for the session)
//   4) Ready           →  render children
//
// Use it to wrap any page that needs authenticated, unlocked vault access.
import { ReactNode } from "react";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { base } from "viem/chains";
import { useAccount, useSwitchChain } from "wagmi";
import { useVaultKey } from "~~/components/VaultKeyProvider";

type Props = {
  children: ReactNode;
  /** When true, requires unlock-by-signature; otherwise just connect+network. */
  requireUnlock?: boolean;
};

export const ConnectGate = ({ children, requireUnlock = false }: Props) => {
  const { isConnected, address, chainId } = useAccount();
  const { switchChain, isPending: isSwitching } = useSwitchChain();
  const { privKey, isUnlocking, unlock } = useVaultKey();

  if (!isConnected || !address) {
    return (
      <div className="vault-card p-8 text-center max-w-md mx-auto">
        <h2 className="text-xl font-semibold mb-2">Connect your wallet</h2>
        <p className="opacity-70 mb-5 text-sm">
          You need a wallet to mint and view vaults. We support MetaMask, Coinbase Wallet, Phantom, Rainbow,
          WalletConnect, and a built-in burner wallet.
        </p>
        <ConnectButton.Custom>
          {({ openConnectModal }) => (
            <button className="btn btn-primary btn-md" onClick={openConnectModal}>
              Connect Wallet
            </button>
          )}
        </ConnectButton.Custom>
      </div>
    );
  }

  if (chainId !== base.id) {
    return (
      <div className="vault-card p-8 text-center max-w-md mx-auto">
        <h2 className="text-xl font-semibold mb-2">Switch to Base</h2>
        <p className="opacity-70 mb-5 text-sm">VaultID lives on Base. Switch your wallet network to continue.</p>
        <button
          className="btn btn-primary btn-md"
          onClick={() => switchChain({ chainId: base.id })}
          disabled={isSwitching}
        >
          {isSwitching ? "Switching…" : "Switch to Base"}
        </button>
      </div>
    );
  }

  if (requireUnlock && !privKey) {
    return (
      <div className="vault-card p-8 text-center max-w-md mx-auto">
        <h2 className="text-xl font-semibold mb-2">Unlock vault access</h2>
        <p className="opacity-70 mb-5 text-sm">
          We&rsquo;ll ask your wallet to sign a one-time message so we can derive your encryption keys in this browser.
          The signature never leaves your device, and your wallet&rsquo;s private key is never exposed.
        </p>
        <button className="btn btn-primary btn-md" onClick={unlock} disabled={isUnlocking}>
          {isUnlocking ? "Waiting for signature…" : "Unlock with Signature"}
        </button>
      </div>
    );
  }

  return <>{children}</>;
};

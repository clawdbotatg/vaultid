"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useAccount, useSignMessage } from "wagmi";
import { PRIMARY_KEY_AUTH_MESSAGE, deriveVaultKeypair } from "~~/lib/crypto";
import { notification } from "~~/utils/scaffold-eth";

type VaultKeyState = {
  /** Connected wallet address whose key we hold (or null if none). */
  address: `0x${string}` | null;
  /** Deterministic vault private key (32 bytes). */
  privKey: Uint8Array | null;
  /** Deterministic vault public key (65 bytes, 0x04-prefixed). */
  pubKey: Uint8Array | null;
  /** Raw EIP-191 signature over PRIMARY_KEY_AUTH_MESSAGE — also used to authenticate Worker uploads. */
  signature: `0x${string}` | null;
  /** True while we're awaiting the wallet signature. */
  isUnlocking: boolean;
  /** Trigger the unlock flow. Returns the derived keypair on success. */
  unlock: () => Promise<{ privKey: Uint8Array; pubKey: Uint8Array; signature: `0x${string}` } | null>;
  /** Forget keys (e.g. on disconnect / wallet switch). */
  forget: () => void;
};

const VaultKeyCtx = createContext<VaultKeyState | null>(null);

export const useVaultKey = (): VaultKeyState => {
  const ctx = useContext(VaultKeyCtx);
  if (!ctx) throw new Error("useVaultKey must be used inside <VaultKeyProvider>");
  return ctx;
};

export const VaultKeyProvider = ({ children }: { children: React.ReactNode }) => {
  const { address } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [privKey, setPrivKey] = useState<Uint8Array | null>(null);
  const [pubKey, setPubKey] = useState<Uint8Array | null>(null);
  const [signature, setSignature] = useState<`0x${string}` | null>(null);
  const [boundAddress, setBoundAddress] = useState<`0x${string}` | null>(null);
  const [isUnlocking, setIsUnlocking] = useState(false);
  const inflight = useRef<Promise<{ privKey: Uint8Array; pubKey: Uint8Array; signature: `0x${string}` } | null> | null>(
    null,
  );

  // Forget keys when wallet disconnects or switches.
  useEffect(() => {
    if (!address) {
      setPrivKey(null);
      setPubKey(null);
      setSignature(null);
      setBoundAddress(null);
      return;
    }
    if (boundAddress && boundAddress.toLowerCase() !== address.toLowerCase()) {
      setPrivKey(null);
      setPubKey(null);
      setSignature(null);
      setBoundAddress(null);
    }
  }, [address, boundAddress]);

  const unlock = useCallback(async () => {
    if (!address) {
      notification.error("Connect a wallet first.");
      return null;
    }
    if (privKey && pubKey && signature && boundAddress?.toLowerCase() === address.toLowerCase()) {
      return { privKey, pubKey, signature };
    }
    if (inflight.current) return inflight.current;

    setIsUnlocking(true);
    const promise = (async () => {
      try {
        const sig = await signMessageAsync({ message: PRIMARY_KEY_AUTH_MESSAGE });
        const kp = await deriveVaultKeypair(PRIMARY_KEY_AUTH_MESSAGE, sig as `0x${string}`, address as `0x${string}`);
        setPrivKey(kp.privKey);
        setPubKey(kp.pubKey);
        setSignature(sig as `0x${string}`);
        setBoundAddress(address as `0x${string}`);
        return { privKey: kp.privKey, pubKey: kp.pubKey, signature: sig as `0x${string}` };
      } catch (e) {
        const msg = (e as Error)?.message ?? "Sign request rejected.";
        notification.error(msg);
        return null;
      } finally {
        setIsUnlocking(false);
        inflight.current = null;
      }
    })();
    inflight.current = promise;
    return promise;
  }, [address, privKey, pubKey, signature, boundAddress, signMessageAsync]);

  const forget = useCallback(() => {
    setPrivKey(null);
    setPubKey(null);
    setSignature(null);
    setBoundAddress(null);
  }, []);

  const value = useMemo<VaultKeyState>(
    () => ({
      address: boundAddress,
      privKey,
      pubKey,
      signature,
      isUnlocking,
      unlock,
      forget,
    }),
    [boundAddress, privKey, pubKey, signature, isUnlocking, unlock, forget],
  );

  return <VaultKeyCtx.Provider value={value}>{children}</VaultKeyCtx.Provider>;
};

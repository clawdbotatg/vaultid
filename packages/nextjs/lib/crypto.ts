// VaultID client-side crypto.
//
// THREAT MODEL & DESIGN
// =====================
// Goal: encrypt user files + note so that ONLY the holder (and optionally a
// backup wallet) can decrypt them, end-to-end, in the browser. The contents go
// to public IPFS as opaque ciphertext; the only on-chain footprint is the
// `encryptedContentURI` and a `contentHash` that proves what was encrypted.
//
// Every wallet must be able to (a) deterministically derive an x25519-style
// long-term encryption keypair without exposing its real signing key, and (b)
// later recover that keypair on any device with that same wallet.
//
// We do this by having the wallet sign a fixed, well-known message via
// EIP-191 personal_sign. ECDSA over secp256k1 with RFC 6979 deterministic k
// (which all major wallets implement: MetaMask, WalletConnect-supported
// wallets, Coinbase Wallet, Phantom EVM) yields the SAME signature bytes for
// the same wallet + message every time. We hash that signature to a 32-byte
// secp256k1 scalar, which becomes the "vault key" for the wallet:
//
//   privVault = sha256(walletSig)               (reduced into [1, n))
//   pubVault  = secp256k1.getPublicKey(privVault)
//
// The wallet's *actual* signing key is never exposed. The vault key is bound
// 1-1 to the wallet (anyone who controls the wallet can re-derive it).
//
// Encryption uses ECIES on secp256k1:
//   - Generate fresh ephemeral keypair (e_priv, E_pub) per wrapped recipient.
//   - shared = ECDH(e_priv, pubVault).x          (32-byte x coord)
//   - aesKey = HKDF-SHA256(shared, info="VaultID/ECIES/v1", L=32)
//   - encrypt the per-vault AES key with AES-256-GCM under aesKey + random nonce
//   - publish (E_pub, nonce, ciphertext) as the wrapped key for that recipient
//
// The per-vault payload is encrypted with its own AES-256-GCM key + nonce,
// independent from the wrap layer.
//
// `contentHash` = keccak256(plaintext-bundle-bytes) is published on-chain so a
// verifier can later prove what was encrypted (after the holder publishes the
// plaintext, e.g. for dispute resolution).
//
// We use noble primitives that ship inside viem to avoid pulling eth-crypto.
import { gcm } from "@noble/ciphers/aes";
import { secp256k1 } from "@noble/curves/secp256k1";
import { hkdf } from "@noble/hashes/hkdf";
import { sha256 } from "@noble/hashes/sha256";
import { hashMessage, hexToBytes, keccak256, recoverPublicKey, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

// -- Constants ---------------------------------------------------------------

export const PRIMARY_KEY_AUTH_MESSAGE = "VaultID — sign once to unlock encrypted access for this device. Replay-safe.";

export const backupAuthMessage = (primary: `0x${string}`) => `VaultID Backup Wallet Auth: ${primary.toLowerCase()}`;

const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder();

// -- Types -------------------------------------------------------------------

export type Recipient = {
  /** Ethereum wallet address — used as the lookup key for the wrapped entry. */
  address: `0x${string}`;
  /** secp256k1 public key for the recipient's VAULT key (uncompressed, 65 bytes). */
  publicKey: Uint8Array;
};

export type WrappedKey = {
  recipient: `0x${string}`;
  /** Ephemeral pubkey used in ECIES, hex (uncompressed, 65 bytes). */
  ephemeralPubKey: `0x${string}`;
  /** AES-GCM nonce, hex (12 bytes). */
  nonce: `0x${string}`;
  /** AES-GCM ciphertext+tag of the symmetric key, hex. */
  ciphertext: `0x${string}`;
};

export type EncryptedFile = {
  name: string;
  type: string;
  /** Base64-encoded plaintext bytes. */
  data: string;
};

export type PlaintextBundle = {
  v: 1;
  files: EncryptedFile[];
  note?: string;
  meta: {
    createdAt: number;
    /** Human-readable category name, mirrors the on-chain enum. */
    category: string;
    /**
     * Optional unix timestamp (seconds) the user picked as a personal expiry
     * reminder. Stored encrypted with the bundle; not enforced on-chain.
     */
    expiresAt?: number;
  };
};

export type EncryptedEnvelope = {
  v: 1;
  /** AES-GCM nonce for the bundle, hex (12 bytes). */
  nonce: `0x${string}`;
  /** AES-GCM ciphertext+tag of the JSON-encoded `PlaintextBundle`, hex. */
  ciphertext: `0x${string}`;
  /** Wrapped per-vault key, one entry per recipient. */
  wrappedKeys: WrappedKey[];
  /** keccak256 of the plaintext bundle bytes (the JSON encoding). */
  contentHash: `0x${string}`;
};

// -- Helpers -----------------------------------------------------------------

const randomBytes = (n: number): Uint8Array => {
  const out = new Uint8Array(n);
  crypto.getRandomValues(out);
  return out;
};

const utf8 = (s: string) => TEXT_ENCODER.encode(s);

export const bytesToBase64 = (bytes: Uint8Array): string => {
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)));
  }
  return btoa(bin);
};

export const base64ToBytes = (b64: string): Uint8Array => {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

// -- Vault key derivation ----------------------------------------------------

/**
 * From an EIP-191 signature over `PRIMARY_KEY_AUTH_MESSAGE` (or backupAuthMessage),
 * derive a deterministic secp256k1 keypair. This is the recipient's "vault key".
 *
 * Optionally checks that the signature recovers to `expectedAddress`.
 */
export async function deriveVaultKeypair(
  message: string,
  signature: `0x${string}`,
  expectedAddress?: `0x${string}`,
): Promise<{ privKey: Uint8Array; pubKey: Uint8Array; address: `0x${string}` }> {
  // Recover the pubkey of the signer (just to validate they really signed it).
  if (expectedAddress) {
    const recovered = await recoverPublicKey({
      hash: hashMessage(message),
      signature,
    });
    const pkBytes = hexToBytes(recovered);
    // Compute address: keccak256(pubkey[1:])[-20:]
    const hash = keccak256(pkBytes.subarray(1));
    const addr = `0x${hash.slice(-40)}`.toLowerCase();
    if (addr !== expectedAddress.toLowerCase()) {
      throw new Error(
        `Signature does not recover to expected address. Got ${addr}, want ${expectedAddress.toLowerCase()}.`,
      );
    }
  }

  // Derive a deterministic, valid secp256k1 scalar from the signature bytes.
  const sigBytes = hexToBytes(signature);
  let scalar = sha256(sigBytes);
  let safety = 32;
  while (safety-- > 0) {
    try {
      const pubKey = secp256k1.getPublicKey(scalar, false); // 65-byte uncompressed
      // The address tag we use to look up wrapped keys is still the wallet
      // address itself — that's the address users see, not the derived one.
      const account = privateKeyToAccount(toHex(scalar));
      void account; // we only use this to validate scalar within viem types
      const checkAddr = expectedAddress ? expectedAddress.toLowerCase() : undefined;
      return {
        privKey: scalar,
        pubKey,
        address: (checkAddr ?? account.address.toLowerCase()) as `0x${string}`,
      };
    } catch {
      scalar = sha256(scalar);
    }
  }
  throw new Error("failed to derive a valid secp256k1 scalar from signature");
}

// -- ECIES envelope (one recipient) -----------------------------------------

const HKDF_INFO = utf8("VaultID/ECIES/v1");

function eciesEncrypt(
  recipientPubKey: Uint8Array,
  plaintext: Uint8Array,
): { ephemeralPubKey: Uint8Array; nonce: Uint8Array; ciphertext: Uint8Array } {
  const ephPriv = secp256k1.utils.randomPrivateKey();
  const ephPub = secp256k1.getPublicKey(ephPriv, false);
  const sharedPoint = secp256k1.getSharedSecret(ephPriv, recipientPubKey, false);
  const sharedX = sharedPoint.subarray(1, 33);
  const aesKey = hkdf(sha256, sharedX, undefined, HKDF_INFO, 32);
  const nonce = randomBytes(12);
  const ciphertext = gcm(aesKey, nonce).encrypt(plaintext);
  return { ephemeralPubKey: ephPub, nonce, ciphertext };
}

function eciesDecrypt(
  privKey: Uint8Array,
  ephemeralPubKey: Uint8Array,
  nonce: Uint8Array,
  ciphertext: Uint8Array,
): Uint8Array {
  const sharedPoint = secp256k1.getSharedSecret(privKey, ephemeralPubKey, false);
  const sharedX = sharedPoint.subarray(1, 33);
  const aesKey = hkdf(sha256, sharedX, undefined, HKDF_INFO, 32);
  return gcm(aesKey, nonce).decrypt(ciphertext);
}

// -- Bundle encrypt / decrypt -----------------------------------------------

export async function encryptBundleForRecipients(
  bundle: PlaintextBundle,
  recipients: Recipient[],
): Promise<EncryptedEnvelope> {
  if (recipients.length === 0) throw new Error("no recipients");
  const plaintext = utf8(JSON.stringify(bundle));
  const aesKey = randomBytes(32);
  const nonce = randomBytes(12);
  const ciphertext = gcm(aesKey, nonce).encrypt(plaintext);
  const contentHash = keccak256(plaintext);

  const wrappedKeys: WrappedKey[] = recipients.map(r => {
    const { ephemeralPubKey, nonce: keyNonce, ciphertext: keyCt } = eciesEncrypt(r.publicKey, aesKey);
    return {
      recipient: r.address.toLowerCase() as `0x${string}`,
      ephemeralPubKey: toHex(ephemeralPubKey),
      nonce: toHex(keyNonce),
      ciphertext: toHex(keyCt),
    };
  });

  return {
    v: 1,
    nonce: toHex(nonce),
    ciphertext: toHex(ciphertext),
    wrappedKeys,
    contentHash,
  };
}

export function decryptBundle(
  envelope: EncryptedEnvelope,
  privKey: Uint8Array,
  recipientAddress: `0x${string}`,
): PlaintextBundle {
  const my = envelope.wrappedKeys.find(w => w.recipient.toLowerCase() === recipientAddress.toLowerCase());
  if (!my) throw new Error("This vault was not encrypted for the connected wallet.");
  const aesKey = eciesDecrypt(privKey, hexToBytes(my.ephemeralPubKey), hexToBytes(my.nonce), hexToBytes(my.ciphertext));
  const plaintext = gcm(aesKey, hexToBytes(envelope.nonce)).decrypt(hexToBytes(envelope.ciphertext));
  return JSON.parse(TEXT_DECODER.decode(plaintext)) as PlaintextBundle;
}

// -- File helpers ------------------------------------------------------------

export const fileToEncryptedFile = async (f: File): Promise<EncryptedFile> => {
  const buf = new Uint8Array(await f.arrayBuffer());
  return {
    name: f.name,
    type: f.type || "application/octet-stream",
    data: bytesToBase64(buf),
  };
};

export const encryptedFileToBlob = (ef: EncryptedFile): Blob => {
  const bytes = base64ToBytes(ef.data);
  return new Blob([bytes], { type: ef.type || "application/octet-stream" });
};

import { arrayBufferToBase64, base64ToArrayBuffer } from "./helpers";
import { localDB, ChatItem, MessageItem, CallLogItem } from "../storage/db";

export interface EncryptedBackupBundle {
  version: number;
  exportedAt: number;
  ciphertext: string; // Base64
  salt: string; // Base64
  iv: string; // Base64
  sha256: string; // Hex
}

export interface DecryptedBackupPayload {
  version: number;
  exportedAt: number;
  chats: ChatItem[];
  messages: MessageItem[];
  callLogs: CallLogItem[];
}

/**
 * Derives a 256-bit AES-GCM key from a user passphrase and salt via PBKDF2.
 */
async function deriveBackupKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const passphraseKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(passphrase),
    { name: "PBKDF2" },
    false,
    ["deriveKey"]
  );

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: salt as any,
      iterations: 100000,
      hash: "SHA-256",
    },
    passphraseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

/**
 * Creates an encrypted backup bundle of all local chats, messages, and call logs.
 */
export async function createEncryptedBackup(passphrase: string): Promise<EncryptedBackupBundle> {
  const [chats, messages, callLogs] = await Promise.all([
    localDB.getAllChats(),
    localDB.getAllMessages(),
    localDB.getCallLogs(),
  ]);

  const payload: DecryptedBackupPayload = {
    version: 1,
    exportedAt: Date.now(),
    chats,
    messages,
    callLogs,
  };

  const payloadJson = JSON.stringify(payload);
  const enc = new TextEncoder();
  const payloadBytes = enc.encode(payloadJson);

  // Generate random salt and IV
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));

  // Derive AES-GCM key
  const key = await deriveBackupKey(passphrase, salt);

  // Encrypt payload
  const ciphertextBuffer = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    payloadBytes
  );

  // Compute SHA-256 integrity hash of ciphertext
  const sha256Buffer = await crypto.subtle.digest("SHA-256", ciphertextBuffer);
  const sha256Array = Array.from(new Uint8Array(sha256Buffer));
  const sha256Hex = sha256Array.map((b) => b.toString(16).padStart(2, "0")).join("");

  return {
    version: 1,
    exportedAt: payload.exportedAt,
    ciphertext: arrayBufferToBase64(ciphertextBuffer),
    salt: arrayBufferToBase64(salt.buffer),
    iv: arrayBufferToBase64(iv.buffer),
    sha256: sha256Hex,
  };
}

/**
 * Decrypts a backup bundle and restores chats, messages, and call logs to IndexedDB.
 */
export async function restoreEncryptedBackup(
  bundle: EncryptedBackupBundle,
  passphrase: string
): Promise<{ chatCount: number; messageCount: number; callCount: number }> {
  const ciphertextBuffer = base64ToArrayBuffer(bundle.ciphertext);
  const salt = new Uint8Array(base64ToArrayBuffer(bundle.salt));
  const iv = new Uint8Array(base64ToArrayBuffer(bundle.iv));

  // Verify SHA-256 checksum
  const computedShaBuffer = await crypto.subtle.digest("SHA-256", ciphertextBuffer);
  const computedShaHex = Array.from(new Uint8Array(computedShaBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  if (computedShaHex !== bundle.sha256) {
    throw new Error("Backup integrity verification failed: SHA-256 checksum mismatch");
  }

  // Derive key and decrypt
  const key = await deriveBackupKey(passphrase, salt);
  let decryptedBuffer: ArrayBuffer;
  try {
    decryptedBuffer = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      key,
      ciphertextBuffer
    );
  } catch (err) {
    throw new Error("Incorrect backup passphrase or corrupted archive");
  }

  const dec = new TextDecoder();
  const payloadJson = dec.decode(decryptedBuffer);
  const payload: DecryptedBackupPayload = JSON.parse(payloadJson);

  // Restore into IndexedDB
  await localDB.restoreChatsAndMessages(
    payload.chats || [],
    payload.messages || [],
    payload.callLogs || []
  );

  return {
    chatCount: payload.chats?.length || 0,
    messageCount: payload.messages?.length || 0,
    callCount: payload.callLogs?.length || 0,
  };
}

/**
 * Triggers a browser file download of the encrypted backup archive (.chatapp-backup).
 */
export function downloadBackupFile(bundle: EncryptedBackupBundle, filename?: string): void {
  const blob = new Blob([JSON.stringify(bundle, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename || `chatapp-backup-${new Date().toISOString().split("T")[0]}.enc`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

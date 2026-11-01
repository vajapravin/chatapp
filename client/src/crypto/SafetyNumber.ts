import { base64ToArrayBuffer } from "./helpers";
import { localDB } from "../storage/db";

export interface SafetyNumberResult {
  safetyNumber: string; // 60 digits formatted in 12 groups of 5
  rawDigits: string;
  qrPayload: string;
}

/**
 * Computes the standard 60-digit Signal safety number from two identity keys.
 * Format: 12 groups of 5 digits.
 */
export async function computeSafetyNumber(
  myIdentityKeyB64: string,
  peerIdentityKeyB64: string,
  myUserId: string,
  peerUserId: string
): Promise<SafetyNumberResult> {
  const enc = new TextEncoder();

  // Lexicographically sort both keys to ensure symmetry regardless of who computes it
  const sorted = [
    { id: myUserId, key: myIdentityKeyB64 },
    { id: peerUserId, key: peerIdentityKeyB64 },
  ].sort((a, b) => a.key.localeCompare(b.key));

  const k1 = new Uint8Array(base64ToArrayBuffer(sorted[0].key));
  const k2 = new Uint8Array(base64ToArrayBuffer(sorted[1].key));
  const prefix = enc.encode("SAFETY_NUMBER_V1:");

  const material = new Uint8Array(prefix.length + k1.length + k2.length);
  material.set(prefix, 0);
  material.set(k1, prefix.length);
  material.set(k2, prefix.length + k1.length);

  const hashBuffer = await crypto.subtle.digest("SHA-512", material);
  const hashBytes = new Uint8Array(hashBuffer);

  // Convert 32 bytes into 12 5-digit decimal blocks
  const blocks: string[] = [];
  for (let i = 0; i < 12; i++) {
    // Take 4 bytes per block
    const offset = i * 4;
    const val =
      ((hashBytes[offset] << 24) |
        (hashBytes[offset + 1] << 16) |
        (hashBytes[offset + 2] << 8) |
        hashBytes[offset + 3]) >>>
      0;
    const num = (val % 100000).toString().padStart(5, "0");
    blocks.push(num);
  }

  const rawDigits = blocks.join("");
  const formatted = blocks.join(" ");
  const qrPayload = `chatapp://safety-number?v=1&num=${rawDigits}&p1=${sorted[0].id}&p2=${sorted[1].id}`;

  return {
    safetyNumber: formatted,
    rawDigits,
    qrPayload,
  };
}

/**
 * Checks whether a contact's identity key has changed compared to cached value in IndexedDB.
 */
export async function checkIdentityKeyChange(
  peerUserId: string,
  currentIdentityKeyB64: string
): Promise<{ changed: boolean; previousKey?: string }> {
  const verified = await localDB.getVerifiedSafetyNumber(peerUserId);
  if (!verified) {
    return { changed: false };
  }

  if (verified.identityKey !== currentIdentityKeyB64) {
    return { changed: true, previousKey: verified.identityKey };
  }

  return { changed: false };
}

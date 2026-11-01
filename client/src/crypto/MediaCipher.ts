import { arrayBufferToBase64, base64ToArrayBuffer } from "./helpers";

export interface EncryptedMediaResult {
  encryptedBlob: Blob;
  cipherKey: string; // Base64
  iv: string; // Base64
  sha256: string; // Hex
}

export function bufferToHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export class MediaCipher {
  /**
   * Encrypts a binary File or Blob using AES-256-GCM.
   * Generates a random 256-bit key and 12-byte IV, and computes SHA-256 over the ciphertext.
   */
  static async encryptMediaFile(file: File | Blob): Promise<EncryptedMediaResult> {
    const rawBuffer = await file.arrayBuffer();

    // 1. Generate 256-bit AES-GCM Key
    const aesKey = await crypto.subtle.generateKey(
      { name: "AES-GCM", length: 256 },
      true,
      ["encrypt", "decrypt"]
    );

    // 2. Export key to Base64
    const exportedRawKey = await crypto.subtle.exportKey("raw", aesKey);
    const cipherKey = arrayBufferToBase64(exportedRawKey);

    // 3. Generate random 12-byte IV
    const ivBytes = crypto.getRandomValues(new Uint8Array(12));
    const iv = arrayBufferToBase64(ivBytes.buffer);

    // 4. Encrypt full payload
    const ciphertextBuffer = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: ivBytes },
      aesKey,
      rawBuffer
    );

    // 5. Compute SHA-256 hash over ciphertext
    const hashBuffer = await crypto.subtle.digest("SHA-256", ciphertextBuffer);
    const sha256 = bufferToHex(hashBuffer);

    const encryptedBlob = new Blob([ciphertextBuffer], {
      type: "application/octet-stream",
    });

    return {
      encryptedBlob,
      cipherKey,
      iv,
      sha256,
    };
  }

  /**
   * Decrypts an encrypted binary Blob using the provided AES-256-GCM key and IV.
   * Validates SHA-256 checksum if provided.
   */
  static async decryptMediaBlob(
    encryptedBlob: Blob,
    cipherKey: string,
    iv: string,
    expectedSha256?: string,
    mimeType: string = "application/octet-stream"
  ): Promise<Blob> {
    const ciphertextBuffer = await encryptedBlob.arrayBuffer();

    // 1. Verify SHA-256 checksum if provided
    if (expectedSha256) {
      const hashBuffer = await crypto.subtle.digest("SHA-256", ciphertextBuffer);
      const computedSha256 = bufferToHex(hashBuffer);
      if (computedSha256.toLowerCase() !== expectedSha256.toLowerCase()) {
        throw new Error(
          `Media integrity check failed: expected ${expectedSha256}, got ${computedSha256}`
        );
      }
    }

    // 2. Import Key
    const keyBytes = base64ToArrayBuffer(cipherKey);
    const aesKey = await crypto.subtle.importKey(
      "raw",
      keyBytes,
      { name: "AES-GCM" },
      false,
      ["decrypt"]
    );

    // 3. Decrypt ciphertext
    const ivBytes = new Uint8Array(base64ToArrayBuffer(iv));
    const plaintextBuffer = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: ivBytes },
      aesKey,
      ciphertextBuffer
    );

    return new Blob([plaintextBuffer], { type: mimeType });
  }
}

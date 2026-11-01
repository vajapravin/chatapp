import { MediaCipher } from "../crypto/MediaCipher";
import { localDB, MediaAttachment } from "../storage/db";

export class MediaDownloadManager {
  private static objectUrlCache = new Map<string, string>();

  /**
   * Downloads and decrypts an encrypted media blob, caching it in IndexedDB and memory.
   * Returns a local object URL (blob:...) ready for <img src>, <video src>, or <a> download.
   */
  static async getDecryptedMediaUrl(
    media: MediaAttachment,
    onProgress?: (percent: number) => void
  ): Promise<string> {
    const cacheKey = media.sha256 || media.url;

    // 1. Check memory cache first
    if (this.objectUrlCache.has(cacheKey)) {
      return this.objectUrlCache.get(cacheKey)!;
    }

    // 2. Check IndexedDB persistent cache
    const cachedBlob = await localDB.getCachedMedia(cacheKey);
    if (cachedBlob) {
      const objUrl = URL.createObjectURL(cachedBlob);
      this.objectUrlCache.set(cacheKey, objUrl);
      return objUrl;
    }

    // 3. Download encrypted ciphertext from server / S3
    const res = await fetch(media.url);
    if (!res.ok) {
      throw new Error(`Failed to download encrypted media: HTTP ${res.status}`);
    }

    const encryptedBlob = await res.blob();
    if (onProgress) onProgress(60);

    // 4. Decrypt AES-256-GCM and verify SHA-256
    const decryptedBlob = await MediaCipher.decryptMediaBlob(
      encryptedBlob,
      media.cipherKey,
      media.iv,
      media.sha256,
      media.mimeType
    );

    if (onProgress) onProgress(100);

    // 5. Cache decrypted blob
    await localDB.cacheMedia(cacheKey, decryptedBlob);
    const finalUrl = URL.createObjectURL(decryptedBlob);
    this.objectUrlCache.set(cacheKey, finalUrl);

    return finalUrl;
  }

  /**
   * Triggers browser file download for a decrypted media attachment.
   */
  static async triggerDownload(media: MediaAttachment): Promise<void> {
    const url = await this.getDecryptedMediaUrl(media);
    const a = document.createElement("a");
    a.href = url;
    a.download = media.fileName || "download";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }
}

import { MediaCipher } from "../crypto/MediaCipher";
import { localDB, MediaAttachment } from "../storage/db";
import { useAuthStore } from "../store/authStore";
import { ThumbnailGenerator } from "./ThumbnailGenerator";

const PART_SIZE = 16 * 1024 * 1024; // 16 MB per part

export interface UploadOptions {
  fileName?: string;
  mimeType?: string;
  quality?: "standard" | "hd";
  duration?: number;
  waveform?: number[];
  onProgress?: (percent: number) => void;
}

export class MediaUploadManager {
  /**
   * Encrypts and uploads any media file or blob with chunked resumability.
   * Returns a complete MediaAttachment descriptor ready for Signal encryption.
   */
  static async uploadMedia(
    file: File | Blob,
    options: UploadOptions = {}
  ): Promise<MediaAttachment> {
    const token = useAuthStore.getState().accessToken;
    const fileName =
      options.fileName || (file instanceof File ? file.name : "attachment.bin");
    const mimeType =
      options.mimeType || (file instanceof File ? file.type : "application/octet-stream");

    // 1. Extract metadata (thumbnail, dimensions, duration)
    let width: number | undefined;
    let height: number | undefined;
    let duration: number | undefined = options.duration;
    let thumbnail: string | undefined;
    let fileToEncrypt = file;

    if (mimeType.startsWith("image/")) {
      try {
        const meta = await ThumbnailGenerator.processImage(file, options.quality);
        width = meta.width;
        height = meta.height;
        thumbnail = meta.thumbnail;
        fileToEncrypt = meta.optimizedBlob;
      } catch (err) {
        console.warn("Image metadata extraction failed:", err);
      }
    } else if (mimeType.startsWith("video/")) {
      try {
        const meta = await ThumbnailGenerator.processVideo(file);
        width = meta.width;
        height = meta.height;
        duration = meta.duration;
        thumbnail = meta.thumbnail;
      } catch (err) {
        console.warn("Video metadata extraction failed:", err);
      }
    }

    // 2. Encrypt media with AES-256-GCM
    const { encryptedBlob, cipherKey, iv, sha256 } =
      await MediaCipher.encryptMediaFile(fileToEncrypt);

    const totalCipherBytes = encryptedBlob.size;
    const partsCount = Math.max(1, Math.ceil(totalCipherBytes / PART_SIZE));

    // 3. Initiate multipart upload on API
    const initRes = await fetch("/v1/media/upload/init", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        file_name: fileName,
        file_size: totalCipherBytes,
        mime_type: mimeType,
        parts_count: partsCount,
      }),
    });

    if (!initRes.ok) {
      const err = await initRes.text();
      throw new Error(`Media upload initialization failed: ${err}`);
    }

    const initData = await initRes.json();
    const { upload_id, key, part_urls } = initData;

    // Save session in IndexedDB for resumability
    const session = {
      id: upload_id,
      key,
      totalBytes: totalCipherBytes,
      completedParts: [] as { part_number: number; etag: string }[],
    };
    await localDB.saveUploadSession(session);

    // 4. Upload parts in sequence (or chunks)
    const completedParts: { part_number: number; etag: string }[] = [];
    let uploadedBytes = 0;

    for (let pNum = 1; pNum <= partsCount; pNum++) {
      const start = (pNum - 1) * PART_SIZE;
      const end = Math.min(totalCipherBytes, pNum * PART_SIZE);
      const chunkBlob = encryptedBlob.slice(start, end);

      const partInfo = part_urls.find((p: any) => p.part_number === pNum);
      const uploadUrl = partInfo ? partInfo.upload_url : `/v1/media/blobs/${key}/parts/${pNum}?upload_id=${upload_id}`;

      const putRes = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": "application/octet-stream" },
        body: chunkBlob,
      });

      if (!putRes.ok) {
        throw new Error(`Failed to upload media chunk #${pNum}: ${await putRes.text()}`);
      }

      let etag = putRes.headers.get("etag") || `"${pNum}"`;
      if (putRes.headers.get("content-type")?.includes("application/json")) {
        try {
          const bodyJson = await putRes.clone().json();
          if (bodyJson.etag) etag = bodyJson.etag;
        } catch {}
      }

      completedParts.push({ part_number: pNum, etag });
      session.completedParts = completedParts;
      await localDB.saveUploadSession(session);

      uploadedBytes += chunkBlob.size;
      if (options.onProgress) {
        options.onProgress(Math.min(100, Math.round((uploadedBytes / totalCipherBytes) * 100)));
      }
    }

    // 5. Complete multipart upload
    const completeRes = await fetch("/v1/media/upload/complete", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        key,
        upload_id,
        parts: completedParts,
      }),
    });

    if (!completeRes.ok) {
      throw new Error(`Failed to finalize multipart upload: ${await completeRes.text()}`);
    }

    const completeData = await completeRes.json();
    await localDB.deleteUploadSession(upload_id);

    // Cache original plaintext file so sender can render it immediately without downloading
    await localDB.cacheMedia(key, fileToEncrypt);

    return {
      url: completeData.download_url || `/v1/media/blobs/${key}`,
      mimeType,
      fileName,
      fileSize: fileToEncrypt.size,
      cipherKey,
      iv,
      sha256,
      thumbnail,
      duration,
      waveform: options.waveform,
      width,
      height,
      quality: options.quality,
    };
  }
}

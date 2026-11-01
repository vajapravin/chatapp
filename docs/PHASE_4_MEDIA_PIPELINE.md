# Phase 4: Encrypted Media Pipeline, Voice Notes & Rich Assets

Phase 4 implements a zero-knowledge end-to-end encrypted media pipeline supporting large file uploads up to 2 GB, client-side Opus voice notes with live waveforms, photo quality toggles (Standard vs. HD), client-side video thumbnails, documents, and stickers/GIFs.

---

## 1. Architecture Overview

```
                      ┌──────────────────────────────────────────────────┐
                      │              FastAPI Backend                     │
                      │  - POST /v1/media/upload/init                    │
                      │  - POST /v1/media/upload/part-url                │
                      │  - POST /v1/media/upload/complete                │
                      │  - GET  /v1/media/download/{key}                 │
                      │  - BaseObjectStoreProvider: S3 / Local Disk      │
                      └────────────────────────┬─────────────────────────┘
                                               │
                                               ▼
                      ┌──────────────────────────────────────────────────┐
                      │             Object Store Provider                │
                      │  - S3ObjectStoreProvider (AWS SigV4 Presigned)   │
                      │  - LocalObjectStoreProvider (Chunk reassembly)   │
                      │  - Maximum Blob Size: 2 GB                       │
                      │  - Part Size: 16 MB (< 100 MB Cloudflare limit)  │
                      └────────────────────────┬─────────────────────────┘
                                               │
                                               ▼
                      ┌──────────────────────────────────────────────────┐
                      │             Mosquitto MQTT Broker                │
                      │  - Relays Signal / SenderKey Envelope            │
                      │  - Transports ONLY encrypted MediaAttachment     │
                      │  - Plaintext AES Key never touches server        │
                      └────────────────────────┬─────────────────────────┘
                                               │
                 ┌─────────────────────────────┴─────────────────────────────┐
                 ▼                                                           ▼
┌─────────────────────────────────┐                         ┌─────────────────────────────────┐
│     Client A (Uploader)         │                         │    Client B / C (Recipient)     │
│  - Generates AES-256-GCM key/IV │                         │  - Receives Signal Envelope     │
│  - Encrypts file in WebWorker   │                         │  - Extracts cipherKey & iv      │
│  - Computes SHA-256 of cipher   │ ── Signal Envelope ───► │  - Fetches ciphertext from S3   │
│  - Uploads 16 MB chunks to S3   │    (contains AES key)   │  - Validates SHA-256 checksum   │
│  - Signal encrypts metadata     │                         │  - Decrypts via WebCrypto API   │
│  - Caches decrypted in IDB      │                         │  - Caches decrypted in IDB      │
└─────────────────────────────────┘                         └─────────────────────────────────┘
```

---

## 2. Zero-Knowledge Cryptography & Chunked Pipeline

### 2.1 Client-Side Encryption
All files, photos, videos, documents, and voice notes are encrypted entirely on-device before any network transfer takes place:
1. **Key Generation**: A random 256-bit AES-GCM symmetric key and random 12-byte initialization vector (IV) are generated using `crypto.getRandomValues`.
2. **Ciphertext & Integrity**: The binary payload is encrypted with AES-256-GCM. The browser computes the cryptographic SHA-256 digest over the resulting ciphertext blob.
3. **Key Exchange**: The AES key, IV, and SHA-256 checksum travel exclusively inside Signal Double Ratchet (for 1:1 chats) or Sender Key (for group chats) envelopes. The backend server and object store never possess the plaintext media nor the decryption keys.

### 2.2 Resumable 16 MB Chunked Upload
To safely support files up to 2 GB while remaining comfortably within Cloudflare's 100 MB HTTP request body limit:
- Uploads are split into **16 MB parts**.
- The client persists active upload sessions in IndexedDB (`media_uploads`) with upload ID, key, completed parts, and part hashes. If network drops, the upload resumes from the last confirmed part.
- S3 presigned URLs are generated via standard AWS Signature Version 4 (SigV4), allowing direct-to-bucket uploads without server proxy overhead.

### 2.3 Resilient Download & Decryption
1. Recipient receives the Signal envelope and unpacks `MediaAttachment`:
   ```typescript
   export interface MediaAttachment {
     url: string;        // S3 / Blob download URL
     mimeType: string;   // Original MIME type (e.g., image/jpeg, audio/webm)
     fileName: string;   // Display name
     fileSize: number;   // Decrypted file size in bytes
     cipherKey: string;  // Base64 AES-256-GCM key
     iv: string;         // Base64 12-byte IV
     sha256: string;     // Hex SHA-256 checksum of ciphertext
     thumbnail?: string; // Base64 blurred micro-preview
     duration?: number;  // Audio/video length in seconds
     waveform?: number[];// 32-bar audio visualization array
     width?: number;     // Pixel width
     height?: number;    // Pixel height
     quality?: "standard" | "hd";
   }
   ```
2. Recipient downloads the encrypted ciphertext blob from the object store.
3. Recipient computes `crypto.subtle.digest("SHA-256", ciphertext)` and confirms it matches `media.sha256`. If the checksum differs, the file is rejected immediately.
4. Recipient decrypts the ciphertext using WebCrypto `crypto.subtle.decrypt` and creates a local object URL or caches it in IndexedDB (`media_cache`).

---

## 3. Media Types & Capabilities

### 3.1 Photos & Standard vs. HD Quality Selector
- **Standard Quality**: Images downscaled to a max dimension of 1600px with 0.8 JPEG compression for rapid low-bandwidth transmission.
- **HD Quality**: Preserves full uncompressed source resolution up to 4K / original resolution with lossless or 0.95 quality.
- **Client-Side Thumbnail**: A 32px blurred placeholder data URL is generated on-client and bundled into the envelope for instant rendering while the primary ciphertext downloads.
- **Fullscreen Lightbox**: Interactive viewer with zoom-in (up to 300%), zoom-out, pan, and decrypted download button.

### 3.2 Videos
- **Client-Side Extraction**: HTML5 `<video>` and `<canvas>` elements capture video metadata (width, height, duration) and a 320px poster thumbnail at the 0.5-second mark entirely in the browser. Zero server-side FFmpeg transcoding is performed.
- **In-Bubble Player**: Clean inline video playback with duration badges and full-screen lightbox expansion.

### 3.3 Documents
- Supports all document extensions (PDF, DOCX, XLSX, ZIP, TAR, etc.).
- Displays human-readable file sizes (`formatFileSize`) and file type icons.
- One-click decrypted download directly to the user's filesystem.

### 3.4 Voice Notes & Real-Time Waveform
- **Microphone Recording**: `MediaRecorder` captures native `audio/webm;codecs=opus` audio.
- **Live Frequency Waveform**: An `AudioContext` with an `AnalyserNode` computes real-time audio amplitude bars while the user speaks.
- **Waveform Serialization**: Audio waveforms are normalized into an array of 32 discrete height samples (`waveform: number[]`) attached to the voice note.
- **Interactive Player**: Custom playback bar with play/pause, seek, 1×/1.5×/2× playback speed toggle, and duration counter.
- **On-Device Transcription**: Integrated browser SpeechRecognition fallback for instant voice note reading without external audio leakage.

### 3.5 Stickers & GIFs
- **Sticker Packs**: Bundled high-resolution SVG sticker categories (Smileys, Gestures, Hearts & Celebrations).
- **Trending GIFs**: Searchable and curated animated GIFs.
- **Transparent Bubble Rendering**: Stickers render cleanly without chat bubble borders or backgrounds, matching modern WhatsApp Web ergonomics.

### 3.6 View-Once Media
- Sender can flag photos/videos as view-once (`viewOnce: true`).
- Recipient is shown a single-tap "View once photo" badge.
- When opened, the media displays in a secure modal. Once dismissed, the local decrypted object URL and cache entries are destroyed permanently.

---

## 4. Backend Object Store Provider Architecture

FastAPI utilizes an abstract `BaseObjectStoreProvider` interface defined in `chatapp_shared.providers.object_store`:

```python
class BaseObjectStoreProvider(ABC):
    @abstractmethod
    async def init_multipart_upload(self, key: str, content_type: str = "application/octet-stream") -> tuple[str, str]:
        pass

    @abstractmethod
    async def generate_part_upload_url(self, key: str, upload_id: str, part_number: int) -> str:
        pass

    @abstractmethod
    async def complete_multipart_upload(self, key: str, upload_id: str, parts: list[dict[str, Any]]) -> bool:
        pass

    @abstractmethod
    async def generate_download_url(self, key: str, expires_in: int = 3600) -> str:
        pass
```

### Implementations:
1. **`S3ObjectStoreProvider`**:
   - Uses native standard-library AWS SigV4 URL signing.
   - Works seamlessly with MinIO, AWS S3, Cloudflare R2, or Ceph.
   - Generates presigned PUT URLs for individual 16 MB chunks and presigned GET URLs for downloads.
2. **`LocalObjectStoreProvider`**:
   - Zero-external-dependency local disk provider storing chunks in `./data/media/tmp` and assembled objects in `./data/media`.
   - Used automatically during development and unit tests when S3 credentials are unset.

---

## 5. API Reference

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/v1/media/upload/init` | Starts multipart upload session; returns `upload_id` and unique `key`. |
| `POST` | `/v1/media/upload/part-url` | Generates presigned PUT URL for a specific 16 MB part number. |
| `POST` | `/v1/media/upload/complete` | Validates parts, completes multipart assembly, and returns finalized `download_url`. |
| `GET`  | `/v1/media/download/{key}` | Generates authenticated presigned download URL or serves file directly. |
| `PUT`  | `/v1/media/blobs/{key}/parts/{part_number}` | Fallback chunk upload endpoint for local object storage. |
| `GET`  | `/v1/media/blobs/{key}` | Fallback file download endpoint for local object storage. |

---

## 6. Verification & Test Matrix

All tests passed with zero regressions:

1. **Backend Tests (`api/tests/test_media_api.py`)**:
   - `test_media_upload_init_and_complete_flow`: Passed
   - `test_media_size_limit_exceeded`: Passed
   - `test_media_download_url`: Passed
   - Overall suite: **12 / 12 passed**.
2. **Client E2E Suite (`client/scripts/test_phase4_media.mjs`)**:
   - Alice, Bob, Charlie authentication & Signal prekey setup: Passed
   - Encrypted photo upload, 1:1 delivery, SHA-256 validation & decryption: Passed
   - Opus voice note with 32-bar waveform over SenderKey group: Passed
   - Encrypted PDF document delivery and decryption: Passed
   - View-once encrypted photo delivery and single consumption: Passed
   - Animated sticker messaging: Passed
   - Overall: **7 / 7 passed**.
3. **Phase 2 Regression (`client/scripts/test_client_e2ee.mjs`)**:
   - **9 / 9 passed**.
4. **Phase 3 Regression (`client/scripts/test_phase3_groups_rich.mjs`)**:
   - **8 / 8 passed**.
5. **System Resource Constraints**:
   - Total active memory across all 9 Docker containers: **~304 MiB RAM** (within target limits).
   - Forbidden port adherence: **100% compliant** (No ports in forbidden set used).

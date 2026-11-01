export interface ImageMetaResult {
  width: number;
  height: number;
  thumbnail: string; // Base64 blur data URL
  optimizedBlob: Blob;
}

export interface VideoMetaResult {
  width: number;
  height: number;
  duration: number;
  thumbnail: string; // Base64 data URL
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  const gb = mb / 1024;
  return `${gb.toFixed(2)} GB`;
}

export function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export class ThumbnailGenerator {
  /**
   * Generates a 32x32 blurred thumbnail and optionally downscales image for Standard quality.
   */
  static async processImage(
    file: File | Blob,
    quality: "standard" | "hd" = "standard"
  ): Promise<ImageMetaResult> {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();

      img.onload = () => {
        URL.revokeObjectURL(url);
        const originalWidth = img.naturalWidth || img.width;
        const originalHeight = img.naturalHeight || img.height;

        // 1. Generate micro thumbnail (32px) for blur placeholder
        const thumbCanvas = document.createElement("canvas");
        const thumbMax = 32;
        let tWidth = originalWidth;
        let tHeight = originalHeight;
        if (tWidth > tHeight) {
          tHeight = Math.round((tHeight * thumbMax) / tWidth);
          tWidth = thumbMax;
        } else {
          tWidth = Math.round((tWidth * thumbMax) / tHeight);
          tHeight = thumbMax;
        }
        thumbCanvas.width = Math.max(1, tWidth);
        thumbCanvas.height = Math.max(1, tHeight);
        const tCtx = thumbCanvas.getContext("2d");
        if (tCtx) {
          tCtx.drawImage(img, 0, 0, thumbCanvas.width, thumbCanvas.height);
        }
        const thumbnail = thumbCanvas.toDataURL("image/jpeg", 0.6);

        // 2. Compress for Standard quality, or preserve for HD
        if (quality === "hd") {
          resolve({
            width: originalWidth,
            height: originalHeight,
            thumbnail,
            optimizedBlob: file,
          });
          return;
        }

        const maxDim = 1600;
        let targetWidth = originalWidth;
        let targetHeight = originalHeight;
        if (targetWidth > maxDim || targetHeight > maxDim) {
          if (targetWidth > targetHeight) {
            targetHeight = Math.round((targetHeight * maxDim) / targetWidth);
            targetWidth = maxDim;
          } else {
            targetWidth = Math.round((targetWidth * maxDim) / targetHeight);
            targetHeight = maxDim;
          }
        }

        const mainCanvas = document.createElement("canvas");
        mainCanvas.width = targetWidth;
        mainCanvas.height = targetHeight;
        const mCtx = mainCanvas.getContext("2d");
        if (mCtx) {
          mCtx.drawImage(img, 0, 0, targetWidth, targetHeight);
        }

        mainCanvas.toBlob(
          (blob) => {
            resolve({
              width: targetWidth,
              height: targetHeight,
              thumbnail,
              optimizedBlob: blob || file,
            });
          },
          "image/jpeg",
          0.82
        );
      };

      img.onerror = (err) => {
        URL.revokeObjectURL(url);
        reject(new Error("Failed to load image for processing: " + err));
      };

      img.src = url;
    });
  }

  /**
   * Generates video thumbnail and duration from video file using HTML5 Video.
   */
  static async processVideo(file: File | Blob): Promise<VideoMetaResult> {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(file);
      const video = document.createElement("video");
      video.preload = "metadata";
      video.muted = true;
      video.playsInline = true;

      const timer = setTimeout(() => {
        URL.revokeObjectURL(url);
        resolve({
          width: 640,
          height: 360,
          duration: 0,
          thumbnail: "",
        });
      }, 5000);

      video.onerror = () => {
        clearTimeout(timer);
        URL.revokeObjectURL(url);
        resolve({
          width: 640,
          height: 360,
          duration: 0,
          thumbnail: "",
        });
      };

      video.onloadedmetadata = () => {
        video.currentTime = Math.min(1, video.duration / 2);
      };

      video.onseeked = () => {
        clearTimeout(timer);
        const width = video.videoWidth || 640;
        const height = video.videoHeight || 360;
        const duration = video.duration || 0;

        const canvas = document.createElement("canvas");
        const maxThumb = 320;
        let tWidth = width;
        let tHeight = height;
        if (tWidth > tHeight) {
          tHeight = Math.round((tHeight * maxThumb) / tWidth);
          tWidth = maxThumb;
        } else {
          tWidth = Math.round((tWidth * maxThumb) / tHeight);
          tHeight = maxThumb;
        }
        canvas.width = Math.max(1, tWidth);
        canvas.height = Math.max(1, tHeight);
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        }
        const thumbnail = canvas.toDataURL("image/jpeg", 0.7);

        URL.revokeObjectURL(url);
        resolve({
          width,
          height,
          duration,
          thumbnail,
        });
      };

      video.onerror = () => {
        clearTimeout(timer);
        URL.revokeObjectURL(url);
        resolve({
          width: 640,
          height: 360,
          duration: 0,
          thumbnail: "",
        });
      };

      video.src = url;
    });
  }
}

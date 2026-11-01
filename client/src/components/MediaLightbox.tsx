import React, { useState } from "react";
import { Download, X, ZoomIn, ZoomOut } from "lucide-react";
import { MediaAttachment } from "../storage/db";
import { MediaDownloadManager } from "../media/MediaDownloadManager";

interface MediaLightboxProps {
  media: MediaAttachment | null;
  isOpen: boolean;
  onClose: () => void;
}

export const MediaLightbox: React.FC<MediaLightboxProps> = ({
  media,
  isOpen,
  onClose,
}) => {
  const [zoom, setZoom] = useState(1);
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);

  React.useEffect(() => {
    if (media && isOpen) {
      setZoom(1);
      MediaDownloadManager.getDecryptedMediaUrl(media).then(setMediaUrl).catch(() => {});
    } else {
      setMediaUrl(null);
    }
  }, [media, isOpen]);

  if (!isOpen || !media) return null;

  const isVideo = media.mimeType.startsWith("video/");

  const handleZoomIn = () => setZoom((prev) => Math.min(3, prev + 0.25));
  const handleZoomOut = () => setZoom((prev) => Math.max(0.5, prev - 0.25));

  const handleDownload = () => {
    MediaDownloadManager.triggerDownload(media);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/95 backdrop-blur-md animate-in fade-in duration-200 select-none">
      {/* Top Controls Bar */}
      <div className="absolute top-0 inset-x-0 h-16 px-6 bg-gradient-to-b from-black/80 to-transparent flex items-center justify-between text-white z-20">
        <div className="flex flex-col">
          <span className="text-sm font-semibold truncate max-w-sm">
            {media.fileName || "Media Viewer"}
          </span>
          <span className="text-xs text-[#8696a0]">
            {media.width && media.height ? `${media.width} × ${media.height} px` : ""}
          </span>
        </div>

        <div className="flex items-center gap-3">
          {!isVideo && (
            <>
              <button
                onClick={handleZoomOut}
                className="p-2 hover:bg-white/10 rounded-full transition"
                title="Zoom Out"
              >
                <ZoomOut className="w-5 h-5" />
              </button>
              <button
                onClick={handleZoomIn}
                className="p-2 hover:bg-white/10 rounded-full transition"
                title="Zoom In"
              >
                <ZoomIn className="w-5 h-5" />
              </button>
            </>
          )}

          <button
            onClick={handleDownload}
            className="p-2 hover:bg-white/10 rounded-full transition"
            title="Download Decrypted File"
          >
            <Download className="w-5 h-5" />
          </button>

          <button
            onClick={onClose}
            className="p-2 hover:bg-white/10 rounded-full transition"
            title="Close"
          >
            <X className="w-6 h-6" />
          </button>
        </div>
      </div>

      {/* Main Media Content */}
      <div className="w-full h-full flex items-center justify-center p-4 overflow-hidden">
        {mediaUrl ? (
          isVideo ? (
            <video
              src={mediaUrl}
              controls
              autoPlay
              className="max-h-[85vh] max-w-[90vw] rounded-lg shadow-2xl"
            />
          ) : (
            <img
              src={mediaUrl}
              alt={media.fileName}
              style={{ transform: `scale(${zoom})` }}
              className="max-h-[85vh] max-w-[90vw] object-contain rounded-lg shadow-2xl transition-transform duration-100"
            />
          )
        ) : (
          <div className="flex flex-col items-center gap-3 text-white">
            <div className="w-8 h-8 border-3 border-[#00a884] border-t-transparent rounded-full animate-spin" />
            <span className="text-xs text-[#8696a0]">Decrypting media...</span>
          </div>
        )}
      </div>
    </div>
  );
};

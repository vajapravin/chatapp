import React, { useEffect, useState } from "react";
import { FileText, Send, Sparkles, X } from "lucide-react";
import { formatFileSize } from "../media/ThumbnailGenerator";

interface MediaPreviewModalProps {
  file: File | null;
  isOpen: boolean;
  onClose: () => void;
  onSend: (file: File, caption: string, quality: "standard" | "hd", viewOnce: boolean) => Promise<void>;
}

export const MediaPreviewModal: React.FC<MediaPreviewModalProps> = ({
  file,
  isOpen,
  onClose,
  onSend,
}) => {
  const [caption, setCaption] = useState("");
  const [quality, setQuality] = useState<"standard" | "hd">("standard");
  const [viewOnce, setViewOnce] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);

  useEffect(() => {
    if (file && isOpen) {
      setCaption("");
      setViewOnce(false);
      setQuality("standard");
      setUploadProgress(null);
      setIsSending(false);

      if (file.type.startsWith("image/") || file.type.startsWith("video/")) {
        const url = URL.createObjectURL(file);
        setPreviewUrl(url);
        return () => URL.revokeObjectURL(url);
      } else {
        setPreviewUrl(null);
      }
    }
  }, [file, isOpen]);

  if (!isOpen || !file) return null;

  const isImage = file.type.startsWith("image/");
  const isVideo = file.type.startsWith("video/");
  const isDocument = !isImage && !isVideo;

  const handleSend = async () => {
    setIsSending(true);
    try {
      await onSend(file, caption.trim(), quality, viewOnce);
      onClose();
    } catch (err) {
      console.error("Failed to upload/send media:", err);
    } finally {
      setIsSending(false);
      setUploadProgress(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-150">
      <div className="w-full max-w-2xl bg-[#111b21] rounded-2xl border border-[#2a3942] flex flex-col overflow-hidden shadow-2xl max-h-[90vh]">
        {/* Header Bar */}
        <div className="px-5 py-3.5 bg-[#202c33]/70 border-b border-[#202c33] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h3 className="text-base font-semibold text-white">Preview Attachment</h3>
            <span className="text-xs text-[#8696a0]">
              {formatFileSize(file.size)}
            </span>
          </div>

          <div className="flex items-center gap-2">
            {/* HD Quality Toggle */}
            {isImage && (
              <button
                type="button"
                onClick={() => setQuality(quality === "standard" ? "hd" : "standard")}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition ${
                  quality === "hd"
                    ? "bg-[#00a884] text-white"
                    : "bg-[#202c33] text-[#8696a0] hover:text-white"
                }`}
                title="Toggle Standard vs HD Quality"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>{quality === "hd" ? "HD Quality" : "Standard"}</span>
              </button>
            )}

            <button
              onClick={onClose}
              disabled={isSending}
              className="p-1.5 text-[#8696a0] hover:text-white rounded-full hover:bg-[#374248] transition"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Media Preview Stage */}
        <div className="flex-1 min-h-[300px] max-h-[550px] bg-[#0b141a] flex items-center justify-center p-4 overflow-hidden relative">
          {isImage && previewUrl && (
            <img
              src={previewUrl}
              alt="Preview"
              className="max-h-full max-w-full object-contain rounded-lg shadow-lg"
            />
          )}

          {isVideo && previewUrl && (
            <div className="w-full h-full flex items-center justify-center relative">
              <video
                src={previewUrl}
                controls
                className="max-h-full max-w-full rounded-lg shadow-lg"
              />
            </div>
          )}

          {isDocument && (
            <div className="flex flex-col items-center justify-center p-8 text-center bg-[#202c33]/40 rounded-2xl border border-[#2a3942] max-w-md">
              <div className="w-16 h-16 rounded-2xl bg-[#00a884]/20 text-[#00a884] flex items-center justify-center mb-4">
                <FileText className="w-8 h-8" />
              </div>
              <h4 className="text-base font-semibold text-white break-all">{file.name}</h4>
              <p className="text-xs text-[#8696a0] mt-1">
                {file.type || "Document"} · {formatFileSize(file.size)}
              </p>
            </div>
          )}

          {/* Upload Progress Indicator */}
          {uploadProgress !== null && (
            <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center p-6 backdrop-blur-sm z-20">
              <div className="w-48 bg-[#202c33] rounded-full h-2.5 overflow-hidden mb-3">
                <div
                  className="bg-[#00a884] h-2.5 transition-all duration-150"
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
              <span className="text-sm font-semibold text-white">
                Encrypting & Uploading {uploadProgress}%
              </span>
            </div>
          )}
        </div>

        {/* Caption & Dispatch Bottom Bar */}
        <div className="p-4 bg-[#202c33] border-t border-[#222e35] flex items-center gap-3">
          <input
            type="text"
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder="Add a caption..."
            disabled={isSending}
            className="flex-1 bg-[#2a3942] text-sm text-white px-4 py-2.5 rounded-xl focus:outline-none placeholder-[#8696a0]"
          />

          {/* View-Once Toggle */}
          {(isImage || isVideo) && (
            <button
              type="button"
              onClick={() => setViewOnce(!viewOnce)}
              title={viewOnce ? "View-once enabled" : "Set as view-once"}
              disabled={isSending}
              className={`w-9 h-9 rounded-full border-2 flex items-center justify-center font-bold text-xs transition ${
                viewOnce
                  ? "bg-[#00a884]/20 border-[#00a884] text-[#00a884]"
                  : "border-[#8696a0] text-[#8696a0] hover:text-white hover:border-white"
              }`}
            >
              1
            </button>
          )}

          {/* Send Button */}
          <button
            type="button"
            onClick={handleSend}
            disabled={isSending}
            className="p-3 bg-[#00a884] hover:bg-[#02906f] disabled:opacity-50 text-white rounded-full transition shadow-md flex items-center justify-center"
          >
            {isSending ? (
              <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              <Send className="w-5 h-5" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

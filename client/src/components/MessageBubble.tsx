import React, { useState } from "react";
import { format } from "date-fns";
import {
  Ban,
  BarChart2,
  Calendar,
  Check,
  CheckCheck,
  Clock,
  CornerUpLeft,
  CornerUpRight,
  Download,
  Edit2,
  ExternalLink,
  Eye,
  FileText,
  MapPin,
  Pin,
  Play,
  Smile,
  Star,
  Trash2,
  User as UserIcon,
} from "lucide-react";
import { MediaAttachment, MessageItem } from "../storage/db";
import { useAuthStore } from "../store/authStore";
import { AudioPlayerBubble } from "./AudioPlayerBubble";
import { MediaDownloadManager } from "../media/MediaDownloadManager";
import { formatFileSize } from "../media/ThumbnailGenerator";

interface MessageBubbleProps {
  message: MessageItem;
  isOutgoing: boolean;
  onReply: (msg: MessageItem) => void;
  onReact: (msgId: string, emoji: string) => void;
  onEdit: (msg: MessageItem) => void;
  onDelete: (msg: MessageItem) => void;
  onVotePoll?: (msgId: string, optionId: string) => void;
  onTogglePin?: (msgId: string) => void;
  onToggleStar?: (msgId: string) => void;
  onOpenViewOnce?: (msgId: string) => void;
  onOpenMedia?: (media: MediaAttachment) => void;
  onForward?: (msg: MessageItem) => void;
}

const EMOJI_OPTIONS = ["❤️", "👍", "😂", "😮", "😢", "🙏"];

export const MessageBubble: React.FC<MessageBubbleProps> = ({
  message,
  isOutgoing,
  onReply,
  onReact,
  onEdit,
  onDelete,
  onVotePoll,
  onTogglePin,
  onToggleStar,
  onOpenViewOnce,
  onOpenMedia,
  onForward,
}) => {
  const currentUserId = useAuthStore((s) => s.userId) || "";
  const [showReactions, setShowReactions] = useState(false);
  const [showViewOnceModal, setShowViewOnceModal] = useState(false);
  const [viewOnceMediaUrl, setViewOnceMediaUrl] = useState<string | null>(null);
  const [imageSrc, setImageSrc] = useState<string | null>(null);

  React.useEffect(() => {
    if (message.media && !message.viewOnce) {
      if (message.messageType === "image" || message.messageType === "video") {
        MediaDownloadManager.getDecryptedMediaUrl(message.media)
          .then(setImageSrc)
          .catch(() => {});
      }
    }
  }, [message.media, message.viewOnce, message.messageType]);

  const isEditable =
    isOutgoing &&
    !message.isDeleted &&
    !message.poll &&
    !message.media &&
    !message.viewOnce &&
    Date.now() - message.timestamp < 15 * 60 * 1000;

  const formattedTime = format(new Date(message.timestamp), "h:mm a");

  // Calculate total poll votes
  const totalPollVotes = message.poll
    ? message.poll.options.reduce((acc, opt) => acc + opt.votes.length, 0)
    : 0;

  const handleOpenViewOnce = async () => {
    if (message.viewed) return;
    if (message.media) {
      try {
        const url = await MediaDownloadManager.getDecryptedMediaUrl(message.media);
        setViewOnceMediaUrl(url);
      } catch (err) {
        console.error("Failed to decrypt view-once media:", err);
      }
    }
    setShowViewOnceModal(true);
    if (onOpenViewOnce) onOpenViewOnce(message.id);
  };

  return (
    <div
      className={`group relative flex flex-col mb-1.5 ${
        isOutgoing ? "items-end" : "items-start"
      }`}
    >
      {/* Quick reaction popover */}
      {showReactions && (
        <div
          className={`absolute z-30 -top-10 flex items-center gap-1.5 bg-[#202c33] border border-[#2a3942] rounded-full px-2 py-1 shadow-xl animate-in fade-in zoom-in-95 duration-100 ${
            isOutgoing ? "right-2" : "left-2"
          }`}
        >
          {EMOJI_OPTIONS.map((emoji) => (
            <button
              key={emoji}
              onClick={() => {
                onReact(message.id, emoji);
                setShowReactions(false);
              }}
              className="text-lg hover:scale-125 transition px-1"
            >
              {emoji}
            </button>
          ))}
        </div>
      )}

      {/* Message bubble card */}
      <div
        className={`relative max-w-[85%] md:max-w-[70%] rounded-2xl px-3.5 py-2.5 text-[14.2px] shadow-sm leading-relaxed ${
          isOutgoing
            ? "bg-[#005c4b] text-[#e9edef] rounded-tr-none"
            : "bg-[#202c33] text-[#e9edef] rounded-tl-none border border-[#2a3942]/40"
        }`}
      >
        {/* Forwarded Header */}
        {message.forwardCount && message.forwardCount > 0 ? (
          <div className="flex items-center gap-1 text-[11px] text-[#8696a0] italic mb-1.5 font-normal">
            <CornerUpRight className="w-3 h-3 text-[#8696a0]" />
            {message.forwardCount >= 5 ? (
              <span className="text-[#f59e0b] font-medium flex items-center gap-1">
                Forwarded many times
              </span>
            ) : (
              <span>Forwarded</span>
            )}
          </div>
        ) : null}

        {/* Replying Banner */}
        {message.replyTo && (
          <div
            className={`border-l-4 rounded px-2.5 py-1 mb-2 text-xs select-none ${
              isOutgoing
                ? "border-[#00a884] bg-[#025142]/60 text-[#d1d7db]"
                : "border-[#00a884] bg-[#111b21]/70 text-[#8696a0]"
            }`}
          >
            <p className="font-semibold text-[#00a884] text-[11px] mb-0.5">
              {message.replyTo.senderId === currentUserId ? "You" : "Reply"}
            </p>
            <p className="truncate text-[#e9edef]">{message.replyTo.text}</p>
          </div>
        )}

        {/* 1. Poll Message Bubble */}
        {message.poll ? (
          <div className="space-y-3 min-w-[240px] max-w-sm pt-0.5">
            <div className="flex items-center gap-2">
              <BarChart2 className="w-4 h-4 text-[#00a884]" />
              <h4 className="font-semibold text-sm text-[#e9edef]">{message.poll.question}</h4>
            </div>
            <p className="text-[11px] text-[#8696a0]">
              {message.poll.allowMultiple ? "Select one or more" : "Select one"}
            </p>
            <div className="space-y-2">
              {message.poll.options.map((opt) => {
                const hasVoted = opt.votes.includes(currentUserId);
                const percent = totalPollVotes > 0 ? Math.round((opt.votes.length / totalPollVotes) * 100) : 0;
                return (
                  <button
                    key={opt.id}
                    onClick={() => onVotePoll && onVotePoll(message.id, opt.id)}
                    className={`w-full text-left p-2.5 rounded-xl border transition relative overflow-hidden flex flex-col gap-1 ${
                      hasVoted
                        ? "border-[#00a884] bg-[#00a884]/15"
                        : "border-[#2a3942] bg-[#111b21]/50 hover:bg-[#111b21]"
                    }`}
                  >
                    <div
                      className="absolute inset-y-0 left-0 bg-[#00a884]/20 transition-all duration-300 pointer-events-none"
                      style={{ width: `${percent}%` }}
                    />
                    <div className="relative flex items-center justify-between z-10">
                      <span className="text-xs font-medium text-[#e9edef]">{opt.text}</span>
                      <span className="text-xs font-semibold text-[#8696a0]">{opt.votes.length}</span>
                    </div>
                  </button>
                );
              })}
            </div>
            <p className="text-[11px] text-right text-[#8696a0] pt-1">
              {totalPollVotes} vote{totalPollVotes === 1 ? "" : "s"}
            </p>
          </div>
        ) : null}

        {/* 2. Location Message Bubble */}
        {message.location ? (
          <div className="min-w-[220px] max-w-xs space-y-2">
            <div className="h-28 bg-[#111b21] rounded-xl flex items-center justify-center border border-[#2a3942]/60 relative overflow-hidden group/loc">
              <MapPin className="w-8 h-8 text-[#ef4444]" />
              <a
                href={`https://www.google.com/maps?q=${message.location.latitude},${message.location.longitude}`}
                target="_blank"
                rel="noreferrer"
                className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover/loc:opacity-100 transition text-xs font-semibold text-white gap-1"
              >
                <span>Open Map</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>
            <div>
              <p className="font-semibold text-xs text-[#e9edef]">{message.location.name || "Location"}</p>
              {message.location.address && (
                <p className="text-[11px] text-[#8696a0] truncate">{message.location.address}</p>
              )}
            </div>
          </div>
        ) : null}

        {/* 3. Contact Message Bubble */}
        {message.contact ? (
          <div className="min-w-[200px] flex items-center gap-3 p-1.5 bg-[#111b21]/40 rounded-xl border border-[#2a3942]/40">
            <div className="w-10 h-10 rounded-full bg-[#8b5cf6]/20 text-[#8b5cf6] flex items-center justify-center font-bold">
              <UserIcon className="w-5 h-5" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-xs text-[#e9edef] truncate">{message.contact.name}</p>
              <p className="text-[11px] text-[#8696a0] truncate">{message.contact.phoneNumber}</p>
            </div>
          </div>
        ) : null}

        {/* 4. Event Message Bubble */}
        {message.event ? (
          <div className="min-w-[220px] space-y-2 bg-[#111b21]/40 p-2.5 rounded-xl border border-[#2a3942]/40">
            <div className="flex items-center gap-2 text-[#f59e0b]">
              <Calendar className="w-4 h-4" />
              <span className="font-semibold text-xs text-[#e9edef]">{message.event.title}</span>
            </div>
            <p className="text-[11px] text-[#00a884] font-medium">
              {format(new Date(message.event.startTime), "EEEE, MMM d · h:mm a")}
            </p>
            {message.event.location && (
              <p className="text-[11px] text-[#8696a0]">📍 {message.event.location}</p>
            )}
            {message.event.description && (
              <p className="text-[11px] text-[#d1d7db]">{message.event.description}</p>
            )}
          </div>
        ) : null}

        {/* 5. View-Once Message Bubble */}
        {message.viewOnce ? (
          <button
            onClick={handleOpenViewOnce}
            disabled={message.viewed}
            className={`flex items-center gap-2.5 py-1 px-2 rounded-xl transition ${
              message.viewed
                ? "opacity-60 cursor-default text-[#8696a0]"
                : "text-[#00a884] hover:bg-black/10 cursor-pointer"
            }`}
          >
            <div className="w-7 h-7 rounded-full border border-current flex items-center justify-center text-xs font-bold">
              1
            </div>
            <span className="text-xs font-medium">
              {message.viewed ? "Opened" : "Photo / Message (View once)"}
            </span>
          </button>
        ) : null}

        {/* 6. Audio / Voice Note Message */}
        {message.messageType === "audio" && message.media && !message.viewOnce ? (
          <AudioPlayerBubble media={message.media} isOutgoing={isOutgoing} />
        ) : null}

        {/* 7. Image Message */}
        {message.messageType === "image" && message.media && !message.viewOnce ? (
          <div className="flex flex-col gap-1.5 max-w-sm">
            <div
              onClick={() => onOpenMedia && onOpenMedia(message.media!)}
              className="relative rounded-xl overflow-hidden cursor-pointer group/img bg-[#111b21] max-h-80 flex items-center justify-center"
            >
              <img
                src={imageSrc || message.media.thumbnail || message.media.url}
                alt={message.media.fileName}
                className="w-full h-full object-cover transition-transform duration-200 group-hover/img:scale-[1.02]"
              />
              {!imageSrc && !message.media.thumbnail && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                  <div className="w-6 h-6 border-2 border-[#00a884] border-t-transparent rounded-full animate-spin" />
                </div>
              )}
            </div>
            {message.text && (
              <p className="text-sm text-[#e9edef] px-0.5 whitespace-pre-wrap break-words">{message.text}</p>
            )}
          </div>
        ) : null}

        {/* 8. Video Message */}
        {message.messageType === "video" && message.media && !message.viewOnce ? (
          <div className="flex flex-col gap-1.5 max-w-sm">
            <div
              onClick={() => onOpenMedia && onOpenMedia(message.media!)}
              className="relative rounded-xl overflow-hidden cursor-pointer group/vid bg-[#111b21] aspect-video flex items-center justify-center"
            >
              <img
                src={imageSrc || message.media.thumbnail || ""}
                alt="Video thumbnail"
                className="w-full h-full object-cover"
              />
              <div className="absolute inset-0 bg-black/30 flex items-center justify-center group-hover/vid:bg-black/20 transition">
                <div className="w-12 h-12 rounded-full bg-black/60 text-white flex items-center justify-center shadow-lg group-hover/vid:scale-110 transition">
                  <Play className="w-6 h-6 fill-white ml-0.5" />
                </div>
              </div>
              {message.media.duration && (
                <span className="absolute bottom-2 right-2 px-1.5 py-0.5 rounded bg-black/70 text-[10px] text-white font-mono">
                  {Math.round(message.media.duration)}s
                </span>
              )}
            </div>
            {message.text && (
              <p className="text-sm text-[#e9edef] px-0.5 whitespace-pre-wrap break-words">{message.text}</p>
            )}
          </div>
        ) : null}

        {/* 9. Document Message */}
        {message.messageType === "document" && message.media && !message.viewOnce ? (
          <div className="flex items-center gap-3 p-2 bg-[#111b21]/50 rounded-xl border border-[#2a3942]/60 min-w-[220px] max-w-xs">
            <div className="w-10 h-10 rounded-xl bg-[#00a884]/20 text-[#00a884] flex items-center justify-center flex-shrink-0">
              <FileText className="w-6 h-6" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-[#e9edef] truncate">{message.media.fileName}</p>
              <p className="text-[10px] text-[#8696a0]">{formatFileSize(message.media.fileSize)}</p>
            </div>
            <button
              onClick={() => MediaDownloadManager.triggerDownload(message.media!)}
              title="Download Document"
              className="p-2 text-[#8696a0] hover:text-[#00a884] hover:bg-[#202c33] rounded-full transition flex-shrink-0"
            >
              <Download className="w-4 h-4" />
            </button>
          </div>
        ) : null}

        {/* 10. Sticker Message */}
        {message.messageType === "sticker" && (
          <div className="p-1">
            <img
              src={message.media?.url || message.text}
              alt="Sticker"
              className="w-32 h-32 object-contain"
            />
          </div>
        )}

        {/* 11. GIF Message */}
        {message.messageType === "gif" && (
          <div className="relative rounded-xl overflow-hidden max-w-xs">
            <img
              src={message.media?.url || message.text}
              alt="GIF"
              className="w-full h-auto rounded-xl"
            />
            <span className="absolute bottom-2 left-2 px-1.5 py-0.5 rounded bg-black/60 text-[10px] font-bold text-white tracking-wider">
              GIF
            </span>
          </div>
        )}

        {/* Standard Text Message */}
        {!message.poll &&
          !message.location &&
          !message.contact &&
          !message.event &&
          !message.viewOnce &&
          !message.media &&
          message.messageType !== "sticker" &&
          message.messageType !== "gif" && (
            <p
              className={`break-words whitespace-pre-wrap select-text pr-2 ${
                message.isDeleted ? "italic text-[#8696a0] flex items-center gap-1.5" : ""
              }`}
            >
              {message.isDeleted && <Ban className="w-3.5 h-3.5 text-[#8696a0]" />}
              {message.text}
            </p>
          )}

        {/* Metadata Footer: Time, ticks, star, pin */}
        <div className="flex items-center justify-end gap-1.5 mt-1 -mb-1 text-[11px] text-[#8696a0] select-none">
          {message.isStarred && <Star className="w-3 h-3 fill-[#f59e0b] text-[#f59e0b]" />}
          {message.isPinned && <Pin className="w-3 h-3 text-[#00a884]" />}
          {message.isEdited && <span className="italic text-[10px]">edited</span>}
          <span>{formattedTime}</span>
          {isOutgoing && (
            <span>
              {message.status === "pending" && <Clock className="w-3.5 h-3.5 text-[#8696a0]" />}
              {message.status === "sent" && <Check className="w-3.5 h-3.5 text-[#8696a0]" />}
              {message.status === "delivered" && (
                <CheckCheck className="w-3.5 h-3.5 text-[#8696a0]" />
              )}
              {message.status === "read" && (
                <CheckCheck className="w-3.5 h-3.5 text-[#53bdeb]" />
              )}
            </span>
          )}
        </div>

        {/* Emoji Reactions Footer */}
        {message.reactions && Object.keys(message.reactions).length > 0 && (
          <div
            className={`absolute -bottom-3 flex items-center gap-1 bg-[#202c33] border border-[#2a3942] rounded-full px-2 py-0.5 text-xs shadow-md ${
              isOutgoing ? "right-2" : "left-2"
            }`}
          >
            {Object.entries(message.reactions).map(([uid, emoji]) => (
              <span key={uid}>{emoji}</span>
            ))}
          </div>
        )}
      </div>

      {/* Hover action menu buttons */}
      <div
        className={`opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5 mt-0.5 text-[#8696a0] ${
          isOutgoing ? "mr-1 flex-row-reverse" : "ml-1 flex-row"
        }`}
      >
        <button
          title="React"
          onClick={() => setShowReactions(!showReactions)}
          className="p-1 hover:text-[#e9edef] rounded transition"
        >
          <Smile className="w-3.5 h-3.5" />
        </button>
        <button
          title="Reply"
          onClick={() => onReply(message)}
          className="p-1 hover:text-[#e9edef] rounded transition"
        >
          <CornerUpLeft className="w-3.5 h-3.5" />
        </button>
        {onForward && !message.viewOnce && !message.isDeleted && (
          <button
            title="Forward"
            onClick={() => onForward(message)}
            className="p-1 hover:text-[#e9edef] rounded transition"
          >
            <CornerUpRight className="w-3.5 h-3.5" />
          </button>
        )}
        {onTogglePin && (
          <button
            title={message.isPinned ? "Unpin" : "Pin"}
            onClick={() => onTogglePin(message.id)}
            className="p-1 hover:text-[#00a884] rounded transition"
          >
            <Pin className="w-3.5 h-3.5" />
          </button>
        )}
        {onToggleStar && (
          <button
            title={message.isStarred ? "Unstar" : "Star"}
            onClick={() => onToggleStar(message.id)}
            className="p-1 hover:text-[#f59e0b] rounded transition"
          >
            <Star className="w-3.5 h-3.5" />
          </button>
        )}
        {isEditable && (
          <button
            title="Edit"
            onClick={() => onEdit(message)}
            className="p-1 hover:text-[#e9edef] rounded transition"
          >
            <Edit2 className="w-3.5 h-3.5" />
          </button>
        )}
        {!message.isDeleted && (
          <button
            title="Delete"
            onClick={() => onDelete(message)}
            className="p-1 hover:text-[#ef4444] rounded transition"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* View Once Reveal Modal */}
      {showViewOnceModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-4 animate-in fade-in">
          <div className="bg-[#111b21] border border-[#2a3942] rounded-2xl p-6 max-w-sm w-full text-center space-y-4">
            <div className="w-12 h-12 rounded-full bg-[#00a884]/20 text-[#00a884] flex items-center justify-center mx-auto">
              <Eye className="w-6 h-6" />
            </div>
            <h3 className="font-semibold text-base text-[#e9edef]">View-Once Content</h3>

            {message.media && viewOnceMediaUrl ? (
              message.media.mimeType.startsWith("video/") ? (
                <video
                  src={viewOnceMediaUrl}
                  controls
                  autoPlay
                  className="max-h-60 mx-auto rounded-xl shadow-lg"
                />
              ) : (
                <img
                  src={viewOnceMediaUrl}
                  alt="View once"
                  className="max-h-60 mx-auto rounded-xl object-contain shadow-lg"
                />
              )
            ) : null}

            {message.text && (
              <p className="text-sm text-[#d1d7db] p-3 bg-[#202c33] rounded-xl select-none">
                {message.text}
              </p>
            )}

            <p className="text-[11px] text-[#8696a0]">
              This content will disappear once you close this window.
            </p>
            <button
              onClick={() => {
                setShowViewOnceModal(false);
                setViewOnceMediaUrl(null);
              }}
              className="w-full bg-[#00a884] text-[#111b21] font-semibold py-2 rounded-xl text-xs hover:bg-[#00a884]/90 transition"
            >
              Close and Mark Opened
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

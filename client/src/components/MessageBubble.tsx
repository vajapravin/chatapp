import React, { useState } from "react";
import { format } from "date-fns";
import {
  Ban,
  Check,
  CheckCheck,
  Clock,
  CornerUpLeft,
  Edit2,
  Smile,
  Trash2,
} from "lucide-react";
import { MessageItem } from "../storage/db";

interface MessageBubbleProps {
  message: MessageItem;
  isOutgoing: boolean;
  onReply: (msg: MessageItem) => void;
  onReact: (msgId: string, emoji: string) => void;
  onEdit: (msg: MessageItem) => void;
  onDelete: (msg: MessageItem) => void;
}

const EMOJI_OPTIONS = ["❤️", "👍", "😂", "😮", "😢", "🙏"];

export const MessageBubble: React.FC<MessageBubbleProps> = ({
  message,
  isOutgoing,
  onReply,
  onReact,
  onEdit,
  onDelete,
}) => {
  const [showReactions, setShowReactions] = useState(false);
  const isEditable =
    isOutgoing &&
    !message.isDeleted &&
    Date.now() - message.timestamp < 15 * 60 * 1000;

  const formattedTime = format(new Date(message.timestamp), "h:mm a");

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
              className="hover:scale-125 transition text-base p-1"
            >
              {emoji}
            </button>
          ))}
        </div>
      )}

      {/* Bubble container */}
      <div
        className={`relative max-w-[85%] md:max-w-[70%] rounded-2xl px-3 py-2 text-[14.2px] shadow-sm leading-relaxed ${
          isOutgoing
            ? "bg-[#005c4b] text-[#e9edef] rounded-tr-none"
            : "bg-[#202c33] text-[#e9edef] rounded-tl-none"
        }`}
      >
        {/* Reply quote banner if present */}
        {message.replyTo && (
          <div className="mb-1.5 p-2 rounded-lg bg-black/20 border-l-4 border-[#00a884] text-xs">
            <div className="font-semibold text-[#00a884] mb-0.5">
              {message.replyTo.senderId === message.senderId ? "You" : "Contact"}
            </div>
            <div className="text-[#8696a0] line-clamp-2">
              {message.replyTo.text}
            </div>
          </div>
        )}

        {/* Message body */}
        {message.isDeleted ? (
          <div className="flex items-center gap-1.5 italic text-[#8696a0]">
            <Ban className="w-3.5 h-3.5" />
            <span>This message was deleted</span>
          </div>
        ) : (
          <div className="break-words whitespace-pre-wrap">{message.text}</div>
        )}

        {/* Footer info: edited tag, timestamp, and status ticks */}
        <div className="flex items-center justify-end gap-1 mt-1 text-[11px] text-[#8696a0] select-none">
          {message.isEdited && <span className="italic mr-0.5">(edited)</span>}
          <span>{formattedTime}</span>

          {isOutgoing && (
            <span className="ml-0.5">
              {message.status === "pending" && (
                <Clock className="w-3 h-3 text-[#8696a0]" />
              )}
              {message.status === "sent" && (
                <Check className="w-3.5 h-3.5 text-[#8696a0]" />
              )}
              {message.status === "delivered" && (
                <CheckCheck className="w-3.5 h-3.5 text-[#8696a0]" />
              )}
              {message.status === "read" && (
                <CheckCheck className="w-3.5 h-3.5 text-[#53bdeb]" />
              )}
            </span>
          )}
        </div>

        {/* Reaction badge at bottom of bubble */}
        {message.reactions && Object.keys(message.reactions).length > 0 && (
          <div
            className={`absolute -bottom-3 flex items-center gap-1 bg-[#202c33] border border-[#2a3942] rounded-full px-1.5 py-0.5 text-xs shadow-md ${
              isOutgoing ? "right-2" : "left-2"
            }`}
          >
            {Array.from(new Set(Object.values(message.reactions))).map((emoji, idx) => (
              <span key={idx}>{emoji}</span>
            ))}
            {Object.keys(message.reactions).length > 1 && (
              <span className="text-[10px] text-[#8696a0]">
                {Object.keys(message.reactions).length}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Hover action menu buttons */}
      <div
        className={`opacity-0 group-hover:opacity-100 transition-opacity duration-150 flex items-center gap-1 mt-1 px-1 text-[#8696a0] ${
          isOutgoing ? "justify-end" : "justify-start"
        }`}
      >
        <button
          onClick={() => setShowReactions(!showReactions)}
          title="React"
          className="p-1 hover:bg-[#202c33] hover:text-white rounded-full transition"
        >
          <Smile className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => onReply(message)}
          title="Reply"
          className="p-1 hover:bg-[#202c33] hover:text-white rounded-full transition"
        >
          <CornerUpLeft className="w-3.5 h-3.5" />
        </button>
        {isEditable && (
          <button
            onClick={() => onEdit(message)}
            title="Edit"
            className="p-1 hover:bg-[#202c33] hover:text-white rounded-full transition"
          >
            <Edit2 className="w-3.5 h-3.5" />
          </button>
        )}
        {!message.isDeleted && (
          <button
            onClick={() => onDelete(message)}
            title="Delete"
            className="p-1 hover:bg-[#202c33] hover:text-red-400 rounded-full transition"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  );
};

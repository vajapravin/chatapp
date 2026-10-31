import React, { useEffect, useRef, useState } from "react";
import { format } from "date-fns";
import {
  ArrowLeft,
  Lock,
  MoreVertical,
  Paperclip,
  Send,
  Smile,
  User as UserIcon,
  X,
} from "lucide-react";
import { ChatItem, MessageItem } from "../storage/db";
import { useAuthStore } from "../store/authStore";
import { useChatStore } from "../store/chatStore";
import { getMqttTransport } from "../transport/mqttClient";
import { MessageBubble } from "./MessageBubble";

interface ConversationViewProps {
  chat: ChatItem;
  onBack?: () => void;
}

const QUICK_EMOJIS = ["❤️", "👍", "😂", "🔥", "🎉", "🙏", "😊", "👋"];

export const ConversationView: React.FC<ConversationViewProps> = ({ chat, onBack }) => {
  const currentUserId = useAuthStore((s) => s.userId) || "";
  const { messages, presence, peerTyping } = useChatStore();
  const chatMessages = messages[chat.id] || [];

  const [inputText, setInputText] = useState("");
  const [replyingTo, setReplyingTo] = useState<MessageItem | null>(null);
  const [editingMessage, setEditingMessage] = useState<MessageItem | null>(null);
  const [editText, setEditText] = useState("");
  const [deleteCandidate, setDeleteCandidate] = useState<MessageItem | null>(null);
  const [showEmojiBar, setShowEmojiBar] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const typingTimerRef = useRef<any>(null);

  const isPeerOnline = presence[chat.id]?.isOnline;
  const peerLastSeen = presence[chat.id]?.lastSeen;
  const isPeerTyping = peerTyping[chat.id];

  useEffect(() => {
    // Scroll to bottom when message count changes
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [chatMessages.length, isPeerTyping]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputText(e.target.value);

    // Broadcast typing status
    const transport = getMqttTransport();
    if (transport) {
      transport.sendTypingStatus(chat.id, true);
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
      typingTimerRef.current = setTimeout(() => {
        transport.sendTypingStatus(chat.id, false);
      }, 3000);
    }
  };

  const handleSendMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const trimmed = inputText.trim();
    if (!trimmed) return;

    const transport = getMqttTransport();
    if (!transport) {
      console.warn("Transport not connected");
      return;
    }

    const replyPayload = replyingTo
      ? {
          id: replyingTo.id,
          text: replyingTo.text,
          senderId: replyingTo.senderId,
        }
      : undefined;

    setInputText("");
    setReplyingTo(null);
    setShowEmojiBar(false);

    try {
      await transport.sendMessage(
        {
          id: chat.id,
          phoneNumber: chat.peerPhoneNumber,
          displayName: chat.peerDisplayName,
        },
        trimmed,
        replyPayload
      );
    } catch (err) {
      console.error("Failed to send message:", err);
    }
  };

  const handleReaction = async (msgId: string, emoji: string) => {
    const transport = getMqttTransport();
    if (transport) {
      await transport.sendReaction(chat.id, msgId, emoji);
    }
  };

  const handleStartEdit = (msg: MessageItem) => {
    setEditingMessage(msg);
    setEditText(msg.text);
  };

  const handleSaveEdit = async () => {
    if (!editingMessage || !editText.trim()) return;
    const transport = getMqttTransport();
    if (transport) {
      await transport.sendEditMessage(chat.id, editingMessage.id, editText.trim());
    }
    setEditingMessage(null);
    setEditText("");
  };

  const handleConfirmDelete = async (forEveryone: boolean) => {
    if (!deleteCandidate) return;
    const transport = getMqttTransport();
    if (transport) {
      await transport.sendDeleteMessage(chat.id, deleteCandidate.id, forEveryone);
    }
    setDeleteCandidate(null);
  };

  return (
    <div className="flex-1 h-full flex flex-col bg-[#0b141a] text-[#e9edef] overflow-hidden relative">
      {/* Top Conversation Header */}
      <div className="h-16 px-4 bg-[#202c33] flex items-center justify-between border-b border-[#222e35] select-none z-10">
        <div className="flex items-center gap-3">
          {onBack && (
            <button
              onClick={onBack}
              className="md:hidden p-1.5 -ml-1 text-[#aebac1] hover:text-white rounded-full transition"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
          )}

          <div className="w-10 h-10 rounded-full bg-[#00a884]/20 text-[#00a884] flex items-center justify-center font-semibold text-base relative">
            {chat.peerDisplayName ? (
              chat.peerDisplayName.charAt(0).toUpperCase()
            ) : (
              <UserIcon className="w-5 h-5" />
            )}
            {isPeerOnline && (
              <span className="absolute bottom-0 right-0 w-3 h-3 bg-[#00a884] rounded-full border-2 border-[#202c33]" />
            )}
          </div>

          <div className="flex flex-col">
            <span className="text-sm font-semibold text-white leading-tight">
              {chat.peerDisplayName || chat.peerPhoneNumber || chat.id}
            </span>
            <span className="text-[12px] leading-tight">
              {isPeerTyping ? (
                <span className="text-[#00a884] font-medium animate-pulse">
                  typing...
                </span>
              ) : isPeerOnline ? (
                <span className="text-[#00a884]">online</span>
              ) : peerLastSeen ? (
                <span className="text-[#8696a0]">
                  last seen {format(new Date(peerLastSeen), "h:mm a")}
                </span>
              ) : (
                <span className="text-[#8696a0] font-mono text-[11px]">
                  {chat.peerPhoneNumber}
                </span>
              )}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 text-[#aebac1]">
          <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#111b21] border border-[#2a3942] text-[11px] text-[#8696a0]">
            <Lock className="w-3.5 h-3.5 text-[#00a884]" />
            <span className="hidden sm:inline">End-to-End Encrypted</span>
          </div>
          <button className="p-2 hover:bg-[#374248] rounded-full transition">
            <MoreVertical className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Message Stream Area */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-4 py-4 md:px-12 flex flex-col justify-start bg-[#0b141a] bg-opacity-95"
      >
        {/* E2EE Banner Notice */}
        <div className="flex justify-center mb-6">
          <div className="max-w-md bg-[#182229] border border-[#2a3942] rounded-xl px-4 py-2.5 text-center text-xs text-[#8696a0] leading-relaxed shadow-sm">
            <Lock className="w-3.5 h-3.5 text-[#00a884] inline mr-1.5 -mt-0.5" />
            Messages and calls are end-to-end encrypted. No one outside of this chat,
            not even Chatapp, can read or listen to them.
          </div>
        </div>

        {/* Message Bubbles */}
        {chatMessages.map((msg) => (
          <MessageBubble
            key={msg.id}
            message={msg}
            isOutgoing={msg.senderId === currentUserId}
            onReply={(m) => setReplyingTo(m)}
            onReact={handleReaction}
            onEdit={handleStartEdit}
            onDelete={(m) => setDeleteCandidate(m)}
          />
        ))}

        {/* Peer Typing Indicator in Stream */}
        {isPeerTyping && (
          <div className="flex items-center gap-2 text-xs text-[#00a884] bg-[#202c33] self-start px-3 py-2 rounded-2xl rounded-tl-none mb-2 shadow-sm animate-pulse">
            <span className="w-2 h-2 rounded-full bg-[#00a884]" />
            <span>typing...</span>
          </div>
        )}
      </div>

      {/* Reply Quote Banner above Input */}
      {replyingTo && (
        <div className="px-4 py-2 bg-[#202c33] border-t border-[#2a3942] flex items-center justify-between animate-in slide-in-from-bottom-2 duration-150">
          <div className="flex-1 border-l-4 border-[#00a884] pl-3 py-1">
            <div className="text-xs font-semibold text-[#00a884]">
              Replying to {replyingTo.senderId === currentUserId ? "yourself" : chat.peerDisplayName || "contact"}
            </div>
            <div className="text-xs text-[#8696a0] line-clamp-1">{replyingTo.text}</div>
          </div>
          <button
            onClick={() => setReplyingTo(null)}
            className="p-1.5 text-[#8696a0] hover:text-white rounded-full hover:bg-[#374248] transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Quick Emoji Bar */}
      {showEmojiBar && (
        <div className="px-4 py-2 bg-[#202c33] border-t border-[#2a3942] flex items-center gap-2 overflow-x-auto">
          {QUICK_EMOJIS.map((emoji) => (
            <button
              key={emoji}
              onClick={() => setInputText((prev) => prev + emoji)}
              className="text-lg p-1.5 hover:scale-125 transition"
            >
              {emoji}
            </button>
          ))}
        </div>
      )}

      {/* Message Input Bottom Bar */}
      <form
        onSubmit={handleSendMessage}
        className="min-h-[62px] px-4 py-2 bg-[#202c33] flex items-center gap-2 border-t border-[#222e35] select-none"
      >
        <button
          type="button"
          onClick={() => setShowEmojiBar(!showEmojiBar)}
          className={`p-2 rounded-full transition ${
            showEmojiBar ? "text-[#00a884] bg-[#374248]" : "text-[#8696a0] hover:text-white hover:bg-[#374248]"
          }`}
        >
          <Smile className="w-5 h-5" />
        </button>

        <button
          type="button"
          className="p-2 text-[#8696a0] hover:text-white hover:bg-[#374248] rounded-full transition"
        >
          <Paperclip className="w-5 h-5" />
        </button>

        <div className="flex-1 relative">
          <input
            type="text"
            value={inputText}
            onChange={handleInputChange}
            placeholder="Type a message"
            className="w-full bg-[#2a3942] text-sm text-white px-4 py-2.5 rounded-xl focus:outline-none placeholder-[#8696a0]"
          />
        </div>

        <button
          type="submit"
          disabled={!inputText.trim()}
          className="p-2.5 bg-[#00a884] hover:bg-[#02906f] disabled:opacity-50 disabled:hover:bg-[#00a884] text-white rounded-full transition shadow-md"
        >
          <Send className="w-4 h-4" />
        </button>
      </form>

      {/* Edit Message Modal */}
      {editingMessage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-md bg-[#202c33] rounded-2xl border border-[#2a3942] p-5 shadow-2xl">
            <h3 className="text-base font-semibold text-white mb-2">Edit Message</h3>
            <p className="text-xs text-[#8696a0] mb-4">
              Messages can be edited within 15 minutes of sending.
            </p>
            <input
              type="text"
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              className="w-full bg-[#111b21] border border-[#2a3942] rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-[#00a884] mb-4"
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setEditingMessage(null)}
                className="px-4 py-2 rounded-xl text-sm text-[#8696a0] hover:text-white hover:bg-[#374248] transition"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveEdit}
                disabled={!editText.trim()}
                className="px-4 py-2 rounded-xl text-sm bg-[#00a884] text-white font-medium hover:bg-[#02906f] disabled:opacity-50 transition"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Message Modal */}
      {deleteCandidate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm bg-[#202c33] rounded-2xl border border-[#2a3942] p-5 shadow-2xl">
            <h3 className="text-base font-semibold text-white mb-2">Delete Message?</h3>
            <p className="text-xs text-[#8696a0] mb-5 leading-relaxed">
              You can delete this message for everyone or just for yourself.
            </p>
            <div className="flex flex-col gap-2">
              {deleteCandidate.senderId === currentUserId && (
                <button
                  onClick={() => handleConfirmDelete(true)}
                  className="w-full py-2.5 rounded-xl text-sm bg-red-500/20 text-red-300 hover:bg-red-500/30 font-medium transition"
                >
                  Delete for everyone
                </button>
              )}
              <button
                onClick={() => handleConfirmDelete(false)}
                className="w-full py-2.5 rounded-xl text-sm bg-[#374248] text-white hover:bg-[#4a5860] font-medium transition"
              >
                Delete for me
              </button>
              <button
                onClick={() => setDeleteCandidate(null)}
                className="w-full py-2 rounded-xl text-sm text-[#8696a0] hover:text-white transition"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

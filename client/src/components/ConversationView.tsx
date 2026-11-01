import React, { useEffect, useRef, useState } from "react";
import { format } from "date-fns";
import {
  AlertOctagon,
  ArrowLeft,
  CheckSquare,
  CornerUpRight,
  FileText,
  Image as ImageIcon,
  Info,
  Lock,
  LockKeyhole,
  Mic,
  MoreVertical,
  Paperclip,
  Phone,
  Pin,
  Send,
  ShieldCheck,
  Smile,
  Sparkles,
  Square,
  Unlock,
  User as UserIcon,
  Users,
  UserX,
  Video,
  X,
} from "lucide-react";
import {
  ChatItem,
  ContactData,
  EventData,
  LocationData,
  MediaAttachment,
  MessageItem,
  PollData,
} from "../storage/db";
import { useAuthStore } from "../store/authStore";
import { useChatStore } from "../store/chatStore";
import { usePrivacyStore } from "../store/privacyStore";
import { getMqttTransport } from "../transport/mqttClient";
import { MessageBubble } from "./MessageBubble";
import { GroupInfoDrawer } from "./GroupInfoDrawer";
import { RichMessageComposer } from "./RichMessageComposer";
import { MediaPreviewModal } from "./MediaPreviewModal";
import { MediaLightbox } from "./MediaLightbox";
import { VoiceNoteRecorder } from "./VoiceNoteRecorder";
import { StickerGifPicker } from "./StickerGifPicker";
import { SafetyNumberModal } from "./SafetyNumberModal";
import { ReportUserModal } from "./ReportUserModal";
import { MediaUploadManager } from "../media/MediaUploadManager";
import { callManager } from "../calls/CallManager";

interface ConversationViewProps {
  chat: ChatItem;
  onBack?: () => void;
}

export const ConversationView: React.FC<ConversationViewProps> = ({ chat, onBack }) => {
  const currentUserId = useAuthStore((s) => s.userId) || "";
  const { messages, presence, peerTyping, toggleStarMessage, openViewOnceMessage } = useChatStore();
  const chatMessages = messages[chat.id] || [];

  const [inputText, setInputText] = useState("");
  const [replyingTo, setReplyingTo] = useState<MessageItem | null>(null);
  const [editingMessage, setEditingMessage] = useState<MessageItem | null>(null);
  const [editText, setEditText] = useState("");
  const [deleteCandidate, setDeleteCandidate] = useState<MessageItem | null>(null);
  const [isViewOnce, setIsViewOnce] = useState(false);
  const [isGroupDrawerOpen, setIsGroupDrawerOpen] = useState(false);
  const [isRichComposerOpen, setIsRichComposerOpen] = useState(false);

  // Phase 4 Media State
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const [showStickerPicker, setShowStickerPicker] = useState(false);
  const [isRecordingVoice, setIsRecordingVoice] = useState(false);
  const [pendingMediaFile, setPendingMediaFile] = useState<File | null>(null);
  const [isMediaPreviewOpen, setIsMediaPreviewOpen] = useState(false);
  const [activeLightboxMedia, setActiveLightboxMedia] = useState<MediaAttachment | null>(null);
  const [isLightboxOpen, setIsLightboxOpen] = useState(false);

  // Phase 6 Privacy & Security State
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [showSafetyModal, setShowSafetyModal] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);
  const [forwardCandidate, setForwardCandidate] = useState<MessageItem | null>(null);
  const [showForwardModal, setShowForwardModal] = useState(false);
  const [selectedForwardChatIds, setSelectedForwardChatIds] = useState<string[]>([]);
  const [myIdentityKeyB64, setMyIdentityKeyB64] = useState("");
  const [peerIdentityKeyB64, setPeerIdentityKeyB64] = useState("");

  const scrollRef = useRef<HTMLDivElement>(null);
  const typingTimerRef = useRef<any>(null);
  const fileInputMediaRef = useRef<HTMLInputElement>(null);
  const fileInputDocRef = useRef<HTMLInputElement>(null);
  const attachMenuRef = useRef<HTMLDivElement>(null);
  const moreMenuRef = useRef<HTMLDivElement>(null);

  const allChats = useChatStore((s) => s.chats);
  const { lockedChatIds, lockChat, unlockChat, blockedUsers, blockUser, unblockUser } = usePrivacyStore();

  const isChatLocked = lockedChatIds.includes(chat.id);
  const isPeerBlocked = !chat.isGroup && blockedUsers.some((b) => b.blocked_user_id === chat.peerUserId);

  const isPeerOnline = presence[chat.id]?.isOnline;
  const peerLastSeen = presence[chat.id]?.lastSeen;
  const isPeerTyping = peerTyping[chat.id];

  const pinnedMessages = chatMessages.filter((m) => m.isPinned);
  const activePinned = pinnedMessages.length > 0 ? pinnedMessages[pinnedMessages.length - 1] : null;

  useEffect(() => {
    // Scroll to bottom when message count changes
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [chatMessages.length, isPeerTyping]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (attachMenuRef.current && !attachMenuRef.current.contains(e.target as Node)) {
        setShowAttachMenu(false);
      }
      if (moreMenuRef.current && !moreMenuRef.current.contains(e.target as Node)) {
        setShowMoreMenu(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

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

    const wasViewOnce = isViewOnce;
    setInputText("");
    setReplyingTo(null);
    setIsViewOnce(false);

    try {
      if (chat.isGroup) {
        await transport.sendGroupMessage(chat, trimmed, {
          replyTo: replyPayload,
          viewOnce: wasViewOnce,
        });
      } else {
        await transport.sendMessage(
          {
            id: chat.id,
            phoneNumber: chat.peerPhoneNumber,
            displayName: chat.peerDisplayName,
          },
          trimmed,
          {
            replyTo: replyPayload,
            viewOnce: wasViewOnce,
          }
        );
      }
    } catch (err) {
      console.error("Failed to send message:", err);
    }
  };

  // Phase 4 Media Handlers
  const handleMediaFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    setShowAttachMenu(false);
    if (e.target.files && e.target.files[0]) {
      setPendingMediaFile(e.target.files[0]);
      setIsMediaPreviewOpen(true);
    }
    e.target.value = "";
  };

  const handleSendMedia = async (
    file: File,
    caption: string,
    quality: "standard" | "hd",
    viewOnce: boolean
  ) => {
    const transport = getMqttTransport();
    if (!transport) return;

    const isImage = file.type.startsWith("image/");
    const isVideo = file.type.startsWith("video/");
    const msgType = isImage ? "image" : isVideo ? "video" : "document";

    const media = await MediaUploadManager.uploadMedia(file, {
      quality,
      mimeType: file.type,
      fileName: file.name,
    });

    if (chat.isGroup) {
      await transport.sendGroupMessage(chat, caption, {
        messageType: msgType,
        media,
        viewOnce,
      });
    } else {
      await transport.sendMessage(
        { id: chat.id, phoneNumber: chat.peerPhoneNumber, displayName: chat.peerDisplayName },
        caption,
        {
          messageType: msgType,
          media,
          viewOnce,
        }
      );
    }
    setIsMediaPreviewOpen(false);
    setPendingMediaFile(null);
  };

  const handleSendVoiceNote = async (
    audioBlob: Blob,
    duration: number,
    waveform: number[]
  ) => {
    setIsRecordingVoice(false);
    const transport = getMqttTransport();
    if (!transport) return;

    try {
      const audioFile = new File([audioBlob], `voice-note-${Date.now()}.webm`, {
        type: "audio/webm",
      });
      const media = await MediaUploadManager.uploadMedia(audioFile, {
        duration,
        waveform,
        mimeType: "audio/webm",
      });

      if (chat.isGroup) {
        await transport.sendGroupMessage(chat, "", { messageType: "audio", media });
      } else {
        await transport.sendMessage(
          { id: chat.id, phoneNumber: chat.peerPhoneNumber, displayName: chat.peerDisplayName },
          "",
          { messageType: "audio", media }
        );
      }
    } catch (err) {
      console.error("Failed to send voice note:", err);
    }
  };

  const handleSelectSticker = async (url: string) => {
    setShowStickerPicker(false);
    const transport = getMqttTransport();
    if (!transport) return;
    try {
      if (chat.isGroup) {
        await transport.sendGroupMessage(chat, url, { messageType: "sticker" });
      } else {
        await transport.sendMessage(
          { id: chat.id, phoneNumber: chat.peerPhoneNumber, displayName: chat.peerDisplayName },
          url,
          { messageType: "sticker" }
        );
      }
    } catch (err) {
      console.error("Failed to send sticker:", err);
    }
  };

  const handleSelectGif = async (url: string) => {
    setShowStickerPicker(false);
    const transport = getMqttTransport();
    if (!transport) return;
    try {
      if (chat.isGroup) {
        await transport.sendGroupMessage(chat, url, { messageType: "gif" });
      } else {
        await transport.sendMessage(
          { id: chat.id, phoneNumber: chat.peerPhoneNumber, displayName: chat.peerDisplayName },
          url,
          { messageType: "gif" }
        );
      }
    } catch (err) {
      console.error("Failed to send GIF:", err);
    }
  };

  // Drag and Drop & Paste Handlers
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      setPendingMediaFile(e.dataTransfer.files[0]);
      setIsMediaPreviewOpen(true);
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    if (e.clipboardData.files && e.clipboardData.files.length > 0) {
      e.preventDefault();
      setPendingMediaFile(e.clipboardData.files[0]);
      setIsMediaPreviewOpen(true);
    }
  };

  const handleSendPoll = async (poll: PollData) => {
    const transport = getMqttTransport();
    if (!transport) return;
    try {
      if (chat.isGroup) {
        await transport.sendGroupMessage(chat, "", { messageType: "poll", poll });
      } else {
        await transport.sendMessage(
          { id: chat.id, phoneNumber: chat.peerPhoneNumber, displayName: chat.peerDisplayName },
          "",
          { messageType: "poll", poll }
        );
      }
    } catch (err) {
      console.error("Failed to send poll:", err);
    }
  };

  const handleSendLocation = async (location: LocationData) => {
    const transport = getMqttTransport();
    if (!transport) return;
    try {
      if (chat.isGroup) {
        await transport.sendGroupMessage(chat, "", { messageType: "location", location });
      } else {
        await transport.sendMessage(
          { id: chat.id, phoneNumber: chat.peerPhoneNumber, displayName: chat.peerDisplayName },
          "",
          { messageType: "location", location }
        );
      }
    } catch (err) {
      console.error("Failed to send location:", err);
    }
  };

  const handleSendContact = async (contact: ContactData) => {
    const transport = getMqttTransport();
    if (!transport) return;
    try {
      if (chat.isGroup) {
        await transport.sendGroupMessage(chat, "", { messageType: "contact", contact });
      } else {
        await transport.sendMessage(
          { id: chat.id, phoneNumber: chat.peerPhoneNumber, displayName: chat.peerDisplayName },
          "",
          { messageType: "contact", contact }
        );
      }
    } catch (err) {
      console.error("Failed to send contact:", err);
    }
  };

  const handleSendEvent = async (event: EventData) => {
    const transport = getMqttTransport();
    if (!transport) return;
    try {
      if (chat.isGroup) {
        await transport.sendGroupMessage(chat, "", { messageType: "event", event });
      } else {
        await transport.sendMessage(
          { id: chat.id, phoneNumber: chat.peerPhoneNumber, displayName: chat.peerDisplayName },
          "",
          { messageType: "event", event }
        );
      }
    } catch (err) {
      console.error("Failed to send event:", err);
    }
  };

  const handleVotePoll = async (msgId: string, optionId: string) => {
    const transport = getMqttTransport();
    if (transport) {
      await transport.sendPollVote(chat, msgId, optionId);
    }
  };

  const handleTogglePin = async (msgId: string) => {
    const msg = chatMessages.find((m) => m.id === msgId);
    if (!msg) return;
    const transport = getMqttTransport();
    if (transport) {
      await transport.sendPinUpdate(chat, msgId, !msg.isPinned);
    }
  };

  const handleToggleStar = async (msgId: string) => {
    await toggleStarMessage(chat.id, msgId);
  };

  const handleOpenViewOnce = async (msgId: string) => {
    await openViewOnceMessage(chat.id, msgId);
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

  const handleOpenSafetyNumber = async () => {
    setShowMoreMenu(false);
    try {
      const transport = getMqttTransport();
      const adapter = transport?.getSignalAdapter();
      if (!adapter) return;
      const myB64 = await adapter.getLocalIdentityKeyB64();
      if (!myB64) return;
      setMyIdentityKeyB64(myB64);

      let peerB64 = await adapter.getPeerIdentityKeyB64(chat.peerUserId);
      if (!peerB64) {
        const token = useAuthStore.getState().accessToken;
        const res = await fetch(`/v1/keys/${chat.peerUserId}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const b = await res.json();
          const d1 = b.devices?.find((d: any) => d.device_id === 1);
          if (d1) peerB64 = d1.identity_key;
        }
      }
      if (peerB64) {
        setPeerIdentityKeyB64(peerB64);
        setShowSafetyModal(true);
      }
    } catch (err) {
      console.error("Failed to load safety number keys:", err);
    }
  };

  const handleToggleLockChat = async () => {
    setShowMoreMenu(false);
    if (isChatLocked) {
      await unlockChat(chat.id);
    } else {
      await lockChat(chat.id);
    }
  };

  const handleToggleBlockUser = async () => {
    setShowMoreMenu(false);
    if (isPeerBlocked) {
      await unblockUser(chat.peerUserId);
    } else {
      if (
        window.confirm(
          `Block ${chat.peerDisplayName || chat.peerPhoneNumber || "this contact"}? Blocked contacts cannot call or send you messages.`
        )
      ) {
        await blockUser(chat.peerUserId);
      }
    }
  };

  const handleForwardCandidate = (msg: MessageItem) => {
    setForwardCandidate(msg);
    setSelectedForwardChatIds([]);
    setShowForwardModal(true);
  };

  const toggleSelectForwardChat = (chatId: string) => {
    const isFrequent = (forwardCandidate?.forwardCount || 0) >= 5;
    const maxSelectable = isFrequent ? 1 : 5;

    if (selectedForwardChatIds.includes(chatId)) {
      setSelectedForwardChatIds(selectedForwardChatIds.filter((id) => id !== chatId));
    } else {
      if (selectedForwardChatIds.length >= maxSelectable) return;
      setSelectedForwardChatIds([...selectedForwardChatIds, chatId]);
    }
  };

  const handleSendForward = async () => {
    if (!forwardCandidate || selectedForwardChatIds.length === 0) return;
    const transport = getMqttTransport();
    if (!transport) return;

    const targets = allChats.filter((c) => selectedForwardChatIds.includes(c.id));
    const nextForwardCount = (forwardCandidate.forwardCount || 0) + 1;

    for (const target of targets) {
      if (target.isGroup) {
        await transport.sendGroupMessage(target, forwardCandidate.text || "", {
          messageType: forwardCandidate.messageType,
          media: forwardCandidate.media,
          poll: forwardCandidate.poll,
          location: forwardCandidate.location,
          contact: forwardCandidate.contact,
          event: forwardCandidate.event,
          forwardCount: nextForwardCount,
        });
      } else {
        await transport.sendMessage(
          {
            id: target.id,
            phoneNumber: target.peerPhoneNumber,
            displayName: target.peerDisplayName,
          },
          forwardCandidate.text || "",
          {
            messageType: forwardCandidate.messageType,
            media: forwardCandidate.media,
            poll: forwardCandidate.poll,
            location: forwardCandidate.location,
            contact: forwardCandidate.contact,
            event: forwardCandidate.event,
            forwardCount: nextForwardCount,
          }
        );
      }
    }

    setShowForwardModal(false);
    setForwardCandidate(null);
    setSelectedForwardChatIds([]);
  };

  return (
    <div
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      onPaste={handlePaste}
      className="flex-1 h-full flex flex-col bg-[#0b141a] text-[#e9edef] overflow-hidden relative"
    >
      {/* Hidden File Inputs for Attachments */}
      <input
        ref={fileInputMediaRef}
        type="file"
        accept="image/*,video/*"
        onChange={handleMediaFileSelect}
        className="hidden"
      />
      <input
        ref={fileInputDocRef}
        type="file"
        accept="*/*"
        onChange={handleMediaFileSelect}
        className="hidden"
      />

      {/* Top Conversation Header */}
      <div className="h-16 px-4 bg-[#202c33] flex items-center justify-between border-b border-[#222e35] select-none z-10">
        <div
          onClick={() => chat.isGroup && setIsGroupDrawerOpen(true)}
          className={`flex items-center gap-3 ${chat.isGroup ? "cursor-pointer hover:opacity-90" : ""}`}
        >
          {onBack && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onBack();
              }}
              className="md:hidden p-1.5 -ml-1 text-[#aebac1] hover:text-white rounded-full transition"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
          )}

          <div className="w-10 h-10 rounded-full bg-[#00a884]/20 text-[#00a884] flex items-center justify-center font-semibold text-base relative flex-shrink-0">
            {chat.isGroup ? (
              <Users className="w-5 h-5" />
            ) : chat.peerDisplayName ? (
              chat.peerDisplayName.charAt(0).toUpperCase()
            ) : (
              <UserIcon className="w-5 h-5" />
            )}
            {isPeerOnline && !chat.isGroup && (
              <span className="absolute bottom-0 right-0 w-3 h-3 bg-[#00a884] rounded-full border-2 border-[#202c33]" />
            )}
          </div>

          <div className="flex flex-col">
            <span className="text-sm font-semibold text-white leading-tight flex items-center gap-1.5">
              <span>{chat.peerDisplayName || chat.peerPhoneNumber || chat.id}</span>
              {chat.isGroup && (
                <span className="text-[10px] bg-[#2a3942] text-[#8696a0] px-1.5 py-0.2 rounded font-normal">
                  Group
                </span>
              )}
            </span>
            <span className="text-[12px] leading-tight">
              {chat.isGroup ? (
                <span className="text-[#8696a0]">tap here for group info</span>
              ) : isPeerTyping ? (
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
          {chat.isGroup && (
            <button
              onClick={() => setIsGroupDrawerOpen(true)}
              title="Group info"
              className="p-2 hover:bg-[#374248] rounded-full transition"
            >
              <Info className="w-5 h-5" />
            </button>
          )}
          <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#111b21] border border-[#2a3942] text-[11px] text-[#8696a0]">
            <Lock className="w-3.5 h-3.5 text-[#00a884]" />
            <span className="hidden sm:inline">End-to-End Encrypted</span>
          </div>
          <button
            onClick={() =>
              callManager.startCall(
                chat.id,
                chat.peerDisplayName,
                "video",
                chat.isGroup ? chat.id : undefined
              )
            }
            title="Start Video Call"
            className="p-2 hover:bg-[#374248] text-[#aebac1] hover:text-[#00a884] rounded-full transition"
          >
            <Video className="w-5 h-5" />
          </button>
          <button
            onClick={() =>
              callManager.startCall(
                chat.id,
                chat.peerDisplayName,
                "voice",
                chat.isGroup ? chat.id : undefined
              )
            }
            title="Start Voice Call"
            className="p-2 hover:bg-[#374248] text-[#aebac1] hover:text-[#00a884] rounded-full transition"
          >
            <Phone className="w-5 h-5" />
          </button>
          <div className="relative" ref={moreMenuRef}>
            <button
              onClick={() => setShowMoreMenu(!showMoreMenu)}
              title="More options"
              className={`p-2 rounded-full transition ${showMoreMenu ? "text-white bg-[#374248]" : "hover:bg-[#374248]"}`}
            >
              <MoreVertical className="w-5 h-5" />
            </button>

            {showMoreMenu && (
              <div className="absolute right-0 top-12 z-50 bg-[#202c33] border border-[#2a3942] rounded-2xl py-2 px-1 w-56 shadow-2xl flex flex-col gap-0.5 animate-in fade-in zoom-in-95 duration-100">
                {!chat.isGroup && (
                  <button
                    onClick={handleOpenSafetyNumber}
                    className="flex items-center gap-2.5 px-3 py-2 text-xs text-[#e9edef] hover:bg-[#374248] rounded-xl text-left transition"
                  >
                    <ShieldCheck className="w-4 h-4 text-[#00a884]" />
                    <span>Verify Security Code</span>
                  </button>
                )}

                <button
                  onClick={handleToggleLockChat}
                  className="flex items-center gap-2.5 px-3 py-2 text-xs text-[#e9edef] hover:bg-[#374248] rounded-xl text-left transition"
                >
                  {isChatLocked ? (
                    <>
                      <Unlock className="w-4 h-4 text-[#f59e0b]" />
                      <span>Unlock Chat</span>
                    </>
                  ) : (
                    <>
                      <LockKeyhole className="w-4 h-4 text-[#00a884]" />
                      <span>Lock Chat</span>
                    </>
                  )}
                </button>

                {!chat.isGroup && (
                  <button
                    onClick={handleToggleBlockUser}
                    className="flex items-center gap-2.5 px-3 py-2 text-xs text-[#e9edef] hover:bg-[#374248] rounded-xl text-left transition"
                  >
                    <UserX className="w-4 h-4 text-[#ef4444]" />
                    <span>{isPeerBlocked ? "Unblock Contact" : "Block Contact"}</span>
                  </button>
                )}

                <button
                  onClick={() => {
                    setShowMoreMenu(false);
                    setShowReportModal(true);
                  }}
                  className="flex items-center gap-2.5 px-3 py-2 text-xs text-[#ef4444] hover:bg-[#374248] rounded-xl text-left transition"
                >
                  <AlertOctagon className="w-4 h-4" />
                  <span>{chat.isGroup ? "Report Group" : "Report Contact"}</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Pinned Message Banner */}
      {activePinned && (
        <div className="bg-[#182229] border-b border-[#2a3942] px-4 py-2 flex items-center justify-between text-xs text-[#e9edef] z-10 shadow-sm animate-in slide-in-from-top-1">
          <div className="flex items-center gap-2 truncate">
            <Pin className="w-3.5 h-3.5 text-[#00a884] flex-shrink-0" />
            <span className="text-[#00a884] font-semibold">Pinned:</span>
            <span className="text-[#8696a0] truncate">
              {activePinned.text || (activePinned.messageType === "poll" ? activePinned.poll?.question : activePinned.messageType) || "Message"}
            </span>
          </div>
          <button
            onClick={() => handleTogglePin(activePinned.id)}
            className="text-[#8696a0] hover:text-white text-[11px] px-2 py-0.5 rounded hover:bg-[#202c33] transition"
          >
            Unpin
          </button>
        </div>
      )}

      {/* Message Stream Area */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-4 py-4 md:px-12 flex flex-col justify-start bg-[#0b141a] bg-opacity-95"
      >
        {/* E2EE Banner Notice */}
        <div className="flex justify-center mb-6">
          <div className="max-w-md bg-[#182229] border border-[#2a3942] rounded-xl px-4 py-2.5 text-center text-xs text-[#8696a0] leading-relaxed shadow-sm">
            <Lock className="w-3.5 h-3.5 text-[#00a884] inline mr-1.5 -mt-0.5" />
            {chat.isGroup
              ? "Messages to this group are end-to-end encrypted with Signal Sender Keys. Only group members can read them."
              : "Messages and calls are end-to-end encrypted. No one outside of this chat, not even Chatapp, can read or listen to them."}
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
            onVotePoll={handleVotePoll}
            onTogglePin={handleTogglePin}
            onToggleStar={handleToggleStar}
            onOpenViewOnce={handleOpenViewOnce}
            onOpenMedia={(media) => {
              setActiveLightboxMedia(media);
              setIsLightboxOpen(true);
            }}
            onForward={handleForwardCandidate}
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

      {/* Attachment Options Popover */}
      {showAttachMenu && (
        <div
          ref={attachMenuRef}
          className="absolute bottom-20 left-12 z-40 bg-[#202c33] border border-[#2a3942] rounded-2xl p-2 shadow-2xl flex flex-col gap-1 w-52 animate-in slide-in-from-bottom-3 duration-150"
        >
          <button
            onClick={() => {
              setShowAttachMenu(false);
              fileInputMediaRef.current?.click();
            }}
            className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-[#374248] transition text-left text-xs font-medium text-[#e9edef]"
          >
            <div className="w-8 h-8 rounded-full bg-[#00a884]/20 text-[#00a884] flex items-center justify-center">
              <ImageIcon className="w-4 h-4" />
            </div>
            <span>Photos & Videos</span>
          </button>

          <button
            onClick={() => {
              setShowAttachMenu(false);
              fileInputDocRef.current?.click();
            }}
            className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-[#374248] transition text-left text-xs font-medium text-[#e9edef]"
          >
            <div className="w-8 h-8 rounded-full bg-[#3b82f6]/20 text-[#3b82f6] flex items-center justify-center">
              <FileText className="w-4 h-4" />
            </div>
            <span>Document</span>
          </button>

          <button
            onClick={() => {
              setShowAttachMenu(false);
              setIsRichComposerOpen(true);
            }}
            className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-[#374248] transition text-left text-xs font-medium text-[#e9edef]"
          >
            <div className="w-8 h-8 rounded-full bg-[#8b5cf6]/20 text-[#8b5cf6] flex items-center justify-center">
              <Sparkles className="w-4 h-4" />
            </div>
            <span>Poll, Location, Contact...</span>
          </button>
        </div>
      )}

      {/* Message Input Bottom Bar */}
      {isRecordingVoice ? (
        <VoiceNoteRecorder
          isOpen={isRecordingVoice}
          onCancel={() => setIsRecordingVoice(false)}
          onSend={handleSendVoiceNote}
        />
      ) : (
        <form
          onSubmit={handleSendMessage}
          className="min-h-[62px] px-4 py-2 bg-[#202c33] flex items-center gap-2 border-t border-[#222e35] select-none"
        >
          <button
            type="button"
            onClick={() => setShowStickerPicker(true)}
            title="Stickers, Emojis & GIFs"
            className="p-2 text-[#8696a0] hover:text-white hover:bg-[#374248] rounded-full transition"
          >
            <Smile className="w-5 h-5" />
          </button>

          <button
            type="button"
            onClick={() => setShowAttachMenu(!showAttachMenu)}
            title="Attach Media, Document, or Rich Content"
            className={`p-2 rounded-full transition ${
              showAttachMenu
                ? "text-[#00a884] bg-[#374248]"
                : "text-[#8696a0] hover:text-white hover:bg-[#374248]"
            }`}
          >
            <Paperclip className="w-5 h-5" />
          </button>

          <div className="flex-1 relative">
            <input
              type="text"
              value={inputText}
              onChange={handleInputChange}
              placeholder={isViewOnce ? "Type a view-once message..." : "Type a message"}
              className="w-full bg-[#2a3942] text-sm text-white px-4 py-2.5 rounded-xl focus:outline-none placeholder-[#8696a0]"
            />
          </div>

          {/* View-Once Toggle */}
          <button
            type="button"
            onClick={() => setIsViewOnce(!isViewOnce)}
            title={isViewOnce ? "View-once enabled" : "Set message as view-once"}
            className={`w-9 h-9 rounded-full border-2 flex items-center justify-center font-bold text-xs transition ${
              isViewOnce
                ? "bg-[#00a884]/20 border-[#00a884] text-[#00a884]"
                : "border-[#8696a0] text-[#8696a0] hover:text-white hover:border-white"
            }`}
          >
            1
          </button>

          {inputText.trim() ? (
            <button
              type="submit"
              className="p-2.5 bg-[#00a884] hover:bg-[#02906f] text-white rounded-full transition shadow-md"
            >
              <Send className="w-4 h-4" />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setIsRecordingVoice(true)}
              title="Record Voice Note"
              className="p-2.5 bg-[#00a884] hover:bg-[#02906f] text-white rounded-full transition shadow-md"
            >
              <Mic className="w-4 h-4" />
            </button>
          )}
        </form>
      )}

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

      {/* Group Info Drawer */}
      {chat.isGroup && (
        <GroupInfoDrawer
          chat={chat}
          isOpen={isGroupDrawerOpen}
          onClose={() => setIsGroupDrawerOpen(false)}
        />
      )}

      {/* Rich Message Composer Modal */}
      <RichMessageComposer
        isOpen={isRichComposerOpen}
        onClose={() => setIsRichComposerOpen(false)}
        onSendPoll={handleSendPoll}
        onSendLocation={handleSendLocation}
        onSendContact={handleSendContact}
        onSendEvent={handleSendEvent}
      />

      {/* Media Preview Modal */}
      <MediaPreviewModal
        file={pendingMediaFile}
        isOpen={isMediaPreviewOpen}
        onClose={() => {
          setIsMediaPreviewOpen(false);
          setPendingMediaFile(null);
        }}
        onSend={handleSendMedia}
      />

      {/* Media Lightbox */}
      <MediaLightbox
        media={activeLightboxMedia}
        isOpen={isLightboxOpen}
        onClose={() => {
          setIsLightboxOpen(false);
          setActiveLightboxMedia(null);
        }}
      />

      {/* Sticker & GIF Picker Modal */}
      <StickerGifPicker
        isOpen={showStickerPicker}
        onClose={() => setShowStickerPicker(false)}
        onSelectEmoji={(emoji) => setInputText((prev) => prev + emoji)}
        onSelectSticker={handleSelectSticker}
        onSelectGif={handleSelectGif}
      />

      {/* Safety Number Verification Modal */}
      {showSafetyModal && (
        <SafetyNumberModal
          peerUserId={chat.peerUserId}
          peerDisplayName={chat.peerDisplayName || chat.peerPhoneNumber || "Contact"}
          myUserId={currentUserId}
          myIdentityKeyB64={myIdentityKeyB64}
          peerIdentityKeyB64={peerIdentityKeyB64}
          onClose={() => setShowSafetyModal(false)}
        />
      )}

      {/* Report User Modal */}
      {showReportModal && (
        <ReportUserModal
          reportedUserId={chat.isGroup ? chat.id : chat.peerUserId}
          reportedDisplayName={chat.peerDisplayName || chat.peerPhoneNumber || "Contact"}
          chatId={chat.id}
          onClose={() => setShowReportModal(false)}
        />
      )}

      {/* Forward Message Modal */}
      {showForwardModal && forwardCandidate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-in fade-in">
          <div className="w-full max-w-sm bg-[#202c33] rounded-2xl border border-[#2a3942] p-5 shadow-2xl flex flex-col max-h-[85vh]">
            <div className="flex items-center justify-between pb-3 border-b border-[#2a3942]">
              <div>
                <h3 className="text-sm font-semibold text-white">Forward message to</h3>
                <span className="text-[11px] text-[#8696a0]">
                  {selectedForwardChatIds.length} of {(forwardCandidate.forwardCount || 0) >= 5 ? 1 : 5} selected
                </span>
              </div>
              <button
                onClick={() => {
                  setShowForwardModal(false);
                  setForwardCandidate(null);
                  setSelectedForwardChatIds([]);
                }}
                className="p-1 text-[#8696a0] hover:text-white rounded-full hover:bg-[#374248] transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {(forwardCandidate.forwardCount || 0) >= 5 && (
              <div className="mt-3 p-2.5 bg-[#f59e0b]/15 border border-[#f59e0b]/30 rounded-xl flex items-center gap-2 text-xs text-[#f59e0b]">
                <CornerUpRight className="w-4 h-4 flex-shrink-0" />
                <span>Forwarded many times. Can only be shared with 1 chat at a time.</span>
              </div>
            )}

            <div className="flex-1 overflow-y-auto py-2 my-2 space-y-1">
              {allChats.length === 0 ? (
                <p className="text-center text-xs text-[#8696a0] py-6">No chats available</p>
              ) : (
                allChats.map((c) => {
                  const isSelected = selectedForwardChatIds.includes(c.id);
                  const isMaxReached =
                    !isSelected &&
                    selectedForwardChatIds.length >=
                      ((forwardCandidate.forwardCount || 0) >= 5 ? 1 : 5);

                  return (
                    <button
                      key={c.id}
                      onClick={() => toggleSelectForwardChat(c.id)}
                      disabled={isMaxReached}
                      className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-left transition ${
                        isSelected
                          ? "bg-[#00a884]/20 text-white"
                          : isMaxReached
                          ? "opacity-40 cursor-not-allowed"
                          : "hover:bg-[#111b21] text-[#e9edef]"
                      }`}
                    >
                      <div className="flex items-center gap-2.5 truncate">
                        <div className="w-8 h-8 rounded-full bg-[#00a884]/20 text-[#00a884] flex items-center justify-center font-semibold text-xs flex-shrink-0">
                          {c.isGroup ? <Users className="w-4 h-4" /> : (c.peerDisplayName || c.id).charAt(0).toUpperCase()}
                        </div>
                        <span className="text-xs font-medium truncate">
                          {c.peerDisplayName || c.peerPhoneNumber || c.id}
                        </span>
                      </div>
                      <div className="text-[#00a884]">
                        {isSelected ? (
                          <CheckSquare className="w-4 h-4" />
                        ) : (
                          <Square className="w-4 h-4 text-[#8696a0]" />
                        )}
                      </div>
                    </button>
                  );
                })
              )}
            </div>

            <div className="pt-3 border-t border-[#2a3942] flex justify-end gap-2">
              <button
                onClick={() => {
                  setShowForwardModal(false);
                  setForwardCandidate(null);
                  setSelectedForwardChatIds([]);
                }}
                className="px-4 py-2 rounded-xl text-xs text-[#8696a0] hover:text-white hover:bg-[#374248] transition"
              >
                Cancel
              </button>
              <button
                onClick={handleSendForward}
                disabled={selectedForwardChatIds.length === 0}
                className="px-4 py-2 rounded-xl text-xs bg-[#00a884] hover:bg-[#02906f] text-white font-medium disabled:opacity-50 transition flex items-center gap-1.5"
              >
                <Send className="w-3.5 h-3.5" />
                <span>Send</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

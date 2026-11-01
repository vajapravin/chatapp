import React, { useEffect, useMemo, useState } from "react";
import { format, isToday, isYesterday } from "date-fns";
import {
  Lock,
  LogOut,
  MessageSquare,
  MessageSquarePlus,
  MoreVertical,
  Phone,
  Search,
  Shield,
  User as UserIcon,
  Users,
} from "lucide-react";
import { fetchCurrentUser } from "../services/api";
import { useAuthStore } from "../store/authStore";
import { useChatStore } from "../store/chatStore";
import { useCallStore } from "../store/callStore";
import { initMqttTransport, transportInstance } from "../transport/mqttClient";
import { ConversationView } from "./ConversationView";
import { NewChatModal } from "./NewChatModal";
import { NewGroupModal } from "./NewGroupModal";
import { IncomingCallModal } from "./IncomingCallModal";
import { ActiveCallModal } from "./ActiveCallModal";
import { CallHistoryView } from "./CallHistoryView";

function formatChatTime(timestamp: number): string {
  const date = new Date(timestamp);
  if (isToday(date)) {
    return format(date, "h:mm a");
  }
  if (isYesterday(date)) {
    return "Yesterday";
  }
  return format(date, "M/d/yy");
}

export const ChatListShell: React.FC = () => {
  const { user, userId, deviceId, setUser, logout } = useAuthStore();
  const {
    chats,
    activeChatId,
    presence,
    peerTyping,
    loadInitialData,
    setActiveChat,
  } = useChatStore();

  const [searchFilter, setSearchFilter] = useState("");
  const [isNewChatModalOpen, setIsNewChatModalOpen] = useState(false);
  const [isNewGroupModalOpen, setIsNewGroupModalOpen] = useState(false);
  const [currentTab, setCurrentTab] = useState<"chats" | "calls">("chats");

  const { callLogs, loadCallLogs } = useCallStore();
  const missedCount = useMemo(
    () => callLogs.filter((l) => l.status === "missed" && l.direction === "incoming").length,
    [callLogs]
  );

  useEffect(() => {
    loadCallLogs();
  }, [loadCallLogs]);

  // Fetch user profile on mount
  useEffect(() => {
    fetchCurrentUser().then((profile) => {
      if (profile) setUser(profile);
    });
  }, [setUser]);

  // Load chats & initialize MQTT transport
  useEffect(() => {
    loadInitialData();

    if (userId) {
      initMqttTransport(userId, deviceId || 1).catch((err) => {
        console.error("Failed to initialize MQTT transport:", err);
      });
    }

    return () => {
      if (transportInstance) {
        transportInstance.disconnect();
      }
    };
  }, [userId, deviceId, loadInitialData]);

  const activeChat = useMemo(
    () => chats.find((c) => c.id === activeChatId),
    [chats, activeChatId]
  );

  const filteredChats = useMemo(() => {
    if (!searchFilter.trim()) return chats;
    const q = searchFilter.toLowerCase();
    return chats.filter(
      (c) =>
        (c.peerDisplayName && c.peerDisplayName.toLowerCase().includes(q)) ||
        c.peerPhoneNumber.includes(q) ||
        c.lastMessageText.toLowerCase().includes(q)
    );
  }, [chats, searchFilter]);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#111b21] text-[#e9edef]">
      {/* Left Sidebar (Chats List) */}
      <div
        className={`${
          activeChat ? "hidden md:flex" : "flex"
        } w-full md:w-[420px] md:min-w-[340px] h-full flex-col border-r border-[#222e35] bg-[#111b21]`}
      >
        {/* Top Header */}
        <div className="h-16 px-4 bg-[#202c33] flex items-center justify-between border-b border-[#222e35] select-none">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-[#00a884]/20 text-[#00a884] flex items-center justify-center font-semibold">
              {user?.display_name ? (
                user.display_name.charAt(0).toUpperCase()
              ) : (
                <UserIcon className="w-5 h-5" />
              )}
            </div>
            <div className="flex flex-col">
              <span className="text-sm font-semibold text-white leading-tight">
                {user?.display_name || user?.phone_number || "You"}
              </span>
              <span className="text-[11px] text-[#8696a0] flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-[#00a884] inline-block" />
                <span>Device #{deviceId || 1}</span>
              </span>
            </div>
          </div>

          <div className="flex items-center gap-1 text-[#aebac1]">
            <button
              onClick={() => setIsNewGroupModalOpen(true)}
              title="New Group"
              className="p-2 hover:bg-[#374248] rounded-full transition"
            >
              <Users className="w-5 h-5" />
            </button>
            <button
              onClick={() => setIsNewChatModalOpen(true)}
              title="New Chat"
              className="p-2 hover:bg-[#374248] rounded-full transition"
            >
              <MessageSquarePlus className="w-5 h-5" />
            </button>
            <button
              title="Menu"
              className="p-2 hover:bg-[#374248] rounded-full transition"
            >
              <MoreVertical className="w-5 h-5" />
            </button>
            <button
              onClick={logout}
              title="Sign Out"
              className="p-2 hover:bg-[#374248] rounded-full text-red-400 hover:text-red-300 transition"
            >
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Navigation Tabs: Chats vs Calls */}
        <div className="flex items-center border-b border-[#222e35] bg-[#202c33]/40">
          <button
            onClick={() => setCurrentTab("chats")}
            className={`flex-1 py-2.5 flex items-center justify-center gap-2 text-xs font-semibold transition border-b-2 ${
              currentTab === "chats"
                ? "border-[#00a884] text-[#00a884]"
                : "border-transparent text-[#8696a0] hover:text-white"
            }`}
          >
            <MessageSquare className="w-4 h-4" />
            <span>Chats</span>
          </button>
          <button
            onClick={() => setCurrentTab("calls")}
            className={`flex-1 py-2.5 flex items-center justify-center gap-2 text-xs font-semibold transition border-b-2 ${
              currentTab === "calls"
                ? "border-[#00a884] text-[#00a884]"
                : "border-transparent text-[#8696a0] hover:text-white"
            }`}
          >
            <Phone className="w-4 h-4" />
            <span>Calls</span>
            {missedCount > 0 && (
              <span className="bg-red-500 text-white text-[10px] font-bold px-1.5 py-0.2 rounded-full">
                {missedCount}
              </span>
            )}
          </button>
        </div>

        {currentTab === "calls" ? (
          <CallHistoryView />
        ) : (
          <>
            {/* Search Bar */}
            <div className="px-3 py-2 border-b border-[#222e35]">
              <div className="flex items-center gap-3 px-3 py-1.5 rounded-lg bg-[#202c33] text-[#8696a0]">
                <Search className="w-4 h-4 text-[#8696a0]" />
                <input
                  type="text"
                  value={searchFilter}
                  onChange={(e) => setSearchFilter(e.target.value)}
                  placeholder="Search or start a new chat"
                  className="w-full bg-transparent text-sm text-white focus:outline-none placeholder-[#8696a0]"
                />
              </div>
            </div>

            {/* Chats Scroll Area */}
            <div className="flex-1 overflow-y-auto">
              {filteredChats.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center p-6 text-center">
                  <div className="w-14 h-14 rounded-full bg-[#202c33] flex items-center justify-center mb-3">
                    <Shield className="w-7 h-7 text-[#00a884]" />
                  </div>
                  <h2 className="text-base font-semibold text-white">No Conversations</h2>
                  <p className="text-xs text-[#8696a0] max-w-xs mt-1.5 leading-relaxed">
                    Start a secure 1:1 conversation with end-to-end Signal encryption.
                  </p>
                  <button
                    onClick={() => setIsNewChatModalOpen(true)}
                    className="mt-4 px-4 py-2 rounded-xl bg-[#00a884] hover:bg-[#02906f] text-white text-xs font-semibold transition"
                  >
                    Start New Chat
                  </button>
                </div>
              ) : (
                filteredChats.map((chat) => {
                  const isSelected = chat.id === activeChatId;
                  const isOnline = presence[chat.id]?.isOnline;
                  const isTyping = peerTyping[chat.id];

                  return (
                    <div
                      key={chat.id}
                      onClick={() => setActiveChat(chat.id)}
                      className={`flex items-center gap-3 px-3.5 py-3 cursor-pointer border-b border-[#202c33] hover:bg-[#202c33] transition ${
                        isSelected ? "bg-[#2a3942]" : ""
                      }`}
                    >
                      {/* Contact Avatar */}
                      <div className="w-12 h-12 rounded-full bg-[#00a884]/20 text-[#00a884] flex items-center justify-center font-semibold text-base flex-shrink-0 relative">
                        {chat.isGroup ? (
                          <Users className="w-6 h-6" />
                        ) : chat.peerDisplayName ? (
                          chat.peerDisplayName.charAt(0).toUpperCase()
                        ) : (
                          <UserIcon className="w-6 h-6" />
                        )}
                        {isOnline && !chat.isGroup && (
                          <span className="absolute bottom-0 right-0 w-3 h-3 bg-[#00a884] rounded-full border-2 border-[#111b21]" />
                        )}
                      </div>

                      {/* Contact Details & Last Message */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-0.5">
                          <span className="text-sm font-semibold text-white truncate flex items-center gap-1.5">
                            <span>{chat.peerDisplayName || chat.peerPhoneNumber || chat.id}</span>
                            {chat.isGroup && (
                              <span className="text-[10px] bg-[#2a3942] text-[#8696a0] px-1.5 py-0.2 rounded font-normal">
                                Group
                              </span>
                            )}
                          </span>
                          <span className="text-[11px] text-[#8696a0] flex-shrink-0">
                            {formatChatTime(chat.lastMessageTimestamp)}
                          </span>
                        </div>

                        <div className="flex items-center justify-between">
                          <span className="text-xs truncate pr-2">
                            {isTyping ? (
                              <span className="text-[#00a884] font-medium animate-pulse">
                                typing...
                              </span>
                            ) : (
                              <span className="text-[#8696a0]">{chat.lastMessageText}</span>
                            )}
                          </span>

                          {chat.unreadCount > 0 && (
                            <span className="bg-[#00a884] text-[#111b21] text-[11px] font-bold px-1.5 py-0.5 rounded-full min-w-[20px] text-center">
                              {chat.unreadCount}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </>
        )}
      </div>

      {/* Right Canvas: Conversation View or Empty Placeholder */}
      <div
        className={`${
          activeChat ? "flex" : "hidden md:flex"
        } flex-1 h-full`}
      >
        {activeChat ? (
          <ConversationView
            chat={activeChat}
            onBack={() => setActiveChat(null)}
          />
        ) : (
          <div className="flex-1 h-full bg-[#222e35] flex flex-col items-center justify-center p-8 border-b-[6px] border-[#00a884] relative select-none">
            <div className="max-w-md text-center flex flex-col items-center">
              <div className="w-24 h-24 rounded-full bg-[#111b21] flex items-center justify-center mb-6 border border-[#2a3942] shadow-xl">
                <Lock className="w-10 h-10 text-[#00a884]" />
              </div>

              <h1 className="text-3xl font-light text-[#e9edef] tracking-wide mb-3">
                Chatapp for Web
              </h1>

              <p className="text-sm text-[#8696a0] leading-relaxed mb-6">
                Send and receive messages with zero-knowledge end-to-end encryption.
                Messages never leave your device unencrypted.
              </p>

              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-[#111b21] border border-[#2a3942] text-xs text-[#8696a0]">
                <Lock className="w-3.5 h-3.5 text-[#00a884]" />
                <span>End-to-end encrypted with Signal Protocol</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* New Chat Modal */}
      <NewChatModal
        isOpen={isNewChatModalOpen}
        onClose={() => setIsNewChatModalOpen(false)}
      />

      {/* New Group Modal */}
      <NewGroupModal
        isOpen={isNewGroupModalOpen}
        onClose={() => setIsNewGroupModalOpen(false)}
        onGroupCreated={(groupChat) => {
          setActiveChat(groupChat.id);
        }}
      />

      {/* Call Modals */}
      <IncomingCallModal />
      <ActiveCallModal />
    </div>
  );
};

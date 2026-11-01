import React, { useEffect, useMemo, useState } from "react";
import { format, isToday, isYesterday } from "date-fns";
import {
  Lock,
  MessageSquarePlus,
  Phone,
  Search,
  User as UserIcon,
  Users,
  ChevronDown,
  ChevronRight,
  Hash,
  Plus,
  Radio,
  Volume2,
  VolumeX,
} from "lucide-react";
import { fetchCurrentUser } from "../services/api";
import { useAuthStore } from "../store/authStore";
import { useChatStore } from "../store/chatStore";
import { useCallStore } from "../store/callStore";
import { usePrivacyStore } from "../store/privacyStore";
import { useChannelStore } from "../store/channelStore";
import { useRadioStore } from "../store/radioStore";
import { initMqttTransport, transportInstance } from "../transport/mqttClient";
import { ConversationView } from "./ConversationView";
import { NewChatModal } from "./NewChatModal";
import { NewGroupModal } from "./NewGroupModal";
import { IncomingCallModal } from "./IncomingCallModal";
import { ActiveCallModal } from "./ActiveCallModal";
import { CallHistoryView } from "./CallHistoryView";
import { SettingsModal } from "./SettingsModal";
import { AdminModerationModal } from "./AdminModerationModal";
import { AppLockOverlay } from "./AppLockOverlay";
import { LeftRail } from "./dashboard/LeftRail";
import { ChannelSidebar } from "./dashboard/ChannelSidebar";
import { ChannelView } from "./dashboard/ChannelView";
import { NewChannelModal } from "./dashboard/NewChannelModal";
import { QuickSwitcherModal } from "./dashboard/QuickSwitcherModal";

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

  const {
    channels,
    activeChannelId,
    pendingInvites,
    loadChannels,
    loadPendingInvites,
    setActiveChannelId,
    acceptInvite,
    declineInvite,
  } = useChannelStore();

  const [searchFilter, setSearchFilter] = useState("");
  const [isNewChatModalOpen, setIsNewChatModalOpen] = useState(false);
  const [isNewGroupModalOpen, setIsNewGroupModalOpen] = useState(false);
  const [isNewChannelModalOpen, setIsNewChannelModalOpen] = useState(false);
  const [isQuickSwitcherOpen, setIsQuickSwitcherOpen] = useState(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [isAdminModalOpen, setIsAdminModalOpen] = useState(false);
  const [currentTab, setCurrentTab] = useState<"chats" | "channels" | "calls">("channels");

  const isTunedIn = useRadioStore((state) => state.isTunedIn);
  const radioData = useRadioStore((state) => state.radioData);
  const setTunedIn = useRadioStore((state) => state.setTunedIn);
  const isMuted = useRadioStore((state) => state.isMuted);
  const setMuted = useRadioStore((state) => state.setMuted);

  const {
    lockedChatIds,
    isLockedChatsFolderOpen,
    setLockedChatsFolderOpen,
    loadLockedChats,
    recordActivity,
  } = usePrivacyStore();

  const { callLogs, loadCallLogs } = useCallStore();
  const missedCount = useMemo(
    () => callLogs.filter((l) => l.status === "missed" && l.direction === "incoming").length,
    [callLogs]
  );

  const unreadChatsCount = useMemo(
    () => chats.reduce((sum, c) => sum + (c.unreadCount || 0), 0),
    [chats]
  );

  const unreadChannelsCount = useMemo(
    () => channels.reduce((sum, c) => sum + (c.unread_count || 0), 0) + pendingInvites.length,
    [channels, pendingInvites]
  );

  const isAdmin = useMemo(
    () => user?.role === "admin" || !!user?.phone_number?.endsWith("000"),
    [user]
  );

  useEffect(() => {
    loadCallLogs();
    loadLockedChats();
    loadChannels();
    loadPendingInvites();
  }, [loadCallLogs, loadLockedChats, loadChannels, loadPendingInvites]);

  // Activity tracking for App Lock auto-lock
  useEffect(() => {
    const onActivity = () => recordActivity();
    window.addEventListener("mousemove", onActivity);
    window.addEventListener("keydown", onActivity);
    return () => {
      window.removeEventListener("mousemove", onActivity);
      window.removeEventListener("keydown", onActivity);
    };
  }, [recordActivity]);

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

  // Subscribe to active channel MQTT topic
  useEffect(() => {
    if (activeChannelId) {
      transportInstance?.subscribeChannel(activeChannelId);
    }
  }, [activeChannelId]);

  // Global hotkeys (Ctrl+K for quick switcher, Alt+Up/Down for channels)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setIsQuickSwitcherOpen((prev) => !prev);
        return;
      }

      if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
        if (currentTab === "channels" && channels.length > 0) {
          e.preventDefault();
          const curIdx = channels.findIndex((c) => c.id === activeChannelId);
          const nextIdx =
            e.key === "ArrowDown"
              ? (curIdx + 1) % channels.length
              : (curIdx - 1 + channels.length) % channels.length;
          const nextChan = channels[nextIdx];
          if (nextChan) {
            setActiveChannelId(nextChan.id);
            transportInstance?.subscribeChannel(nextChan.id);
          }
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [currentTab, channels, activeChannelId, setActiveChannelId]);

  const activeChat = useMemo(
    () => chats.find((c) => c.id === activeChatId),
    [chats, activeChatId]
  );

  const activeChannel = useMemo(
    () => channels.find((c) => c.id === activeChannelId),
    [channels, activeChannelId]
  );

  const filteredChats = useMemo(() => {
    let list = chats;
    if (!isLockedChatsFolderOpen) {
      list = list.filter((c) => !lockedChatIds.includes(c.id));
    } else {
      list = list.filter((c) => lockedChatIds.includes(c.id));
    }
    if (!searchFilter.trim()) return list;
    const q = searchFilter.toLowerCase();
    return list.filter(
      (c) =>
        (c.peerDisplayName && c.peerDisplayName.toLowerCase().includes(q)) ||
        c.peerPhoneNumber.includes(q) ||
        c.lastMessageText.toLowerCase().includes(q)
    );
  }, [chats, searchFilter, lockedChatIds, isLockedChatsFolderOpen]);

  const isMobileDetailOpen =
    (currentTab === "chats" && !!activeChat) ||
    (currentTab === "channels" && !!activeChannel);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#111b21] text-[#e9edef]">
      {/* 72px Discord-style Left Rail */}
      <div className={`${isMobileDetailOpen ? "hidden md:flex" : "flex"} shrink-0`}>
        <LeftRail
          currentTab={currentTab}
          onTabChange={(tab) => {
            setCurrentTab(tab);
            if (tab === "channels" && !activeChannelId && channels.length > 0) {
              setActiveChannelId(channels[0].id);
            }
          }}
          user={user}
          unreadChatsCount={unreadChatsCount}
          unreadChannelsCount={unreadChannelsCount}
          missedCallsCount={missedCount}
          isAdmin={isAdmin}
          onOpenAdmin={() => setIsAdminModalOpen(true)}
          onOpenSettings={() => setIsSettingsModalOpen(true)}
          onLogout={logout}
        />
      </div>

      {/* Main Workspace based on currentTab */}
      <div className={`flex-1 flex h-full overflow-hidden ${currentTab === "channels" ? "" : "hidden"}`}>
        {/* Channel Sidebar (240px) */}
        <div
          className={`${
            activeChannel ? "hidden md:flex" : "flex"
          } w-full md:w-[240px] md:min-w-[240px] h-full flex-col shrink-0`}
        >
          <ChannelSidebar
            channels={channels}
            activeChannelId={activeChannelId}
            onSelectChannel={(id) => {
              setActiveChannelId(id);
              transportInstance?.subscribeChannel(id);
            }}
            onOpenNewChannelModal={() => setIsNewChannelModalOpen(true)}
            pendingInvites={pendingInvites}
            onAcceptInvite={acceptInvite}
            onDeclineInvite={declineInvite}
          />
        </div>

        {/* Active Channel View */}
        <div
          className={`${
            activeChannel ? "flex" : "hidden md:flex"
          } flex-1 h-full overflow-hidden`}
        >
          {activeChannel ? (
            <ChannelView
              channel={activeChannel}
              onBack={() => setActiveChannelId(null)}
            />
          ) : (
            <div className="flex-1 h-full bg-[#0b141a] flex flex-col items-center justify-center p-8 border-b-[6px] border-[#00a884] select-none text-center">
              <div className="w-20 h-20 rounded-2xl bg-[#202c33] flex items-center justify-center mb-4 text-[#00a884] border border-[#2a3942] shadow-xl">
                <Hash className="w-10 h-10" />
              </div>
              <h2 className="text-xl font-bold text-white mb-2">No Channel Selected</h2>
              <p className="text-xs text-[#8696a0] max-w-sm mb-6">
                Pick a channel from the sidebar or create a new private channel to collaborate with Slack-style posts and synchronized YouTube radio.
              </p>
              <button
                onClick={() => setIsNewChannelModalOpen(true)}
                className="px-4 py-2 bg-[#00a884] hover:bg-[#02906f] text-[#111b21] rounded-xl text-xs font-bold transition flex items-center gap-1.5 shadow-lg shadow-[#00a884]/20"
              >
                <Plus className="w-4 h-4" />
                Create Channel
              </button>
            </div>
          )}
        </div>
      </div>

      <div className={`flex-1 flex h-full overflow-hidden ${currentTab === "chats" ? "" : "hidden"}`}>
          {/* Chats List Column */}
          <div
            className={`${
              activeChat ? "hidden md:flex" : "flex"
            } w-full md:w-[380px] md:min-w-[320px] h-full flex-col border-r border-[#222e35] bg-[#111b21] shrink-0`}
          >
            {/* Top Header */}
            <div className="h-16 px-4 bg-[#202c33] flex items-center justify-between border-b border-[#222e35] select-none">
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold tracking-wide uppercase text-white">Direct Chats</span>
                <span className="text-xs px-1.5 py-0.5 rounded-full bg-[#111b21] text-[#8696a0] font-mono">
                  {chats.length}
                </span>
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
              </div>
            </div>

            {/* Search Bar */}
            <div className="px-3 py-2 border-b border-[#222e35]">
              <div className="flex items-center gap-3 px-3 py-1.5 rounded-lg bg-[#202c33] text-[#8696a0]">
                <Search className="w-4 h-4 text-[#8696a0]" />
                <input
                  type="text"
                  placeholder="Search chats..."
                  value={searchFilter}
                  onChange={(e) => setSearchFilter(e.target.value)}
                  className="w-full bg-transparent text-sm text-[#d1d7db] placeholder-[#8696a0] focus:outline-none"
                />
              </div>
            </div>

            {/* Locked Chats Folder Pill */}
            {lockedChatIds.length > 0 && (
              <div
                onClick={() => setLockedChatsFolderOpen(!isLockedChatsFolderOpen)}
                className="flex items-center justify-between px-4 py-3 border-b border-[#222e35] bg-[#182229]/50 hover:bg-[#202c33]/50 cursor-pointer transition select-none"
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-[#00a884]/20 text-[#00a884] flex items-center justify-center">
                    <Lock className="w-4 h-4" />
                  </div>
                  <div className="flex flex-col">
                    <span className="text-sm font-semibold text-white">Locked Chats</span>
                    <span className="text-xs text-[#8696a0]">
                      {lockedChatIds.length} {lockedChatIds.length === 1 ? "chat" : "chats"} protected
                    </span>
                  </div>
                </div>
                <div className="text-[#8696a0]">
                  {isLockedChatsFolderOpen ? (
                    <ChevronDown className="w-4 h-4" />
                  ) : (
                    <ChevronRight className="w-4 h-4" />
                  )}
                </div>
              </div>
            )}

            {/* Chat List Items */}
            <div className="flex-1 overflow-y-auto">
              {filteredChats.length === 0 ? (
                <div className="p-8 text-center text-[#8696a0] text-sm">
                  {searchFilter ? "No chats found." : "No chats yet. Start a conversation!"}
                </div>
              ) : (
                filteredChats.map((chat) => {
                  const isPeerOnline = presence[chat.peerUserId]?.isOnline;
                  const isPeerTypingNow = peerTyping[chat.peerUserId];
                  const isSelected = chat.id === activeChatId;

                  return (
                    <div
                      key={chat.id}
                      onClick={() => setActiveChat(chat.id)}
                      className={`flex items-center gap-3 px-4 py-3 cursor-pointer select-none transition border-b border-[#222e35]/50 ${
                        isSelected ? "bg-[#2a3942]" : "hover:bg-[#202c33]"
                      }`}
                    >
                      {/* Avatar */}
                      <div className="relative shrink-0">
                        <div className="w-12 h-12 rounded-full bg-[#202c33] border border-[#2a3942] flex items-center justify-center text-base font-semibold text-[#00a884]">
                          {chat.peerDisplayName
                            ? chat.peerDisplayName.charAt(0).toUpperCase()
                            : chat.isGroup
                            ? <Users className="w-5 h-5" />
                            : <UserIcon className="w-5 h-5" />}
                        </div>
                        {!chat.isGroup && isPeerOnline && (
                          <span className="absolute bottom-0 right-0 w-3.5 h-3.5 rounded-full bg-[#00a884] border-2 border-[#111b21]" />
                        )}
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm font-semibold text-white truncate">
                            {chat.peerDisplayName || chat.peerPhoneNumber || "Unknown"}
                          </span>
                          {chat.lastMessageTimestamp > 0 && (
                            <span className="text-[11px] text-[#8696a0] shrink-0 ml-2">
                              {formatChatTime(chat.lastMessageTimestamp)}
                            </span>
                          )}
                        </div>

                        <div className="flex items-center justify-between">
                          <span className="text-xs text-[#8696a0] truncate">
                            {isPeerTypingNow ? (
                              <span className="text-[#00a884] font-medium">typing...</span>
                            ) : (
                              chat.lastMessageText || "No messages yet"
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

            {/* Background Radio Banner when listening and browsing chats */}
            {isTunedIn && (
              <div className="p-2.5 bg-[#111b21] border-t border-[#222e35] flex items-center justify-between text-xs select-none">
                <div
                  className="flex items-center gap-2 min-w-0 cursor-pointer flex-1"
                  onClick={() => setCurrentTab("channels")}
                  title="Click to view channel radio"
                >
                  <div className="w-7 h-7 rounded-lg bg-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0">
                    <Radio className="w-3.5 h-3.5 animate-pulse" />
                  </div>
                  <div className="min-w-0 truncate">
                    <div className="text-[11px] font-bold text-white truncate flex items-center gap-1">
                      <span>Background Radio</span>
                      <span className="text-[9px] bg-emerald-500/20 text-emerald-400 px-1 rounded">Live</span>
                    </div>
                    <div className="text-[10px] text-[#8696a0] truncate">
                      {channels.find((c) => radioData[c.id]?.current_track)?.name || "Channel Station"}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-1 shrink-0 ml-2">
                  <button
                    onClick={() => setMuted(!isMuted)}
                    className="p-1.5 text-[#8696a0] hover:text-white rounded transition"
                    title={isMuted ? "Unmute" : "Mute"}
                  >
                    {isMuted ? <VolumeX className="w-3.5 h-3.5 text-red-400" /> : <Volume2 className="w-3.5 h-3.5" />}
                  </button>
                  <button
                    onClick={() => setTunedIn(false)}
                    className="px-2 py-1 bg-red-500/20 text-red-400 hover:bg-red-500/30 rounded text-[10px] font-bold transition"
                    title="Go off air (stop listening)"
                  >
                    Go Off Air
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Chat Conversation Canvas */}
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
        </div>

        <div className={`flex-1 flex h-full overflow-hidden ${currentTab === "calls" ? "" : "hidden"}`}>
          <div className="w-full md:w-[380px] md:min-w-[320px] h-full flex flex-col border-r border-[#222e35] bg-[#111b21]">
            <CallHistoryView />
          </div>
          <div className="hidden md:flex flex-1 h-full bg-[#222e35] items-center justify-center p-8 border-b-[6px] border-[#00a884]">
            <div className="max-w-md text-center">
              <Phone className="w-16 h-16 text-[#00a884] mx-auto mb-4" />
              <h2 className="text-xl font-bold text-white mb-2">Voice & Video Calls</h2>
              <p className="text-xs text-[#8696a0]">
                Select a contact or open a chat to place an end-to-end encrypted WebRTC audio or video call.
              </p>
            </div>
          </div>
        </div>

      {/* Quick Switcher Modal (Ctrl+K) */}
      {isQuickSwitcherOpen && (
        <QuickSwitcherModal
          channels={channels}
          chats={chats}
          onSelectChannel={(chanId) => {
            setCurrentTab("channels");
            setActiveChannelId(chanId);
            transportInstance?.subscribeChannel(chanId);
          }}
          onSelectChat={(chatId) => {
            setCurrentTab("chats");
            setActiveChat(chatId);
          }}
          onClose={() => setIsQuickSwitcherOpen(false)}
        />
      )}

      {/* New Channel Modal */}
      {isNewChannelModalOpen && (
        <NewChannelModal onClose={() => setIsNewChannelModalOpen(false)} />
      )}

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
          setCurrentTab("chats");
          setActiveChat(groupChat.id);
        }}
      />

      {/* Call Modals */}
      <IncomingCallModal />
      <ActiveCallModal />

      {/* Settings Modal */}
      {isSettingsModalOpen && (
        <SettingsModal
          onClose={() => setIsSettingsModalOpen(false)}
          onOpenAdminModeration={() => {
            setIsSettingsModalOpen(false);
            setIsAdminModalOpen(true);
          }}
        />
      )}

      {/* Admin Moderation Modal */}
      {isAdminModalOpen && (
        <AdminModerationModal onClose={() => setIsAdminModalOpen(false)} />
      )}

      {/* App Lock Screen Overlay */}
      <AppLockOverlay />
    </div>
  );
};

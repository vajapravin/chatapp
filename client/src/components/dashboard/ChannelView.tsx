import React, { useState, useEffect, useRef } from "react";
import {
  Hash,
  Radio,
  Users,
  Settings,
  ArrowDown,
  Trash2,
  PanelRightClose,
  ChevronLeft,
} from "lucide-react";
import { MarkdownRenderer } from "../posts/MarkdownRenderer";
import { PostComposer } from "../posts/PostComposer";
import { RadioPanel } from "../radio/RadioPanel";
import { AskLlmModal } from "../radio/AskLlmModal";
import { AddMusicModal } from "../radio/AddMusicModal";
import { ChannelSettingsModal } from "./ChannelSettingsModal";
import { useChannelStore, ChannelItem } from "../../store/channelStore";
import { useAuthStore } from "../../store/authStore";
import { useRadioStore } from "../../store/radioStore";

interface ChannelViewProps {
  channel: ChannelItem;
  onBack?: () => void;
}

export const ChannelView: React.FC<ChannelViewProps> = ({ channel, onBack }) => {
  const { user } = useAuthStore();
  const {
    activeChannelMembers,
    loadChannelMembers,
    posts,
    loadPosts,
    createPost,
    deletePost,
  } = useChannelStore();
  const { radioData } = useRadioStore();

  const [showSettings, setShowSettings] = useState(false);
  const [showAskLlm, setShowAskLlm] = useState(false);
  const [showAddMusic, setShowAddMusic] = useState(false);
  const [showRadioPanel, setShowRadioPanel] = useState(true);
  const [showMobileDrawer, setShowMobileDrawer] = useState(false);

  const channelPosts = posts[channel.id] || [];
  const radio = radioData[channel.id];
  const isOwner = channel.current_user_role === "owner" || user?.role === "admin";
  const isOnAir = radio?.status === "playing" || radio?.status === "paused";

  const scrollRef = useRef<HTMLDivElement>(null);
  const [isNearBottom, setIsNearBottom] = useState(true);

  // Load members and posts whenever channel changes
  useEffect(() => {
    loadChannelMembers(channel.id);
    loadPosts(channel.id);
  }, [channel.id, loadChannelMembers, loadPosts]);

  // Scroll to bottom on initial load and when new posts arrive if already at bottom
  useEffect(() => {
    if (isNearBottom && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [channelPosts.length, isNearBottom]);

  const handleScroll = () => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    const distanceToBottom = scrollHeight - (scrollTop + clientHeight);
    setIsNearBottom(distanceToBottom < 100);
  };

  const scrollToBottom = () => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior: "smooth",
      });
      setIsNearBottom(true);
    }
  };

  const handleSendPost = async (content: string) => {
    await createPost(channel.id, content);
  };

  const handleDeletePost = async (postId: string) => {
    if (window.confirm("Are you sure you want to delete this post?")) {
      await deletePost(channel.id, postId);
    }
  };

  const formatPostTime = (timestamp: number) => {
    const d = new Date(timestamp);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-[#0b141a] overflow-hidden select-text">
      {/* Channel Header */}
      <header className="h-14 px-4 bg-[#111b21] border-b border-[#202c33] flex items-center justify-between shrink-0 z-10">
        <div className="flex items-center gap-3 min-w-0">
          {onBack && (
            <button
              onClick={onBack}
              className="md:hidden p-1.5 -ml-1 text-[#8696a0] hover:text-white rounded-lg transition"
              title="Back to Channels"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
          )}
          <div className="w-8 h-8 rounded-lg bg-[#202c33] flex items-center justify-center text-[#00a884]">
            <Hash className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-sm font-bold text-white truncate">
                {channel.name}
              </h1>
              {isOnAir && (
                <span className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-rose-500/20 text-rose-400 animate-pulse border border-rose-500/30">
                  <span className="w-1.5 h-1.5 rounded-full bg-rose-500"></span>
                  LIVE
                </span>
              )}
            </div>
            {channel.topic && (
              <p className="text-[11px] text-[#8696a0] truncate max-w-md">
                {channel.topic}
              </p>
            )}
          </div>
        </div>

        {/* Action icons */}
        <div className="flex items-center gap-1.5 text-[#8696a0]">
          {/* Members count indicator */}
          <div
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#202c33]/60 text-xs text-[#aebac1]"
            title={`${activeChannelMembers.length} members`}
          >
            <Users className="w-3.5 h-3.5 text-[#8696a0]" />
            <span>{activeChannelMembers.length || channel.member_count}</span>
          </div>

          {/* Toggle Radio Panel on larger screens */}
          {channel.radio_enabled && (
            <button
              onClick={() => {
                setShowRadioPanel(!showRadioPanel);
                setShowMobileDrawer(!showMobileDrawer);
              }}
              title={showRadioPanel ? "Hide Radio Panel" : "Show Radio Panel"}
              className={`p-2 rounded-lg transition ${
                isOnAir
                  ? "text-[#00a884] bg-[#00a884]/10 hover:bg-[#00a884]/20"
                  : "hover:text-white hover:bg-[#202c33]"
              }`}
            >
              <Radio className="w-4 h-4" />
            </button>
          )}

          {/* Channel Settings (Owner / Admin) */}
          {isOwner && (
            <button
              onClick={() => setShowSettings(true)}
              title="Channel Settings"
              className="p-2 hover:text-white hover:bg-[#202c33] rounded-lg transition"
            >
              <Settings className="w-4 h-4" />
            </button>
          )}
        </div>
      </header>

      {/* Main Workspace (Post Stream + Right Radio Rail) */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* Post Stream Column */}
        <div className="flex-1 flex flex-col h-full min-w-0">
          {/* Post Message Feed */}
          <div
            ref={scrollRef}
            onScroll={handleScroll}
            className="flex-1 overflow-y-auto px-4 py-4 space-y-4"
          >
            {/* Channel introduction banner */}
            <div className="p-4 rounded-2xl bg-[#111b21] border border-[#202c33] mb-6 space-y-2">
              <div className="w-10 h-10 rounded-xl bg-[#00a884]/20 flex items-center justify-center text-[#00a884]">
                <Hash className="w-5 h-5" />
              </div>
              <h2 className="text-base font-bold text-white">
                Welcome to #{channel.name}!
              </h2>
              <p className="text-xs text-[#8696a0]">
                {channel.topic ||
                  "This is the start of the end-to-end encrypted post stream for this channel."}
              </p>
              <div className="pt-2 flex flex-wrap gap-2 text-[11px] text-[#8696a0]">
                <span className="px-2 py-0.5 rounded bg-[#202c33] text-[#aebac1]">
                  🔒 E2EE Group Messaging
                </span>
                {channel.radio_enabled && (
                  <span className="px-2 py-0.5 rounded bg-[#202c33] text-[#aebac1]">
                    📻 Synced Radio Enabled
                  </span>
                )}
                <span className="px-2 py-0.5 rounded bg-[#202c33] text-[#aebac1]">
                  👥 {activeChannelMembers.length} Members
                </span>
              </div>
            </div>

            {/* Posts */}
            {channelPosts.map((post) => {
              const isCurrentUser = post.sender_user === user?.id;
              const canDelete = isCurrentUser || isOwner;

              return (
                <div
                  key={post.id}
                  className="group relative flex items-start gap-3 p-2 rounded-xl hover:bg-[#111b21]/60 transition"
                >
                  {/* Sender Avatar */}
                  <div className="w-8 h-8 rounded-full bg-[#202c33] border border-[#2a3942] flex items-center justify-center text-xs font-bold text-[#00a884] shrink-0 mt-0.5">
                    {(post.sender_display_name || post.sender_user || "?")
                      .slice(0, 2)
                      .toUpperCase()}
                  </div>

                  {/* Post Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-bold text-white">
                        {post.sender_display_name || post.sender_user}
                      </span>
                      <span className="text-[10px] text-[#8696a0]">
                        {formatPostTime(post.created_at)}
                      </span>
                      {post.edited_at && (
                        <span className="text-[9px] text-[#8696a0] italic">
                          (edited)
                        </span>
                      )}
                    </div>

                    {/* Markdown Renderer */}
                    <div className="text-xs text-[#d1d7db] leading-relaxed">
                      <MarkdownRenderer content={post.ciphertext} />
                    </div>
                  </div>

                  {/* Post action menu (Delete) */}
                  {canDelete && (
                    <div className="absolute right-2 top-2 opacity-0 group-hover:opacity-100 transition flex items-center gap-1 bg-[#202c33] border border-[#2a3942] rounded-lg p-1 shadow-lg">
                      <button
                        onClick={() => handleDeletePost(post.id)}
                        className="p-1 text-[#8696a0] hover:text-rose-400 hover:bg-[#111b21] rounded transition"
                        title="Delete post"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Jump to bottom button */}
          {!isNearBottom && (
            <div className="absolute bottom-24 right-8 z-20">
              <button
                onClick={scrollToBottom}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#00a884] hover:bg-[#02906f] text-[#111b21] font-bold text-xs shadow-lg transition"
              >
                <ArrowDown className="w-3.5 h-3.5" />
                Latest
              </button>
            </div>
          )}

          {/* Post Composer */}
          <PostComposer
            channelName={channel.name}
            onSendPost={handleSendPost}
          />
        </div>

        {/* Right 320px Synced Radio Rail (Desktop: >= 1024px) */}
        {channel.radio_enabled && (
          <aside className={`${showRadioPanel ? "hidden lg:flex" : "hidden"} w-80 h-full border-l border-[#202c33] shrink-0 flex-col overflow-hidden`}>
            <RadioPanel
              channel={channel}
              members={activeChannelMembers}
              onOpenAskLlm={() => setShowAskLlm(true)}
              onOpenAddMusic={() => setShowAddMusic(true)}
            />
          </aside>
        )}

        {/* Mobile / Tablet Slide-over Drawer (< 1024px) */}
        {channel.radio_enabled && showMobileDrawer && (
          <div className="lg:hidden fixed inset-0 z-40 flex justify-end bg-black/60 backdrop-blur-sm">
            <div className="w-80 h-full bg-[#111b21] border-l border-[#202c33] flex flex-col shadow-2xl animate-in slide-in-from-right duration-200">
              <div className="p-3 border-b border-[#202c33] flex items-center justify-between">
                <span className="text-xs font-bold text-white flex items-center gap-1.5">
                  <Radio className="w-3.5 h-3.5 text-[#00a884]" />
                  Channel Radio
                </span>
                <button
                  onClick={() => setShowMobileDrawer(false)}
                  className="p-1 text-[#8696a0] hover:text-white rounded"
                >
                  <PanelRightClose className="w-4 h-4" />
                </button>
              </div>
              <div className="flex-1 overflow-hidden">
                <RadioPanel
                  channel={channel}
                  members={activeChannelMembers}
                  onOpenAskLlm={() => {
                    setShowMobileDrawer(false);
                    setShowAskLlm(true);
                  }}
                  onOpenAddMusic={() => {
                    setShowMobileDrawer(false);
                    setShowAddMusic(true);
                  }}
                />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Modals */}
      {showSettings && (
        <ChannelSettingsModal
          channel={channel}
          onClose={() => setShowSettings(false)}
        />
      )}

      {showAddMusic && (
        <AddMusicModal
          channelId={channel.id}
          onClose={() => setShowAddMusic(false)}
        />
      )}

      {showAskLlm && (
        <AskLlmModal
          channelId={channel.id}
          onClose={() => setShowAskLlm(false)}
        />
      )}
    </div>
  );
};

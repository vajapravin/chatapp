import React, { useState } from "react";
import {
  Hash,
  Plus,
  Crown,
  ChevronDown,
  ChevronRight,
  MailCheck,
  Check,
  X,
  Volume2,
} from "lucide-react";
import { ChannelItem, ChannelInviteItem } from "../../store/channelStore";

interface ChannelSidebarProps {
  channels: ChannelItem[];
  activeChannelId: string | null;
  onSelectChannel: (channelId: string) => void;
  onOpenNewChannelModal: () => void;
  pendingInvites: ChannelInviteItem[];
  onAcceptInvite: (inviteId: string) => void;
  onDeclineInvite: (inviteId: string) => void;
}

export const ChannelSidebar: React.FC<ChannelSidebarProps> = ({
  channels,
  activeChannelId,
  onSelectChannel,
  onOpenNewChannelModal,
  pendingInvites,
  onAcceptInvite,
  onDeclineInvite,
}) => {
  const [isInvitesOpen, setIsInvitesOpen] = useState(true);

  return (
    <div className="w-[240px] min-w-[240px] h-full bg-[#111b21] border-r border-[#202c33] flex flex-col select-none shrink-0">
      {/* Header */}
      <div className="h-16 px-4 bg-[#111b21] border-b border-[#202c33] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold tracking-wide uppercase text-white">Channels</span>
          <span className="text-xs px-1.5 py-0.5 rounded-full bg-[#202c33] text-[#8696a0] font-mono">
            {channels.length}
          </span>
        </div>

        <button
          onClick={onOpenNewChannelModal}
          title="Create New Channel"
          className="p-1.5 text-[#8696a0] hover:text-white hover:bg-[#202c33] rounded-lg transition"
        >
          <Plus className="w-5 h-5" />
        </button>
      </div>

      {/* Body List */}
      <div className="flex-1 overflow-y-auto px-2 py-3 space-y-4">
        {/* Pending Channel Invites Waiting Drawer */}
        {pendingInvites.length > 0 && (
          <div className="rounded-xl bg-[#202c33]/50 border border-[#2a3942] overflow-hidden">
            <button
              onClick={() => setIsInvitesOpen(!isInvitesOpen)}
              className="w-full px-3 py-2 flex items-center justify-between text-xs font-semibold text-amber-400 hover:bg-[#202c33] transition"
            >
              <div className="flex items-center gap-1.5">
                <MailCheck className="w-3.5 h-3.5" />
                <span>Invites Waiting ({pendingInvites.length})</span>
              </div>
              {isInvitesOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
            </button>

            {isInvitesOpen && (
              <div className="p-2 space-y-2 border-t border-[#2a3942]/60">
                {pendingInvites.map((inv) => (
                  <div
                    key={inv.id}
                    className="p-2 rounded-lg bg-[#111b21] border border-[#2a3942]/50 text-xs space-y-1.5"
                  >
                    <div className="font-bold text-white truncate">#{inv.channel_name}</div>
                    <div className="text-[10px] text-[#8696a0] truncate">
                      From {inv.invited_by_name || "a member"}
                    </div>
                    <div className="flex items-center gap-1.5 pt-1">
                      <button
                        onClick={() => onAcceptInvite(inv.id)}
                        className="flex-1 py-1 bg-[#00a884] hover:bg-[#02906f] text-[#111b21] rounded font-bold text-[10px] flex items-center justify-center gap-1 transition"
                      >
                        <Check className="w-3 h-3" />
                        <span>Accept</span>
                      </button>
                      <button
                        onClick={() => onDeclineInvite(inv.id)}
                        className="p-1 bg-[#202c33] hover:bg-red-500/20 text-[#8696a0] hover:text-red-400 rounded transition"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Channel List */}
        <div className="space-y-1">
          {channels.length === 0 ? (
            <div className="text-center py-10 px-4 text-xs text-[#8696a0]">
              <p>No channels joined.</p>
              <button
                onClick={onOpenNewChannelModal}
                className="mt-3 px-3 py-1.5 bg-[#00a884]/20 hover:bg-[#00a884]/30 text-[#00a884] rounded-lg font-semibold transition"
              >
                + Create Channel
              </button>
            </div>
          ) : (
            channels.map((chan) => {
              const isActive = chan.id === activeChannelId;
              const isOwner = chan.current_user_role === "owner";

              return (
                <button
                  key={chan.id}
                  onClick={() => onSelectChannel(chan.id)}
                  className={`w-full px-3 py-2 rounded-xl text-left text-xs font-medium flex items-center justify-between group transition ${
                    isActive
                      ? "bg-[#202c33] text-white shadow-sm font-semibold"
                      : "text-[#8696a0] hover:text-[#d1d7db] hover:bg-[#202c33]/40"
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <Hash className={`w-4 h-4 shrink-0 ${isActive ? "text-[#00a884]" : "text-[#8696a0]"}`} />
                    <span className="truncate">{chan.name}</span>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0 ml-1">
                    {chan.radio_enabled && (
                      <Volume2 className="w-3 h-3 text-[#8696a0] opacity-60 group-hover:opacity-100" />
                    )}
                    {isOwner && (
                      <span title="Channel Owner" className="flex items-center">
                        <Crown className="w-3 h-3 text-amber-400 shrink-0" />
                      </span>
                    )}
                    {chan.unread_count && chan.unread_count > 0 ? (
                      <span className="w-2 h-2 rounded-full bg-[#00a884]" />
                    ) : null}
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};

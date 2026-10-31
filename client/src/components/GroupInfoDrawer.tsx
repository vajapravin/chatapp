import React, { useEffect, useState } from "react";
import {
  Clock,
  Copy,
  Crown,
  Link as LinkIcon,
  LogOut,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { ChatItem } from "../storage/db";
import { useAuthStore } from "../store/authStore";
import { useChatStore } from "../store/chatStore";

interface GroupMemberData {
  user_id: string;
  phone_number: string;
  display_name: string | null;
  avatar_url: string | null;
  role: "admin" | "member";
  joined_at: string;
}

interface GroupDetailData {
  id: string;
  name: string;
  description: string | null;
  avatar_url: string | null;
  creator_id: string;
  invite_token: string;
  disappearing_mode: number;
  members: GroupMemberData[];
  current_user_role: string;
}

interface GroupInfoDrawerProps {
  chat: ChatItem;
  isOpen: boolean;
  onClose: () => void;
}

export const GroupInfoDrawer: React.FC<GroupInfoDrawerProps> = ({
  chat,
  isOpen,
  onClose,
}) => {
  const currentUserId = useAuthStore((s) => s.userId);
  const token = useAuthStore((s) => s.accessToken);

  const [group, setGroup] = useState<GroupDetailData | null>(null);
  const [loading, setLoading] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [showInviteModal, setShowInviteModal] = useState(false);

  useEffect(() => {
    if (isOpen && chat.isGroup) {
      loadGroupDetails();
    }
  }, [isOpen, chat.id]);

  const loadGroupDetails = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/v1/groups/${chat.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setGroup(data);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen || !chat.isGroup) return null;

  const isAdmin = group?.current_user_role === "admin";

  const handleUpdateDisappearing = async (seconds: number) => {
    if (!isAdmin) return;
    try {
      const res = await fetch(`/v1/groups/${chat.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ disappearing_mode: seconds }),
      });
      if (res.ok) {
        await loadGroupDetails();
        await useChatStore.getState().setDisappearingMode(chat.id, seconds);
      }
    } catch {
      // ignore
    }
  };

  const handleToggleAdminRole = async (targetUserId: string, currentRole: string) => {
    if (!isAdmin) return;
    const newRole = currentRole === "admin" ? "member" : "admin";
    try {
      const res = await fetch(`/v1/groups/${chat.id}/members/${targetUserId}/role`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ role: newRole }),
      });
      if (res.ok) {
        await loadGroupDetails();
      }
    } catch {
      // ignore
    }
  };

  const handleRemoveMember = async (targetUserId: string) => {
    try {
      const res = await fetch(`/v1/groups/${chat.id}/members/${targetUserId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        if (targetUserId === currentUserId) {
          // Exited group
          await useChatStore.getState().deleteChat(chat.id);
          onClose();
        } else {
          await loadGroupDetails();
        }
      }
    } catch {
      // ignore
    }
  };

  const copyInviteLink = () => {
    if (!group) return;
    const link = `${window.location.origin}/join/${group.invite_token}`;
    navigator.clipboard.writeText(link);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  return (
    <div className="fixed inset-y-0 right-0 z-50 w-full sm:w-96 bg-[#111b21] border-l border-[#202c33] shadow-2xl flex flex-col animate-in slide-in-from-right duration-200">
      {/* Header */}
      <div className="px-4 py-3.5 border-b border-[#202c33] flex items-center justify-between bg-[#202c33]/40">
        <h3 className="font-semibold text-base text-[#e9edef]">Group Info</h3>
        <button
          onClick={onClose}
          className="text-[#8696a0] hover:text-[#e9edef] transition p-1"
        >
          <X className="w-5 h-5" />
        </button>
      </div>
      {loading && <div className="h-0.5 w-full bg-[#00a884] animate-pulse" />}

      <div className="flex-1 overflow-y-auto">
        {/* Group Hero */}
        <div className="p-6 flex flex-col items-center text-center border-b border-[#202c33]">
          <div className="w-20 h-20 rounded-full bg-[#202c33] flex items-center justify-center text-[#00a884] mb-3 border border-[#2a3942]">
            <Users className="w-10 h-10" />
          </div>
          <h2 className="text-lg font-bold text-[#e9edef]">{group?.name || chat.peerDisplayName}</h2>
          <p className="text-xs text-[#8696a0] mt-1">
            Group · {group?.members.length || chat.memberCount || 1} participants
          </p>
          {group?.description && (
            <p className="text-xs text-[#d1d7db] mt-3 bg-[#202c33]/50 p-2.5 rounded-xl border border-[#202c33] max-w-full text-left">
              {group.description}
            </p>
          )}
        </div>

        {/* Invite Link & Disappearing Settings */}
        <div className="p-4 border-b border-[#202c33] space-y-3">
          <button
            onClick={() => setShowInviteModal(true)}
            className="w-full flex items-center gap-3 p-2.5 rounded-xl hover:bg-[#202c33] text-left transition"
          >
            <div className="w-9 h-9 rounded-full bg-[#00a884]/10 text-[#00a884] flex items-center justify-center">
              <LinkIcon className="w-4 h-4" />
            </div>
            <div>
              <p className="text-sm font-medium text-[#e9edef]">Invite to group via link</p>
              <p className="text-xs text-[#8696a0]">Anyone with link can join</p>
            </div>
          </button>

          <div className="p-2.5 rounded-xl bg-[#202c33]/30 border border-[#202c33]">
            <div className="flex items-center gap-3 mb-2">
              <Clock className="w-4 h-4 text-[#8696a0]" />
              <span className="text-xs font-medium text-[#e9edef]">Disappearing Messages</span>
            </div>
            {isAdmin ? (
              <select
                value={group?.disappearing_mode || 0}
                onChange={(e) => handleUpdateDisappearing(Number(e.target.value))}
                className="w-full bg-[#202c33] text-[#e9edef] text-xs rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-[#00a884]"
              >
                <option value={0}>Off</option>
                <option value={86400}>24 Hours</option>
                <option value={604800}>7 Days</option>
                <option value={7776000}>90 Days</option>
              </select>
            ) : (
              <p className="text-xs text-[#8696a0]">
                {group?.disappearing_mode
                  ? `${group.disappearing_mode / 86400} days`
                  : "Off"}
              </p>
            )}
          </div>
        </div>

        {/* Participants Section */}
        <div className="p-4 border-b border-[#202c33]">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold uppercase tracking-wider text-[#8696a0]">
              {group?.members.length || 0} Participants
            </span>
          </div>

          <div className="space-y-1">
            {group?.members.map((member) => {
              const isCurrentUser = member.user_id === currentUserId;
              const isMemberAdmin = member.role === "admin";
              return (
                <div
                  key={member.user_id}
                  className="flex items-center justify-between p-2 rounded-xl hover:bg-[#202c33]/50 transition group"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-full bg-[#202c33] flex items-center justify-center font-bold text-[#8696a0] text-sm">
                      {member.display_name
                        ? member.display_name.charAt(0).toUpperCase()
                        : "U"}
                    </div>
                    <div>
                      <p className="text-sm font-medium text-[#e9edef] flex items-center gap-1.5">
                        {isCurrentUser ? "You" : member.display_name || member.phone_number}
                        {isMemberAdmin && (
                          <span className="text-[10px] bg-[#00a884]/20 text-[#00a884] px-1.5 py-0.5 rounded font-bold">
                            Admin
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-[#8696a0]">{member.phone_number}</p>
                    </div>
                  </div>

                  {isAdmin && !isCurrentUser && (
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition">
                      <button
                        title={isMemberAdmin ? "Dismiss as admin" : "Make group admin"}
                        onClick={() => handleToggleAdminRole(member.user_id, member.role)}
                        className="p-1.5 text-[#8696a0] hover:text-[#00a884] rounded-lg transition"
                      >
                        <Crown className="w-4 h-4" />
                      </button>
                      <button
                        title="Remove member"
                        onClick={() => handleRemoveMember(member.user_id)}
                        className="p-1.5 text-[#8696a0] hover:text-[#ef4444] rounded-lg transition"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Exit Group */}
        <div className="p-4">
          <button
            onClick={() => handleRemoveMember(currentUserId || "")}
            className="w-full flex items-center gap-3 p-3 text-[#ef4444] hover:bg-[#ef4444]/10 rounded-xl transition font-medium text-sm"
          >
            <LogOut className="w-4 h-4" />
            <span>Exit group</span>
          </button>
        </div>
      </div>

      {/* Invite Modal */}
      {showInviteModal && group && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="bg-[#111b21] border border-[#2a3942] rounded-2xl w-full max-w-sm p-5 shadow-2xl">
            <h4 className="font-semibold text-base text-[#e9edef] mb-2">Invite Link</h4>
            <p className="text-xs text-[#8696a0] mb-4">
              Share this link with others to let them join this group:
            </p>
            <div className="flex items-center gap-2 bg-[#202c33] p-2.5 rounded-xl border border-[#2a3942] mb-4">
              <input
                type="text"
                readOnly
                value={`${window.location.origin}/join/${group.invite_token}`}
                className="bg-transparent text-xs text-[#e9edef] flex-1 focus:outline-none"
              />
              <button
                onClick={copyInviteLink}
                className="text-[#00a884] hover:text-[#00a884]/80 transition p-1"
              >
                <Copy className="w-4 h-4" />
              </button>
            </div>
            {copiedLink && (
              <p className="text-xs text-[#00a884] text-center mb-3">Link copied to clipboard!</p>
            )}
            <div className="flex justify-end">
              <button
                onClick={() => setShowInviteModal(false)}
                className="bg-[#202c33] text-[#e9edef] px-4 py-2 rounded-xl text-xs hover:bg-[#202c33]/80 transition"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

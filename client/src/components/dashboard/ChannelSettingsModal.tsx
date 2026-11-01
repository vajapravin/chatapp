import React, { useState, useEffect } from "react";
import {
  X,
  UserPlus,
  Trash2,
  Crown,
} from "lucide-react";
import { ChannelItem, useChannelStore } from "../../store/channelStore";

interface ChannelSettingsModalProps {
  channel: ChannelItem;
  onClose: () => void;
}

export const ChannelSettingsModal: React.FC<ChannelSettingsModalProps> = ({ channel, onClose }) => {
  const [activeTab, setActiveTab] = useState<"general" | "members" | "danger">("general");
  const [name, setName] = useState(channel.name);
  const [topic, setTopic] = useState(channel.topic || "");
  const [radioEnabled, setRadioEnabled] = useState(channel.radio_enabled);
  const [membersCanInvite, setMembersCanInvite] = useState(channel.members_can_invite);

  // Invite state
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviting, setInviting] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Transfer / delete state
  const [transferUserId, setTransferUserId] = useState("");
  const [deleteConfirmName, setDeleteConfirmName] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const { activeChannelMembers, loadChannelMembers, loadChannels } = useChannelStore();
  const isOwner = channel.current_user_role === "owner";

  const getAuthToken = () => localStorage.getItem("chatapp_access_token") || "";

  useEffect(() => {
    loadChannelMembers(channel.id);
  }, [channel.id, loadChannelMembers]);

  const handleUpdateGeneral = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setStatusMsg(null);
    try {
      const res = await fetch(`/v1/channels/${channel.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${getAuthToken()}`,
        },
        body: JSON.stringify({
          name: name.toLowerCase().trim().replace(/[^a-z0-9-]/g, "-"),
          topic: topic.trim() || undefined,
          radio_enabled: radioEnabled,
          members_can_invite: membersCanInvite,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || "Failed to update channel.");
      }

      await loadChannels();
      setStatusMsg({ type: "success", text: "Channel settings saved successfully!" });
    } catch (err: any) {
      setStatusMsg({ type: "error", text: err.message });
    } finally {
      setSubmitting(false);
    }
  };

  const handleInviteMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail.trim() || !inviteEmail.includes("@")) return;

    setInviting(true);
    setStatusMsg(null);
    try {
      const res = await fetch(`/v1/channels/${channel.id}/invites`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${getAuthToken()}`,
        },
        body: JSON.stringify({ email: inviteEmail.trim() }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || "Failed to send invitation.");
      }

      setInviteEmail("");
      setStatusMsg({ type: "success", text: `Invitation sent to ${inviteEmail}!` });
    } catch (err: any) {
      setStatusMsg({ type: "error", text: err.message });
    } finally {
      setInviting(false);
    }
  };

  const handleRemoveMember = async (userId: string) => {
    if (!confirm("Are you sure you want to remove this member?")) return;
    try {
      await fetch(`/v1/channels/${channel.id}/members/${userId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${getAuthToken()}` },
      });
      await loadChannelMembers(channel.id);
      await loadChannels();
    } catch (err: any) {
      console.error("Failed to remove member:", err);
    }
  };

  const handleTransferOwnership = async () => {
    if (!transferUserId) return;
    if (!confirm("Are you sure? You will forfeit owner privileges for this channel.")) return;

    setSubmitting(true);
    setStatusMsg(null);
    try {
      const res = await fetch(`/v1/channels/${channel.id}:transfer`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${getAuthToken()}`,
        },
        body: JSON.stringify({ new_owner_id: transferUserId }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || "Failed to transfer ownership.");
      }

      await loadChannels();
      onClose();
    } catch (err: any) {
      setStatusMsg({ type: "error", text: err.message });
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteChannel = async () => {
    if (deleteConfirmName !== channel.name) {
      setStatusMsg({ type: "error", text: "Typed name does not match channel name." });
      return;
    }

    setSubmitting(true);
    setStatusMsg(null);
    try {
      const res = await fetch(`/v1/channels/${channel.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${getAuthToken()}` },
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || "Failed to delete channel.");
      }

      await loadChannels();
      onClose();
    } catch (err: any) {
      setStatusMsg({ type: "error", text: err.message });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="w-full max-w-xl bg-[#202c33] rounded-2xl border border-[#2a3942] shadow-2xl flex flex-col overflow-hidden text-[#e9edef] max-h-[85vh]">
        {/* Header */}
        <div className="h-16 px-6 bg-[#111b21] border-b border-[#2a3942] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-base font-bold text-white">#{channel.name} Settings</span>
            {isOwner && <Crown className="w-4 h-4 text-amber-400" />}
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-[#8696a0] hover:text-white hover:bg-[#202c33] rounded-lg transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab navigation */}
        <div className="flex px-6 pt-3 border-b border-[#2a3942] gap-4 bg-[#111b21]">
          <button
            onClick={() => setActiveTab("general")}
            className={`pb-2.5 text-xs font-semibold border-b-2 transition ${
              activeTab === "general"
                ? "border-[#00a884] text-[#00a884]"
                : "border-transparent text-[#8696a0] hover:text-white"
            }`}
          >
            Overview & Settings
          </button>
          <button
            onClick={() => setActiveTab("members")}
            className={`pb-2.5 text-xs font-semibold border-b-2 transition ${
              activeTab === "members"
                ? "border-[#00a884] text-[#00a884]"
                : "border-transparent text-[#8696a0] hover:text-white"
            }`}
          >
            Members ({activeChannelMembers.length})
          </button>
          {isOwner && (
            <button
              onClick={() => setActiveTab("danger")}
              className={`pb-2.5 text-xs font-semibold border-b-2 transition ${
                activeTab === "danger"
                  ? "border-red-500 text-red-400"
                  : "border-transparent text-[#8696a0] hover:text-red-400"
              }`}
            >
              Management & Danger
            </button>
          )}
        </div>

        {/* Alerts */}
        {statusMsg && (
          <div
            className={`px-6 py-2 text-xs flex items-center justify-between ${
              statusMsg.type === "success"
                ? "bg-[#00a884]/10 text-[#00a884] border-b border-[#00a884]/20"
                : "bg-red-500/10 text-red-400 border-b border-red-500/20"
            }`}
          >
            <span>{statusMsg.text}</span>
            <button onClick={() => setStatusMsg(null)}><X className="w-3.5 h-3.5" /></button>
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {activeTab === "general" ? (
            <form onSubmit={handleUpdateGeneral} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-[#8696a0] mb-1 uppercase tracking-wide">
                  Channel Name
                </label>
                <input
                  type="text"
                  disabled={!isOwner}
                  value={name}
                  onChange={(e) => setName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"))}
                  className="w-full px-3 py-2 bg-[#111b21] border border-[#2a3942] rounded-xl text-sm text-white focus:outline-none focus:border-[#00a884] disabled:opacity-50"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#8696a0] mb-1 uppercase tracking-wide">
                  Topic
                </label>
                <textarea
                  rows={2}
                  disabled={!isOwner}
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  placeholder="Channel description or rules"
                  className="w-full px-3 py-2 bg-[#111b21] border border-[#2a3942] rounded-xl text-xs text-white focus:outline-none focus:border-[#00a884] resize-none disabled:opacity-50"
                />
              </div>

              <div className="p-3.5 rounded-xl bg-[#111b21] border border-[#2a3942] flex items-center justify-between">
                <div>
                  <span className="text-xs font-semibold text-white">Channel Radio</span>
                  <p className="text-[11px] text-[#8696a0]">Synchronized music station panel for channel</p>
                </div>
                <input
                  type="checkbox"
                  disabled={!isOwner}
                  checked={radioEnabled}
                  onChange={(e) => setRadioEnabled(e.target.checked)}
                  className="w-4 h-4 rounded text-[#00a884] focus:ring-0 bg-[#202c33] border-[#2a3942] disabled:opacity-50"
                />
              </div>

              <div className="p-3.5 rounded-xl bg-[#111b21] border border-[#2a3942] flex items-center justify-between">
                <div>
                  <span className="text-xs font-semibold text-white">Members Can Invite</span>
                  <p className="text-[11px] text-[#8696a0]">Allow non-owner members to invite other registered users</p>
                </div>
                <input
                  type="checkbox"
                  disabled={!isOwner}
                  checked={membersCanInvite}
                  onChange={(e) => setMembersCanInvite(e.target.checked)}
                  className="w-4 h-4 rounded text-[#00a884] focus:ring-0 bg-[#202c33] border-[#2a3942] disabled:opacity-50"
                />
              </div>

              {isOwner && (
                <div className="pt-2 flex justify-end">
                  <button
                    type="submit"
                    disabled={submitting}
                    className="px-5 py-2.5 bg-[#00a884] hover:bg-[#02906f] text-[#111b21] rounded-xl text-xs font-bold transition disabled:opacity-50"
                  >
                    Save Changes
                  </button>
                </div>
              )}
            </form>
          ) : activeTab === "members" ? (
            <div className="space-y-4">
              {/* Invite Member Box */}
              {(isOwner || channel.members_can_invite) && (
                <form onSubmit={handleInviteMember} className="p-4 rounded-xl bg-[#111b21] border border-[#2a3942] space-y-2">
                  <span className="text-xs font-bold text-white flex items-center gap-1.5">
                    <UserPlus className="w-3.5 h-3.5 text-[#00a884]" />
                    <span>Invite Registered User</span>
                  </span>
                  <div className="flex gap-2">
                    <input
                      type="email"
                      value={inviteEmail}
                      onChange={(e) => setInviteEmail(e.target.value)}
                      placeholder="Enter registered user's email"
                      className="flex-1 px-3 py-2 bg-[#202c33] border border-[#2a3942] rounded-xl text-xs text-white focus:outline-none focus:border-[#00a884]"
                    />
                    <button
                      type="submit"
                      disabled={inviting || !inviteEmail.trim()}
                      className="px-4 py-2 bg-[#00a884] hover:bg-[#02906f] text-[#111b21] rounded-xl text-xs font-bold transition disabled:opacity-50"
                    >
                      {inviting ? "Inviting..." : "Invite"}
                    </button>
                  </div>
                </form>
              )}

              {/* Members List */}
              <div className="space-y-2">
                {activeChannelMembers.map((m) => (
                  <div
                    key={m.user_id}
                    className="p-3 rounded-xl bg-[#111b21] border border-[#2a3942] flex items-center justify-between"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-white">
                          {m.display_name || m.email || "Member"}
                        </span>
                        {m.role === "owner" && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-400 font-bold uppercase">
                            Owner
                          </span>
                        )}
                      </div>
                      <span className="text-[11px] text-[#8696a0]">{m.email}</span>
                    </div>

                    {isOwner && m.role !== "owner" && (
                      <button
                        onClick={() => handleRemoveMember(m.user_id)}
                        className="p-1.5 text-red-400 hover:bg-red-500/10 rounded-lg text-xs transition"
                        title="Remove Member"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ) : (
            /* Danger Zone */
            <div className="space-y-5">
              {/* Transfer Ownership */}
              <div className="p-4 rounded-xl bg-[#111b21] border border-amber-500/30 space-y-2">
                <span className="text-xs font-bold text-amber-400 flex items-center gap-1.5">
                  <Crown className="w-4 h-4" />
                  <span>Transfer Channel Ownership</span>
                </span>
                <p className="text-[11px] text-[#8696a0]">
                  Select another channel member to become the sole owner of this channel.
                </p>
                <div className="flex gap-2 pt-1">
                  <select
                    value={transferUserId}
                    onChange={(e) => setTransferUserId(e.target.value)}
                    className="flex-1 px-3 py-2 bg-[#202c33] border border-[#2a3942] rounded-xl text-xs text-white focus:outline-none focus:border-amber-400"
                  >
                    <option value="">Select new owner...</option>
                    {activeChannelMembers
                      .filter((m) => m.role !== "owner")
                      .map((m) => (
                        <option key={m.user_id} value={m.user_id}>
                          {m.display_name || m.email}
                        </option>
                      ))}
                  </select>
                  <button
                    onClick={handleTransferOwnership}
                    disabled={submitting || !transferUserId}
                    className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-[#111b21] rounded-xl text-xs font-bold transition disabled:opacity-50"
                  >
                    Transfer
                  </button>
                </div>
              </div>

              {/* Delete Channel */}
              <div className="p-4 rounded-xl bg-[#111b21] border border-red-500/30 space-y-2">
                <span className="text-xs font-bold text-red-400 flex items-center gap-1.5">
                  <Trash2 className="w-4 h-4" />
                  <span>Delete Channel</span>
                </span>
                <p className="text-[11px] text-[#8696a0]">
                  Permanently deletes the channel, all posts, and removes all members. This cannot be undone.
                </p>
                <p className="text-xs text-white font-mono">
                  Type <span className="text-red-400 font-bold">{channel.name}</span> to confirm:
                </p>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={deleteConfirmName}
                    onChange={(e) => setDeleteConfirmName(e.target.value)}
                    placeholder={channel.name}
                    className="flex-1 px-3 py-2 bg-[#202c33] border border-[#2a3942] rounded-xl text-xs text-white focus:outline-none focus:border-red-400 font-mono"
                  />
                  <button
                    onClick={handleDeleteChannel}
                    disabled={submitting || deleteConfirmName !== channel.name}
                    className="px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-xl text-xs font-bold transition disabled:opacity-50"
                  >
                    Delete Channel
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

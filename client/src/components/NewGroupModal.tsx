import React, { useEffect, useState } from "react";
import { ArrowLeft, Check, Search, Users, X } from "lucide-react";
import { ChatItem } from "../storage/db";
import { useAuthStore } from "../store/authStore";
import { useChatStore } from "../store/chatStore";

interface UserProfile {
  id: string;
  phone_number: string;
  display_name: string | null;
  avatar_url: string | null;
}

interface NewGroupModalProps {
  isOpen: boolean;
  onClose: () => void;
  onGroupCreated: (groupChat: ChatItem) => void;
}

export const NewGroupModal: React.FC<NewGroupModalProps> = ({
  isOpen,
  onClose,
  onGroupCreated,
}) => {
  const currentUserId = useAuthStore((s) => s.userId);
  const token = useAuthStore((s) => s.accessToken);

  const [step, setStep] = useState<1 | 2>(1);
  const [searchQuery, setSearchQuery] = useState("");
  const [contacts, setContacts] = useState<UserProfile[]>([]);
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [groupName, setGroupName] = useState("");
  const [groupDescription, setGroupDescription] = useState("");
  const [disappearingMode, setDisappearingMode] = useState<number>(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setStep(1);
      setSelectedUserIds([]);
      setGroupName("");
      setGroupDescription("");
      setError(null);
      loadContacts();
    }
  }, [isOpen]);

  const loadContacts = async () => {
    try {
      const res = await fetch("/v1/users/search", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setContacts(data.filter((u: UserProfile) => u.id !== currentUserId));
      }
    } catch {
      // ignore
    }
  };

  if (!isOpen) return null;

  const toggleSelect = (userId: string) => {
    if (selectedUserIds.includes(userId)) {
      setSelectedUserIds(selectedUserIds.filter((id) => id !== userId));
    } else {
      setSelectedUserIds([...selectedUserIds, userId]);
    }
  };

  const filteredContacts = contacts.filter((c) => {
    const q = searchQuery.toLowerCase();
    return (
      c.phone_number.toLowerCase().includes(q) ||
      (c.display_name && c.display_name.toLowerCase().includes(q))
    );
  });

  const handleCreateGroup = async () => {
    if (!groupName.trim()) {
      setError("Please enter a group subject");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/v1/groups", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: groupName.trim(),
          description: groupDescription.trim() || null,
          initial_member_ids: selectedUserIds,
          disappearing_mode: disappearingMode,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: "Failed to create group" }));
        throw new Error(err.detail || "Failed to create group");
      }

      const groupData = await res.json();

      const newChat: ChatItem = {
        id: groupData.id,
        peerUserId: currentUserId || "",
        peerDisplayName: groupData.name,
        peerPhoneNumber: "",
        peerAvatarUrl: groupData.avatar_url,
        lastMessageText: "Group created",
        lastMessageTimestamp: Date.now(),
        unreadCount: 0,
        isGroup: true,
        groupRole: "admin",
        memberCount: groupData.members.length,
        description: groupData.description,
        disappearingMode: groupData.disappearing_mode,
      };

      await useChatStore.getState().addOrUpdateChat(newChat);
      onGroupCreated(newChat);
      onClose();
    } catch (err: any) {
      setError(err.message || "Failed to create group");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-150">
      <div className="bg-[#111b21] border border-[#2a3942] rounded-2xl w-full max-w-md overflow-hidden shadow-2xl flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="px-5 py-4 border-b border-[#202c33] flex items-center justify-between bg-[#202c33]/50">
          <div className="flex items-center gap-3">
            {step === 2 && (
              <button
                onClick={() => setStep(1)}
                className="text-[#8696a0] hover:text-[#e9edef] transition"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
            )}
            <h3 className="font-semibold text-lg text-[#e9edef]">
              {step === 1 ? "Add group participants" : "New group"}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="text-[#8696a0] hover:text-[#e9edef] transition p-1"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {error && (
          <div className="px-5 py-2.5 bg-[#ef4444]/10 border-b border-[#ef4444]/20 text-[#ef4444] text-xs">
            {error}
          </div>
        )}

        {/* Step 1: Select Members */}
        {step === 1 && (
          <div className="flex flex-col flex-1 overflow-hidden">
            {/* Search Box */}
            <div className="p-3 border-b border-[#202c33]">
              <div className="relative">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#8696a0]" />
                <input
                  type="text"
                  placeholder="Search name or number"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-[#202c33] text-[#e9edef] placeholder-[#8696a0] rounded-xl pl-9 pr-4 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#00a884]"
                />
              </div>
            </div>

            {/* Selected Pills */}
            {selectedUserIds.length > 0 && (
              <div className="flex flex-wrap gap-1.5 p-3 border-b border-[#202c33] max-h-24 overflow-y-auto">
                {selectedUserIds.map((uid) => {
                  const u = contacts.find((c) => c.id === uid);
                  return (
                    <div
                      key={uid}
                      className="flex items-center gap-1.5 bg-[#202c33] text-[#00a884] px-2.5 py-1 rounded-full text-xs font-medium border border-[#00a884]/30"
                    >
                      <span>{u?.display_name || u?.phone_number || "User"}</span>
                      <button onClick={() => toggleSelect(uid)} className="hover:text-white">
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Contact List */}
            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {filteredContacts.length === 0 ? (
                <div className="p-6 text-center text-[#8696a0] text-sm">
                  No contacts found
                </div>
              ) : (
                filteredContacts.map((contact) => {
                  const isSelected = selectedUserIds.includes(contact.id);
                  return (
                    <button
                      key={contact.id}
                      onClick={() => toggleSelect(contact.id)}
                      className="w-full flex items-center justify-between p-2.5 rounded-xl hover:bg-[#202c33] transition text-left"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-[#202c33] flex items-center justify-center text-[#8696a0] font-bold">
                          {contact.display_name
                            ? contact.display_name.charAt(0).toUpperCase()
                            : "U"}
                        </div>
                        <div>
                          <p className="text-sm font-medium text-[#e9edef]">
                            {contact.display_name || contact.phone_number}
                          </p>
                          <p className="text-xs text-[#8696a0]">{contact.phone_number}</p>
                        </div>
                      </div>
                      <div
                        className={`w-5 h-5 rounded-full border flex items-center justify-center transition ${
                          isSelected
                            ? "bg-[#00a884] border-[#00a884]"
                            : "border-[#8696a0]/50"
                        }`}
                      >
                        {isSelected && <Check className="w-3 h-3 text-[#111b21] stroke-[3]" />}
                      </div>
                    </button>
                  );
                })
              )}
            </div>

            {/* Next Button */}
            <div className="p-4 border-t border-[#202c33] flex justify-end">
              <button
                disabled={selectedUserIds.length === 0}
                onClick={() => setStep(2)}
                className="bg-[#00a884] text-[#111b21] font-semibold px-5 py-2.5 rounded-xl hover:bg-[#00a884]/90 transition disabled:opacity-50 disabled:cursor-not-allowed text-sm"
              >
                Next ({selectedUserIds.length})
              </button>
            </div>
          </div>
        )}

        {/* Step 2: Group Info */}
        {step === 2 && (
          <div className="p-5 flex flex-col gap-4">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-full bg-[#202c33] flex items-center justify-center text-[#00a884] shrink-0 border border-[#2a3942]">
                <Users className="w-7 h-7" />
              </div>
              <div className="flex-1">
                <input
                  type="text"
                  placeholder="Group subject (required)"
                  value={groupName}
                  onChange={(e) => setGroupName(e.target.value)}
                  className="w-full bg-[#202c33] text-[#e9edef] placeholder-[#8696a0] rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-[#00a884]"
                />
              </div>
            </div>

            <div>
              <label className="text-xs font-medium text-[#8696a0] mb-1.5 block">
                Group Description (optional)
              </label>
              <textarea
                placeholder="What is this group about?"
                value={groupDescription}
                onChange={(e) => setGroupDescription(e.target.value)}
                rows={3}
                className="w-full bg-[#202c33] text-[#e9edef] placeholder-[#8696a0] rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-[#00a884] resize-none"
              />
            </div>

            <div>
              <label className="text-xs font-medium text-[#8696a0] mb-1.5 block">
                Disappearing Messages
              </label>
              <select
                value={disappearingMode}
                onChange={(e) => setDisappearingMode(Number(e.target.value))}
                className="w-full bg-[#202c33] text-[#e9edef] rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#00a884]"
              >
                <option value={0}>Off</option>
                <option value={86400}>24 Hours</option>
                <option value={604800}>7 Days</option>
                <option value={7776000}>90 Days</option>
              </select>
            </div>

            <div className="pt-2 flex justify-end">
              <button
                disabled={loading || !groupName.trim()}
                onClick={handleCreateGroup}
                className="bg-[#00a884] text-[#111b21] font-semibold px-6 py-2.5 rounded-xl hover:bg-[#00a884]/90 transition disabled:opacity-50 text-sm flex items-center gap-2"
              >
                {loading ? "Creating..." : "Create Group"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

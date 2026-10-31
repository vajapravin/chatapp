import React, { useState } from "react";
import { MessageSquarePlus, Search, User as UserIcon, X } from "lucide-react";
import { useAuthStore } from "../store/authStore";
import { useChatStore } from "../store/chatStore";

interface NewChatModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface UserSearchResult {
  id: string;
  phone_number: string;
  display_name: string | null;
  avatar_url: string | null;
}

export const NewChatModal: React.FC<NewChatModalProps> = ({ isOpen, onClose }) => {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<UserSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const token = useAuthStore((s) => s.accessToken);
  const { addOrUpdateChat, setActiveChat } = useChatStore();

  if (!isOpen) return null;

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;

    setLoading(true);
    setError(null);

    try {
      // First try exact phone lookup if it looks like a phone number
      const trimmed = query.trim();
      let users: UserSearchResult[] = [];

      if (/^\+?[0-9]{7,15}$/.test(trimmed)) {
        const phoneParam = trimmed.startsWith("+") ? trimmed : `+${trimmed}`;
        const res = await fetch(`/v1/users/lookup?phone=${encodeURIComponent(phoneParam)}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const u = await res.json();
          users = [u];
        }
      }

      // If lookup returned nothing, query search endpoint
      if (users.length === 0) {
        const res = await fetch(`/v1/users/search?q=${encodeURIComponent(trimmed)}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          users = await res.json();
        }
      }

      if (users.length === 0) {
        setError("No users found matching that number or name.");
      } else {
        setResults(users);
      }
    } catch {
      setError("Failed to search users. Please check your connection.");
    } finally {
      setLoading(false);
    }
  };

  const handleStartChat = async (user: UserSearchResult) => {
    await addOrUpdateChat({
      id: user.id,
      peerUserId: user.id,
      peerDisplayName: user.display_name || undefined,
      peerPhoneNumber: user.phone_number,
      peerAvatarUrl: user.avatar_url || undefined,
      lastMessageText: "Started conversation",
      lastMessageTimestamp: Date.now(),
      unreadCount: 0,
    });
    setActiveChat(user.id);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-md bg-[#202c33] rounded-2xl border border-[#2a3942] shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 bg-[#111b21] border-b border-[#2a3942] flex items-center justify-between">
          <div className="flex items-center gap-2.5 text-white">
            <MessageSquarePlus className="w-5 h-5 text-[#00a884]" />
            <h3 className="font-semibold text-base">New Conversation</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-[#8696a0] hover:text-white rounded-lg hover:bg-[#202c33] transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Search input form */}
        <form onSubmit={handleSearch} className="p-6 pb-4">
          <div className="relative">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Enter phone number (e.g. +10000000002)"
              className="w-full bg-[#111b21] border border-[#2a3942] rounded-xl px-4 py-3 pl-11 text-sm text-white focus:outline-none focus:border-[#00a884] placeholder-[#8696a0]"
              autoFocus
            />
            <Search className="w-4 h-4 text-[#8696a0] absolute left-4 top-3.5" />
          </div>

          <button
            type="submit"
            disabled={loading || !query.trim()}
            className="w-full mt-3 bg-[#00a884] hover:bg-[#02906f] disabled:opacity-50 text-white font-medium py-2.5 rounded-xl text-sm transition flex items-center justify-center gap-2"
          >
            {loading ? "Searching..." : "Find Contact"}
          </button>
        </form>

        {/* Search Results list */}
        <div className="px-6 pb-6 max-h-60 overflow-y-auto">
          {error && <p className="text-xs text-red-400 text-center py-2">{error}</p>}

          <div className="flex flex-col gap-2">
            {results.map((user) => (
              <button
                key={user.id}
                onClick={() => handleStartChat(user)}
                className="w-full flex items-center gap-3 p-3 rounded-xl bg-[#111b21]/70 hover:bg-[#111b21] border border-transparent hover:border-[#2a3942] transition text-left"
              >
                <div className="w-10 h-10 rounded-full bg-[#00a884]/20 text-[#00a884] flex items-center justify-center font-semibold text-sm">
                  {user.display_name ? (
                    user.display_name.charAt(0).toUpperCase()
                  ) : (
                    <UserIcon className="w-5 h-5" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-white truncate">
                    {user.display_name || user.phone_number}
                  </div>
                  <div className="text-xs text-[#8696a0] font-mono truncate">
                    {user.phone_number}
                  </div>
                </div>
                <div className="text-xs font-medium text-[#00a884] px-2.5 py-1 rounded-lg bg-[#00a884]/10">
                  Chat
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

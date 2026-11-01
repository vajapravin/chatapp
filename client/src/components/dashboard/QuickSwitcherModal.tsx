import React, { useState, useEffect } from "react";
import { Search, Hash, MessageSquare, X } from "lucide-react";
import { ChannelItem } from "../../store/channelStore";
import { ChatItem } from "../../storage/db";

interface QuickSwitcherModalProps {
  channels: ChannelItem[];
  chats: ChatItem[];
  onSelectChannel: (channelId: string) => void;
  onSelectChat: (chatId: string) => void;
  onClose: () => void;
}

export const QuickSwitcherModal: React.FC<QuickSwitcherModalProps> = ({
  channels,
  chats,
  onSelectChannel,
  onSelectChat,
  onClose,
}) => {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Filter items
  const filteredChannels = channels.filter((c) =>
    c.name.toLowerCase().includes(query.toLowerCase())
  );
  const filteredChats = chats.filter((c) =>
    (c.peerDisplayName || c.peerPhoneNumber || "").toLowerCase().includes(query.toLowerCase())
  );

  const combinedItems: Array<
    | { type: "channel"; item: ChannelItem }
    | { type: "chat"; item: ChatItem }
  > = [
    ...filteredChannels.map((c) => ({ type: "channel" as const, item: c })),
    ...filteredChats.map((c) => ({ type: "chat" as const, item: c })),
  ];

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % Math.max(1, combinedItems.length));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((prev) => (prev - 1 + combinedItems.length) % Math.max(1, combinedItems.length));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const selected = combinedItems[selectedIndex];
        if (selected) {
          if (selected.type === "channel") {
            onSelectChannel(selected.item.id);
          } else {
            onSelectChat(selected.item.id);
          }
          onClose();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [combinedItems, selectedIndex, onClose, onSelectChannel, onSelectChat]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-24 bg-black/70 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg bg-[#202c33] rounded-2xl border border-[#2a3942] shadow-2xl overflow-hidden flex flex-col text-[#e9edef]">
        {/* Search input header */}
        <div className="p-4 bg-[#111b21] border-b border-[#2a3942] flex items-center gap-3">
          <Search className="w-5 h-5 text-[#8696a0]" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Type a channel (#) or chat name..."
            className="flex-1 bg-transparent text-white placeholder-[#8696a0] text-sm focus:outline-none"
            autoFocus
          />
          <button
            onClick={onClose}
            className="p-1 text-[#8696a0] hover:text-white hover:bg-[#202c33] rounded-lg transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Results */}
        <div className="max-h-80 overflow-y-auto p-2 space-y-1">
          {combinedItems.length === 0 ? (
            <div className="text-center py-8 text-xs text-[#8696a0]">
              No channels or chats match "{query}"
            </div>
          ) : (
            combinedItems.map((entry, idx) => {
              const isSelected = idx === selectedIndex;
              if (entry.type === "channel") {
                const chan = entry.item;
                return (
                  <button
                    key={`chan_${chan.id}`}
                    onClick={() => {
                      onSelectChannel(chan.id);
                      onClose();
                    }}
                    className={`w-full px-3 py-2.5 rounded-xl text-left text-xs flex items-center justify-between transition ${
                      isSelected
                        ? "bg-[#00a884] text-[#111b21] font-semibold"
                        : "text-[#8696a0] hover:bg-[#111b21] hover:text-white"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <Hash className="w-4 h-4" />
                      <span className="text-sm">#{chan.name}</span>
                    </div>
                    <span className="text-[10px] uppercase tracking-wider opacity-80 font-mono">
                      Channel
                    </span>
                  </button>
                );
              } else {
                const chat = entry.item;
                return (
                  <button
                    key={`chat_${chat.id}`}
                    onClick={() => {
                      onSelectChat(chat.id);
                      onClose();
                    }}
                    className={`w-full px-3 py-2.5 rounded-xl text-left text-xs flex items-center justify-between transition ${
                      isSelected
                        ? "bg-[#00a884] text-[#111b21] font-semibold"
                        : "text-[#8696a0] hover:bg-[#111b21] hover:text-white"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <MessageSquare className="w-4 h-4" />
                      <span className="text-sm">
                        {chat.peerDisplayName || chat.peerPhoneNumber || "Chat"}
                      </span>
                    </div>
                    <span className="text-[10px] uppercase tracking-wider opacity-80 font-mono">
                      {chat.isGroup ? "Group" : "Chat"}
                    </span>
                  </button>
                );
              }
            })
          )}
        </div>

        {/* Footer shortcuts */}
        <div className="px-4 py-2 bg-[#111b21] border-t border-[#2a3942] text-[10px] text-[#8696a0] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span>↑↓ to navigate</span>
            <span>↵ to select</span>
            <span>ESC to dismiss</span>
          </div>
          <span>Quick Switcher</span>
        </div>
      </div>
    </div>
  );
};

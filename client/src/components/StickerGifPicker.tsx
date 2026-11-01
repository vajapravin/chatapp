import React, { useState } from "react";
import { Image as ImageIcon, Search, Smile, Sparkles, X } from "lucide-react";

interface StickerGifPickerProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectEmoji: (emoji: string) => void;
  onSelectSticker: (url: string) => void;
  onSelectGif: (url: string) => void;
}

// Bundled free high quality SVG sticker packs
const BUNDLED_STICKERS = [
  { id: "s1", name: "Party Cat", url: "https://api.iconify.design/fluent-emoji:partying-face.svg" },
  { id: "s2", name: "Heart Eyes", url: "https://api.iconify.design/fluent-emoji:smiling-face-with-heart-eyes.svg" },
  { id: "s3", name: "Fire", url: "https://api.iconify.design/fluent-emoji:fire.svg" },
  { id: "s4", name: "Rocket", url: "https://api.iconify.design/fluent-emoji:rocket.svg" },
  { id: "s5", name: "Thumbs Up", url: "https://api.iconify.design/fluent-emoji:thumbs-up.svg" },
  { id: "s6", name: "Tada", url: "https://api.iconify.design/fluent-emoji:party-popper.svg" },
  { id: "s7", name: "Cool Sunglasses", url: "https://api.iconify.design/fluent-emoji:smiling-face-with-sunglasses.svg" },
  { id: "s8", name: "Sparkles", url: "https://api.iconify.design/fluent-emoji:sparkles.svg" },
  { id: "s9", name: "Mind Blown", url: "https://api.iconify.design/fluent-emoji:exploding-head.svg" },
  { id: "s10", name: "100", url: "https://api.iconify.design/fluent-emoji:hundred-points.svg" },
  { id: "s11", name: "Victory", url: "https://api.iconify.design/fluent-emoji:victory-hand.svg" },
  { id: "s12", name: "Coffee", url: "https://api.iconify.design/fluent-emoji:hot-beverage.svg" },
];

// Curated high quality trending GIFs
const BUNDLED_GIFS = [
  { id: "g1", title: "Celebration Dance", url: "https://media.giphy.com/media/artj92V8o75VPL7AeQ/giphy.gif" },
  { id: "g2", title: "Thumbs Up", url: "https://media.giphy.com/media/111ebonMs90YLu/giphy.gif" },
  { id: "g3", title: "Excited Cat", url: "https://media.giphy.com/media/JIX9t2j0ZTN9S/giphy.gif" },
  { id: "g4", title: "Applause", url: "https://media.giphy.com/media/fnK0jeA8vIh2QLq3IZ/giphy.gif" },
  { id: "g5", title: "Mind Blown", url: "https://media.giphy.com/media/26ufdipQqU2lhNA4g/giphy.gif" },
  { id: "g6", title: "High Five", url: "https://media.giphy.com/media/l0ErFafpUCQTQFMSk/giphy.gif" },
];

const EMOJI_CATEGORIES = [
  {
    name: "Smileys",
    emojis: ["😀", "😃", "😄", "😁", "😆", "😅", "😂", "🤣", "😊", "😇", "🙂", "🙃", "😉", "😌", "😍", "🥰", "😘", "😗", "😙", "😚", "😋", "😛", "😝", "😜", "🤪", "🤨", "🧐", "🤓", "😎", "🤩", "🥳"],
  },
  {
    name: "Gestures",
    emojis: ["👍", "👎", "👌", "🤌", "✌️", "🤞", "🤟", "🤘", "🤙", "👈", "👉", "👆", "🖕", "👇", "☝️", "👋", "🤚", "🖐️", "✋", "🖖", "👏", "🙌", "👐", "🤲", "🤝", "🙏"],
  },
  {
    name: "Hearts & Objects",
    emojis: ["❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "🤍", "🤎", "💔", "❤️‍🔥", "❤️‍🩹", "❣️", "💕", "💞", "💓", "💗", "💖", "💘", "💝", "🔥", "✨", "🎉", "🚀", "💡", "☕", "🍕"],
  },
];

export const StickerGifPicker: React.FC<StickerGifPickerProps> = ({
  isOpen,
  onClose,
  onSelectEmoji,
  onSelectSticker,
  onSelectGif,
}) => {
  const [activeTab, setActiveTab] = useState<"emojis" | "stickers" | "gifs">("emojis");
  const [gifSearch, setGifSearch] = useState("");

  if (!isOpen) return null;

  const filteredGifs = gifSearch.trim()
    ? BUNDLED_GIFS.filter((g) => g.title.toLowerCase().includes(gifSearch.toLowerCase()))
    : BUNDLED_GIFS;

  return (
    <div className="h-72 bg-[#202c33] border-t border-[#2a3942] flex flex-col select-none animate-in slide-in-from-bottom-2 duration-150">
      {/* Tab Navigation Header */}
      <div className="h-11 px-4 border-b border-[#2a3942] flex items-center justify-between">
        <div className="flex items-center gap-1">
          <button
            onClick={() => setActiveTab("emojis")}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition ${
              activeTab === "emojis"
                ? "bg-[#2a3942] text-[#00a884]"
                : "text-[#8696a0] hover:text-white"
            }`}
          >
            <Smile className="w-4 h-4" />
            <span>Emojis</span>
          </button>

          <button
            onClick={() => setActiveTab("stickers")}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition ${
              activeTab === "stickers"
                ? "bg-[#2a3942] text-[#00a884]"
                : "text-[#8696a0] hover:text-white"
            }`}
          >
            <Sparkles className="w-4 h-4" />
            <span>Stickers</span>
          </button>

          <button
            onClick={() => setActiveTab("gifs")}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition ${
              activeTab === "gifs"
                ? "bg-[#2a3942] text-[#00a884]"
                : "text-[#8696a0] hover:text-white"
            }`}
          >
            <ImageIcon className="w-4 h-4" />
            <span>GIFs</span>
          </button>
        </div>

        <button
          onClick={onClose}
          className="p-1 text-[#8696a0] hover:text-white rounded-full hover:bg-[#2a3942] transition"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Tab Content Panes */}
      <div className="flex-1 overflow-y-auto p-3">
        {/* Emojis Pane */}
        {activeTab === "emojis" && (
          <div className="flex flex-col gap-3">
            {EMOJI_CATEGORIES.map((cat) => (
              <div key={cat.name}>
                <div className="text-[11px] font-semibold text-[#8696a0] mb-1.5 px-1">
                  {cat.name}
                </div>
                <div className="grid grid-cols-8 sm:grid-cols-12 gap-1">
                  {cat.emojis.map((emoji) => (
                    <button
                      key={emoji}
                      onClick={() => onSelectEmoji(emoji)}
                      className="text-xl p-1.5 hover:bg-[#2a3942] rounded-lg transition hover:scale-125"
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Stickers Pane */}
        {activeTab === "stickers" && (
          <div className="grid grid-cols-4 sm:grid-cols-6 gap-3 p-1">
            {BUNDLED_STICKERS.map((stk) => (
              <button
                key={stk.id}
                onClick={() => {
                  onSelectSticker(stk.url);
                  onClose();
                }}
                className="p-3 bg-[#111b21]/60 hover:bg-[#2a3942] rounded-2xl flex flex-col items-center justify-center transition hover:scale-110 group border border-[#2a3942]/40"
              >
                <img src={stk.url} alt={stk.name} className="w-12 h-12 object-contain" />
                <span className="text-[10px] text-[#8696a0] mt-1 truncate max-w-full group-hover:text-white">
                  {stk.name}
                </span>
              </button>
            ))}
          </div>
        )}

        {/* GIFs Pane */}
        {activeTab === "gifs" && (
          <div className="flex flex-col gap-2.5">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-[#8696a0] absolute left-3 top-2.5" />
              <input
                type="text"
                placeholder="Search GIFs..."
                value={gifSearch}
                onChange={(e) => setGifSearch(e.target.value)}
                className="w-full bg-[#111b21] text-xs text-white pl-8 pr-3 py-1.5 rounded-lg border border-[#2a3942] focus:outline-none focus:border-[#00a884] placeholder-[#8696a0]"
              />
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {filteredGifs.map((gif) => (
                <button
                  key={gif.id}
                  onClick={() => {
                    onSelectGif(gif.url);
                    onClose();
                  }}
                  className="relative rounded-xl overflow-hidden aspect-video bg-[#111b21] hover:ring-2 hover:ring-[#00a884] transition group"
                >
                  <img
                    src={gif.url}
                    alt={gif.title}
                    className="w-full h-full object-cover group-hover:scale-105 transition duration-200"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent flex items-end p-2 opacity-0 group-hover:opacity-100 transition">
                    <span className="text-[10px] text-white font-medium truncate">
                      {gif.title}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

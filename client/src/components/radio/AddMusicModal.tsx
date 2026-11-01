import React, { useState } from "react";
import { X, Search, Plus, Music, RefreshCw, Check } from "lucide-react";
import { useRadioStore } from "../../store/radioStore";

interface AddMusicModalProps {
  channelId: string;
  onClose: () => void;
}

export const AddMusicModal: React.FC<AddMusicModalProps> = ({ channelId, onClose }) => {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [addedIds, setAddedIds] = useState<Set<string>>(new Set());

  const { addToQueue } = useRadioStore();
  const getAuthToken = () => localStorage.getItem("chatapp_access_token") || "";

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;

    // Direct YouTube link extraction check: youtube.com/watch?v=VIDEO_ID or youtu.be/VIDEO_ID
    const urlMatch = q.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=))([\w-]{11})/);
    if (urlMatch) {
      const videoId = urlMatch[1];
      await addToQueue(channelId, {
        video_id: videoId,
        title: "Imported YouTube Track",
        artist: "YouTube",
        duration_ms: 180000,
        thumb_url: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
      });
      onClose();
      return;
    }

    setSearching(true);
    try {
      const res = await fetch(`/v1/music/search?q=${encodeURIComponent(q)}`, {
        headers: { Authorization: `Bearer ${getAuthToken()}` },
      });
      if (res.ok) {
        setResults(await res.json());
      }
    } catch (err) {
      console.error("Music search failed:", err);
    } finally {
      setSearching(false);
    }
  };

  const handleAddTrack = async (track: any) => {
    await addToQueue(channelId, track);
    setAddedIds((prev) => new Set([...prev, track.video_id]));
  };

  const formatSec = (ms: number) => {
    const sec = Math.floor(ms / 1000);
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s < 10 ? "0" : ""}${s}`;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg bg-[#202c33] rounded-2xl border border-[#2a3942] shadow-2xl flex flex-col overflow-hidden text-[#e9edef] max-h-[85vh]">
        {/* Header */}
        <div className="p-4 bg-[#111b21] border-b border-[#2a3942] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Music className="w-5 h-5 text-[#00a884]" />
            <h2 className="text-base font-bold text-white">Add Music to Queue</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-[#8696a0] hover:text-white hover:bg-[#202c33] rounded-lg transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Search bar */}
        <form onSubmit={handleSearch} className="p-4 border-b border-[#2a3942] bg-[#111b21]/40 flex gap-2">
          <div className="relative flex-1">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search song, artist, or paste YouTube link..."
              className="w-full px-3 py-2 pl-9 bg-[#202c33] border border-[#2a3942] rounded-xl text-xs text-white placeholder-[#8696a0] focus:outline-none focus:border-[#00a884]"
              autoFocus
            />
            <Search className="w-4 h-4 text-[#8696a0] absolute left-3 top-2.5" />
          </div>
          <button
            type="submit"
            disabled={searching || !query.trim()}
            className="px-4 py-2 bg-[#00a884] hover:bg-[#02906f] text-[#111b21] rounded-xl text-xs font-bold transition disabled:opacity-50 flex items-center gap-1.5"
          >
            {searching ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : "Search"}
          </button>
        </form>

        {/* Results List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {results.length === 0 ? (
            <div className="text-center py-12 text-xs text-[#8696a0] space-y-1">
              <p>Search for any track or paste a YouTube video URL</p>
              <p className="text-[10px]">Streams directly from YouTube to all listeners</p>
            </div>
          ) : (
            results.map((track) => {
              const isAdded = addedIds.has(track.video_id);
              return (
                <div
                  key={track.video_id}
                  className="p-2.5 rounded-xl bg-[#111b21] border border-[#2a3942] flex items-center justify-between gap-3 hover:border-[#00a884]/40 transition"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <img
                      src={track.thumb_url || "https://img.youtube.com/vi/jfKfPfyJRdk/hqdefault.jpg"}
                      alt=""
                      className="w-12 h-12 rounded-lg object-cover bg-black shrink-0"
                    />
                    <div className="truncate">
                      <div className="text-xs font-bold text-white truncate">{track.title}</div>
                      <div className="text-[11px] text-[#8696a0] truncate">{track.artist}</div>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    <span className="text-[10px] font-mono text-[#8696a0]">
                      {formatSec(track.duration_ms)}
                    </span>
                    <button
                      onClick={() => handleAddTrack(track)}
                      disabled={isAdded}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1 transition ${
                        isAdded
                          ? "bg-emerald-500/20 text-emerald-400"
                          : "bg-[#00a884] hover:bg-[#02906f] text-[#111b21]"
                      }`}
                    >
                      {isAdded ? (
                        <>
                          <Check className="w-3.5 h-3.5" />
                          <span>Added</span>
                        </>
                      ) : (
                        <>
                          <Plus className="w-3.5 h-3.5" />
                          <span>Add</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};

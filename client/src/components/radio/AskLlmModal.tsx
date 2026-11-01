import React, { useState } from "react";
import { X, Sparkles, Music, Check, Loader2, ListPlus } from "lucide-react";
import { useRadioStore } from "../../store/radioStore";

interface AskLlmModalProps {
  channelId: string;
  onClose: () => void;
}

const PRESET_MOODS = [
  { label: "Focus", prompt: "Deep focus lofi study beats, minimal distraction, instrumental" },
  { label: "Chill", prompt: "Chill ambient lounge, laid-back acoustic vibes, calm relaxing" },
  { label: "Party", prompt: "High energy party dance pop, upbeat club anthems" },
  { label: "Workout", prompt: "Intense workout gym motivation, high BPM electro" },
  { label: "Retro", prompt: "80s synthwave retro electro neon night drive" },
  { label: "Bollywood", prompt: "Bollywood melodious romantic hits and acoustic classics" },
  { label: "Instrumental", prompt: "Peaceful piano and orchestral cello instrumental pieces" },
];

export const AskLlmModal: React.FC<AskLlmModalProps> = ({ channelId, onClose }) => {
  const [prompt, setPrompt] = useState("");
  const [targetMinutes, setTargetMinutes] = useState(60);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    interpretation: string;
    search_queries: string[];
    total_minutes: number;
    tracks: Array<{
      video_id: string;
      title: string;
      artist: string;
      duration_ms: number;
      thumb_url?: string;
    }>;
  } | null>(null);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(false);
  const { addToQueue } = useRadioStore();

  const getAuthToken = () => localStorage.getItem("chatapp_access_token") || "";

  const handleCurate = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const cleanPrompt = prompt.trim();
    if (!cleanPrompt) return;

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const res = await fetch(`/v1/channels/${channelId}/radio/ask`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${getAuthToken()}`,
        },
        body: JSON.stringify({
          prompt: cleanPrompt,
          target_minutes: targetMinutes,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({ detail: "Curation failed" }));
        throw new Error(errData.detail || "Curation failed");
      }

      const data = await res.json();
      setResult(data);
      // Select all tracks by default
      const allIds = new Set<string>(data.tracks.map((t: any) => t.video_id));
      setSelectedIds(allIds);
    } catch (err: any) {
      console.error("LLM curation error:", err);
      setError(err.message || "Failed to curate music");
    } finally {
      setLoading(false);
    }
  };

  const handleSelectChip = (presetPrompt: string) => {
    setPrompt(presetPrompt);
  };

  const toggleTrack = (videoId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(videoId)) {
        next.delete(videoId);
      } else {
        next.add(videoId);
      }
      return next;
    });
  };

  const toggleAll = () => {
    if (!result) return;
    if (selectedIds.size === result.tracks.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(result.tracks.map((t) => t.video_id)));
    }
  };

  const handleAddSelected = async () => {
    if (!result || selectedIds.size === 0) return;
    setAdding(true);
    try {
      const tracksToAdd = result.tracks.filter((t) => selectedIds.has(t.video_id));
      for (const track of tracksToAdd) {
        await addToQueue(channelId, {
          video_id: track.video_id,
          title: track.title,
          artist: track.artist,
          duration_ms: track.duration_ms,
          thumb_url: track.thumb_url,
        });
      }
      onClose();
    } catch (err) {
      console.error("Failed adding curated tracks:", err);
      setError("Failed to add some tracks to the queue");
    } finally {
      setAdding(false);
    }
  };

  const formatSec = (ms: number) => {
    const sec = Math.floor(ms / 1000);
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s < 10 ? "0" : ""}${s}`;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="w-full max-w-xl bg-[#202c33] rounded-2xl border border-[#2a3942] shadow-2xl flex flex-col overflow-hidden text-[#e9edef] max-h-[88vh]">
        {/* Header */}
        <div className="p-4 bg-[#111b21] border-b border-[#2a3942] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/20 text-[#00a884] flex items-center justify-center">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white flex items-center gap-1.5">
                AI Radio Curator
                <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-[#00a884]/20 text-[#00a884]">
                  Gemini AI
                </span>
              </h2>
              <p className="text-[11px] text-[#8696a0]">
                Describe your mood, vibe, or occasion to auto-generate a playlist
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-[#8696a0] hover:text-white hover:bg-[#202c33] rounded-lg transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Mood chips */}
          <div>
            <label className="text-[11px] font-semibold text-[#8696a0] uppercase tracking-wider mb-2 block">
              Quick Moods & Vibes
            </label>
            <div className="flex flex-wrap gap-1.5">
              {PRESET_MOODS.map((m) => (
                <button
                  key={m.label}
                  type="button"
                  onClick={() => handleSelectChip(m.prompt)}
                  className="px-2.5 py-1 rounded-full text-xs bg-[#111b21] hover:bg-[#2a3942] text-[#d1d7db] border border-[#2a3942] transition"
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          {/* Form */}
          <form onSubmit={handleCurate} className="space-y-3">
            <div>
              <div className="flex justify-between items-center mb-1">
                <label className="text-[11px] font-semibold text-[#8696a0] uppercase tracking-wider">
                  Describe what you want to hear
                </label>
                <span className="text-[10px] text-[#8696a0]">{prompt.length}/500</span>
              </div>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value.slice(0, 500))}
                rows={3}
                placeholder="e.g. Late night cyberpunk driving music with mellow synths and deep bass..."
                className="w-full px-3 py-2 bg-[#111b21] border border-[#2a3942] rounded-xl text-xs text-white placeholder-[#8696a0] focus:outline-none focus:border-[#00a884] resize-none"
              />
            </div>

            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <label className="text-xs text-[#8696a0]">Duration:</label>
                <select
                  value={targetMinutes}
                  onChange={(e) => setTargetMinutes(Number(e.target.value))}
                  className="px-2.5 py-1.5 bg-[#111b21] border border-[#2a3942] rounded-lg text-xs text-white focus:outline-none focus:border-[#00a884]"
                >
                  <option value={30}>30 mins (~7 songs)</option>
                  <option value={60}>60 mins (~15 songs)</option>
                  <option value={90}>90 mins (~22 songs)</option>
                  <option value={120}>120 mins (~30 songs)</option>
                </select>
              </div>

              <button
                type="submit"
                disabled={loading || !prompt.trim()}
                className="px-4 py-2 bg-[#00a884] hover:bg-[#02906f] text-[#111b21] rounded-xl text-xs font-bold transition disabled:opacity-50 flex items-center gap-1.5 shadow-lg shadow-[#00a884]/20"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Curating Playlist...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-3.5 h-3.5" />
                    Curate with AI
                  </>
                )}
              </button>
            </div>
          </form>

          {error && (
            <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs">
              {error}
            </div>
          )}

          {/* Curation results */}
          {result && (
            <div className="space-y-3 pt-2 border-t border-[#2a3942]">
              {/* Interpretation banner */}
              <div className="p-3 rounded-xl bg-[#111b21] border border-[#2a3942]/80 space-y-1">
                <p className="text-xs text-[#00a884] font-medium flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5" />
                  {result.interpretation}
                </p>
                <div className="flex flex-wrap gap-1 mt-1">
                  {result.search_queries.map((q, idx) => (
                    <span
                      key={idx}
                      className="px-2 py-0.5 rounded text-[10px] bg-[#202c33] text-[#8696a0] border border-[#2a3942]"
                    >
                      "{q}"
                    </span>
                  ))}
                </div>
              </div>

              {/* Tracks list header */}
              <div className="flex items-center justify-between text-xs text-[#8696a0]">
                <span>
                  Found {result.tracks.length} tracks ({selectedIds.size} selected)
                </span>
                <button
                  type="button"
                  onClick={toggleAll}
                  className="text-[#00a884] hover:underline text-[11px]"
                >
                  {selectedIds.size === result.tracks.length ? "Deselect All" : "Select All"}
                </button>
              </div>

              {/* Tracks list */}
              <div className="space-y-1.5 max-h-60 overflow-y-auto pr-1">
                {result.tracks.map((track) => {
                  const isSelected = selectedIds.has(track.video_id);
                  return (
                    <div
                      key={track.video_id}
                      onClick={() => toggleTrack(track.video_id)}
                      className={`flex items-center gap-3 p-2 rounded-xl cursor-pointer border transition ${
                        isSelected
                          ? "bg-[#00a884]/10 border-[#00a884]/40"
                          : "bg-[#111b21] border-transparent hover:border-[#2a3942]"
                      }`}
                    >
                      <div
                        className={`w-4 h-4 rounded flex items-center justify-center border text-white transition ${
                          isSelected
                            ? "bg-[#00a884] border-[#00a884]"
                            : "border-[#8696a0]/50 bg-transparent"
                        }`}
                      >
                        {isSelected && <Check className="w-3 h-3 text-[#111b21] stroke-[3]" />}
                      </div>

                      {track.thumb_url ? (
                        <img
                          src={track.thumb_url}
                          alt=""
                          className="w-10 h-10 rounded-lg object-cover bg-[#202c33]"
                        />
                      ) : (
                        <div className="w-10 h-10 rounded-lg bg-[#202c33] flex items-center justify-center text-[#8696a0]">
                          <Music className="w-4 h-4" />
                        </div>
                      )}

                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-white truncate">{track.title}</p>
                        <p className="text-[11px] text-[#8696a0] truncate">{track.artist}</p>
                      </div>

                      <span className="text-[10px] text-[#8696a0] font-mono">
                        {formatSec(track.duration_ms)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        {result && (
          <div className="p-4 bg-[#111b21] border-t border-[#2a3942] flex items-center justify-between">
            <span className="text-xs text-[#8696a0]">
              {selectedIds.size} of {result.tracks.length} tracks ready to add
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-3 py-1.5 text-xs text-[#8696a0] hover:text-white rounded-lg transition"
              >
                Close
              </button>
              <button
                type="button"
                onClick={handleAddSelected}
                disabled={adding || selectedIds.size === 0}
                className="px-4 py-2 bg-[#00a884] hover:bg-[#02906f] text-[#111b21] rounded-xl text-xs font-bold transition disabled:opacity-50 flex items-center gap-1.5 shadow-lg shadow-[#00a884]/20"
              >
                {adding ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Adding Tracks...
                  </>
                ) : (
                  <>
                    <ListPlus className="w-3.5 h-3.5" />
                    Add Selected to Queue
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

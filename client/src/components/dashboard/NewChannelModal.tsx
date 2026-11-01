import React, { useState } from "react";
import { X, Hash, Volume2, RefreshCw } from "lucide-react";
import { useChannelStore } from "../../store/channelStore";

interface NewChannelModalProps {
  onClose: () => void;
}

export const NewChannelModal: React.FC<NewChannelModalProps> = ({ onClose }) => {
  const [name, setName] = useState("");
  const [topic, setTopic] = useState("");
  const [radioEnabled, setRadioEnabled] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { createChannel } = useChannelStore();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = name.toLowerCase().trim().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-");
    if (!cleanName) {
      setError("Please enter a valid channel name (alphanumeric and hyphens).");
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const chan = await createChannel(cleanName, topic.trim() || undefined);
      if (chan) {
        onClose();
      } else {
        setError("Failed to create channel.");
      }
    } catch (err: any) {
      setError(err.message || "Failed to create channel.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="w-full max-w-md bg-[#202c33] rounded-2xl border border-[#2a3942] shadow-2xl p-6 text-[#e9edef]">
        <div className="flex items-center justify-between pb-4 border-b border-[#2a3942]">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-[#00a884]/20 text-[#00a884] flex items-center justify-center">
              <Hash className="w-4 h-4" />
            </div>
            <h2 className="text-base font-bold text-white">Create Channel</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-[#8696a0] hover:text-white hover:bg-[#2a3942] rounded-lg transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {error && (
          <div className="mt-4 p-2.5 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-[#8696a0] mb-1 uppercase tracking-wide">
              Channel Name
            </label>
            <div className="relative">
              <input
                type="text"
                required
                maxLength={48}
                value={name}
                onChange={(e) => setName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"))}
                placeholder="e.g. general-chat"
                className="w-full px-4 py-2.5 pl-8 bg-[#111b21] border border-[#2a3942] rounded-xl text-sm text-white focus:outline-none focus:border-[#00a884] font-mono"
                autoFocus
              />
              <span className="absolute left-3 top-2.5 text-[#8696a0] font-mono">#</span>
            </div>
            <p className="text-[11px] text-[#8696a0] mt-1">
              Lower case letters, numbers, and hyphens only.
            </p>
          </div>

          <div>
            <label className="block text-xs font-semibold text-[#8696a0] mb-1 uppercase tracking-wide">
              Topic (Optional)
            </label>
            <textarea
              rows={2}
              maxLength={160}
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="What is this channel about?"
              className="w-full px-3 py-2 bg-[#111b21] border border-[#2a3942] rounded-xl text-xs text-white focus:outline-none focus:border-[#00a884] resize-none"
            />
          </div>

          <div className="p-3 rounded-xl bg-[#111b21] border border-[#2a3942] flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Volume2 className="w-4 h-4 text-[#00a884]" />
              <div>
                <span className="text-xs font-semibold text-white">Channel Radio</span>
                <p className="text-[10px] text-[#8696a0]">Enable synchronized YouTube Music playback</p>
              </div>
            </div>
            <input
              type="checkbox"
              checked={radioEnabled}
              onChange={(e) => setRadioEnabled(e.target.checked)}
              className="w-4 h-4 rounded text-[#00a884] focus:ring-0 bg-[#202c33] border-[#2a3942]"
            />
          </div>

          <div className="pt-2 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-[#2a3942] hover:bg-[#374248] text-[#8696a0] hover:text-white rounded-xl text-xs font-semibold transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || !name.trim()}
              className="px-5 py-2 bg-[#00a884] hover:bg-[#02906f] text-[#111b21] rounded-xl text-xs font-bold transition disabled:opacity-50 flex items-center gap-1.5"
            >
              {loading && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
              <span>Create Channel</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

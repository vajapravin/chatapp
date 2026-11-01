import React, { useEffect, useRef, useState } from "react";
import { Send, Trash2 } from "lucide-react";
import { AudioRecorder } from "../media/AudioRecorder";
import { formatDuration } from "../media/ThumbnailGenerator";

interface VoiceNoteRecorderProps {
  isOpen: boolean;
  onCancel: () => void;
  onSend: (audioBlob: Blob, duration: number, waveform: number[]) => void;
}

export const VoiceNoteRecorder: React.FC<VoiceNoteRecorderProps> = ({
  isOpen,
  onCancel,
  onSend,
}) => {
  const [duration, setDuration] = useState(0);
  const [liveWaveform, setLiveWaveform] = useState<number[]>([]);
  const recorderRef = useRef<AudioRecorder | null>(null);

  useEffect(() => {
    if (isOpen) {
      setDuration(0);
      setLiveWaveform([]);
      const recorder = new AudioRecorder();
      recorderRef.current = recorder;

      recorder
        .start((secs, waveform) => {
          setDuration(secs);
          setLiveWaveform(waveform);
        })
        .catch((err) => {
          console.error("Microphone access error:", err);
          onCancel();
        });

      return () => {
        if (recorder.isRecording()) {
          recorder.cancel();
        }
      };
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleCancel = () => {
    if (recorderRef.current) {
      recorderRef.current.cancel();
    }
    onCancel();
  };

  const handleSend = async () => {
    if (!recorderRef.current) return;
    try {
      const result = await recorderRef.current.stop();
      onSend(result.audioBlob, result.duration, result.waveform);
    } catch (err) {
      console.error("Failed to stop recording:", err);
      onCancel();
    }
  };

  const bars = liveWaveform.length > 0 ? liveWaveform : Array(32).fill(20);

  return (
    <div className="flex-1 flex items-center justify-between gap-3 px-3 py-1 bg-[#202c33] rounded-xl animate-in slide-in-from-bottom-1 duration-150 select-none">
      {/* Cancel (Trash) Button */}
      <button
        type="button"
        onClick={handleCancel}
        className="p-2 text-[#8696a0] hover:text-red-400 hover:bg-[#374248] rounded-full transition"
        title="Discard recording"
      >
        <Trash2 className="w-5 h-5" />
      </button>

      {/* Recording Status & Timer */}
      <div className="flex items-center gap-2">
        <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
        <span className="text-sm font-mono text-white font-medium min-w-[36px]">
          {formatDuration(duration)}
        </span>
      </div>

      {/* Live Waveform Indicator */}
      <div className="flex-1 flex items-center gap-1 h-6 px-2 overflow-hidden">
        {bars.slice(-32).map((val, idx) => (
          <span
            key={idx}
            style={{ height: `${Math.max(15, Math.min(100, val))}%` }}
            className="flex-1 bg-[#00a884] rounded-full transition-all duration-75"
          />
        ))}
      </div>

      {/* Send Voice Note Button */}
      <button
        type="button"
        onClick={handleSend}
        className="p-2.5 bg-[#00a884] hover:bg-[#02906f] text-white rounded-full transition shadow-md flex-shrink-0"
        title="Send voice note"
      >
        <Send className="w-4 h-4" />
      </button>
    </div>
  );
};

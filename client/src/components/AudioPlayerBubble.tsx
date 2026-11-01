import React, { useEffect, useRef, useState } from "react";
import { Mic, Pause, Play, Sparkles } from "lucide-react";
import { MediaAttachment } from "../storage/db";
import { MediaDownloadManager } from "../media/MediaDownloadManager";
import { formatDuration } from "../media/ThumbnailGenerator";
import { VoiceTranscriber } from "../media/VoiceTranscriber";

interface AudioPlayerBubbleProps {
  media: MediaAttachment;
  isOutgoing: boolean;
}

const SPEED_OPTIONS = [1, 1.5, 2];

export const AudioPlayerBubble: React.FC<AudioPlayerBubbleProps> = ({
  media,
  isOutgoing,
}) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(media.duration || 0);
  const [speedIndex, setSpeedIndex] = useState(0);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [transcription, setTranscription] = useState<string | null>(null);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [loadingAudio, setLoadingAudio] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);

  const waveform = media.waveform && media.waveform.length > 0
    ? media.waveform
    : [20, 40, 60, 30, 70, 90, 50, 80, 40, 60, 75, 45, 90, 85, 40, 60, 55, 30, 70, 80, 60, 40, 50, 70, 85, 95, 60, 40, 30, 50, 40, 20];

  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
      }
    };
  }, []);

  const ensureAudioLoaded = async (): Promise<string> => {
    if (audioUrl) return audioUrl;
    setLoadingAudio(true);
    try {
      const url = await MediaDownloadManager.getDecryptedMediaUrl(media);
      setAudioUrl(url);
      return url;
    } finally {
      setLoadingAudio(false);
    }
  };

  const togglePlay = async () => {
    try {
      if (!audioRef.current) {
        const url = await ensureAudioLoaded();
        const audio = new Audio(url);
        audioRef.current = audio;

        audio.playbackRate = SPEED_OPTIONS[speedIndex];

        audio.ontimeupdate = () => {
          setCurrentTime(audio.currentTime);
        };

        audio.onloadedmetadata = () => {
          if (audio.duration && !isNaN(audio.duration)) {
            setDuration(audio.duration);
          }
        };

        audio.onended = () => {
          setIsPlaying(false);
          setCurrentTime(0);
        };
      }

      if (isPlaying) {
        audioRef.current.pause();
        setIsPlaying(false);
      } else {
        await audioRef.current.play();
        setIsPlaying(true);
      }
    } catch (err) {
      console.error("Audio playback error:", err);
    }
  };

  const toggleSpeed = () => {
    const nextIdx = (speedIndex + 1) % SPEED_OPTIONS.length;
    setSpeedIndex(nextIdx);
    if (audioRef.current) {
      audioRef.current.playbackRate = SPEED_OPTIONS[nextIdx];
    }
  };

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!audioRef.current || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const percentage = Math.max(0, Math.min(1, clickX / rect.width));
    const targetTime = percentage * duration;
    audioRef.current.currentTime = targetTime;
    setCurrentTime(targetTime);
  };

  const handleTranscribe = async () => {
    if (transcription) return;
    setIsTranscribing(true);
    try {
      const url = await ensureAudioLoaded();
      const res = await fetch(url);
      const blob = await res.blob();
      const text = await VoiceTranscriber.transcribeAudioBlob(blob);
      setTranscription(text);
    } catch (err) {
      setTranscription("Unable to transcribe audio");
    } finally {
      setIsTranscribing(false);
    }
  };

  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div className="flex flex-col gap-2 min-w-[240px] max-w-[320px]">
      <div className="flex items-center gap-3">
        {/* Play / Pause Button */}
        <button
          onClick={togglePlay}
          disabled={loadingAudio}
          className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 transition shadow-sm ${
            isOutgoing
              ? "bg-[#00a884] text-white hover:bg-[#02906f]"
              : "bg-[#00a884] text-[#111b21] hover:bg-[#00a884]/90"
          }`}
        >
          {loadingAudio ? (
            <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
          ) : isPlaying ? (
            <Pause className="w-5 h-5 fill-current" />
          ) : (
            <Play className="w-5 h-5 fill-current ml-0.5" />
          )}
        </button>

        {/* Dynamic Waveform Bars */}
        <div
          onClick={handleSeek}
          className="flex-1 flex items-center gap-[2.5px] h-8 cursor-pointer py-1 relative select-none"
        >
          {waveform.map((val, idx) => {
            const barPercent = (idx / waveform.length) * 100;
            const isPlayed = barPercent <= progressPercent;
            const barHeight = Math.max(15, Math.min(100, val));

            return (
              <span
                key={idx}
                style={{ height: `${barHeight}%` }}
                className={`flex-1 rounded-full transition-colors duration-100 ${
                  isPlayed
                    ? isOutgoing
                      ? "bg-[#00a884]"
                      : "bg-[#00a884]"
                    : isOutgoing
                    ? "bg-[#2a3942]"
                    : "bg-[#374248]"
                }`}
              />
            );
          })}
        </div>

        {/* Avatar or Mic Indicator */}
        <div className="w-7 h-7 rounded-full bg-[#202c33] flex items-center justify-center text-[#8696a0] flex-shrink-0">
          <Mic className="w-4 h-4 text-[#00a884]" />
        </div>
      </div>

      {/* Audio Footer (Duration, Speed Toggle, Transcribe Trigger) */}
      <div className="flex items-center justify-between text-[11px] text-[#8696a0] px-1">
        <span>{formatDuration(isPlaying ? currentTime : duration)}</span>

        <div className="flex items-center gap-2">
          {/* Speed Toggle */}
          <button
            onClick={toggleSpeed}
            className="px-1.5 py-0.5 rounded bg-[#202c33] hover:bg-[#2a3942] text-[#e9edef] font-mono text-[10px] transition"
          >
            {SPEED_OPTIONS[speedIndex]}×
          </button>

          {/* Transcribe Button */}
          <button
            onClick={handleTranscribe}
            disabled={isTranscribing}
            title="Transcribe voice note on-device"
            className="flex items-center gap-1 hover:text-[#00a884] transition"
          >
            <Sparkles className="w-3 h-3 text-[#00a884]" />
            <span>{isTranscribing ? "Transcribing..." : transcription ? "Transcript" : "Transcribe"}</span>
          </button>
        </div>
      </div>

      {/* On-Device Transcription Card */}
      {transcription && (
        <div className="mt-1 p-2.5 rounded-xl bg-[#111b21]/70 border border-[#2a3942] text-xs text-[#d1d7db] leading-relaxed animate-in fade-in duration-150">
          <div className="text-[10px] text-[#00a884] font-semibold mb-1 flex items-center gap-1">
            <Sparkles className="w-3 h-3" />
            <span>On-device transcript</span>
          </div>
          {transcription}
        </div>
      )}
    </div>
  );
};

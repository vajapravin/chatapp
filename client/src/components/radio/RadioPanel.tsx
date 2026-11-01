import React, { useState, useEffect, useRef } from "react";
import {
  Play,
  Pause,
  SkipForward,
  SkipBack,
  Volume2,
  VolumeX,
  Radio as RadioIcon,
  Plus,
  Sparkles,
  ExternalLink,
  Crown,
  Trash2,
  Shuffle,
  Repeat,
  Repeat1,
  ChevronUp,
  ChevronDown,
} from "lucide-react";
import { useRadioStore } from "../../store/radioStore";
import { useChatStore } from "../../store/chatStore";
import { useAuthStore } from "../../store/authStore";
import { ChannelItem, ChannelMemberItem } from "../../store/channelStore";

interface RadioPanelProps {
  channel: ChannelItem;
  members: ChannelMemberItem[];
  onOpenAskLlm?: () => void;
  onOpenAddMusic?: () => void;
}

export const RadioPanel: React.FC<RadioPanelProps> = ({
  channel,
  members,
  onOpenAskLlm,
  onOpenAddMusic,
}) => {
  const currentUserId = useAuthStore((state) => state.user?.id);
  const currentUserRole = useAuthStore((state) => state.user?.role);
  const isAdmin = channel.current_user_role === "owner" || channel.current_user_role === "admin" || currentUserRole === "admin";
  const presence = useChatStore((state) => state.presence);

  const {
    radioData,
    isTunedIn,
    volume,
    isMuted,
    clockOffsetMs,
    setTunedIn,
    setVolume,
    setMuted,
    syncClockOffset,
    fetchRadioState,
    onAir,
    offAir,
    play,
    pause,
    skip,
    previous,
    removeFromQueue,
    playQueueItem,
    moveQueueItem,
    toggleShuffle,
    toggleRepeat,
  } = useRadioStore();

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const data = radioData[channel.id];
  const currentTrack = data?.current_track;
  const isPlaying = data?.status === "playing";
  const isOnAir = data?.status === "playing" || data?.status === "paused";

  // Calculate current playback position
  const [currentPositionSec, setCurrentPositionSec] = useState(0);

  // Send postMessage command to YouTube iframe
  const sendIframeCommand = (func: string, args: any = []) => {
    if (iframeRef.current?.contentWindow) {
      const argArray = Array.isArray(args)
        ? args
        : args === "" || args === undefined
        ? []
        : [args];
      const msg = JSON.stringify({ event: "command", func, args: argArray });
      iframeRef.current.contentWindow.postMessage(msg, "*");
    }
  };

  const enableAudioAndPlay = () => {
    setMuted(false);
    sendIframeCommand("unMute", []);
    sendIframeCommand("setVolume", [volume || 80]);
    sendIframeCommand("playVideo", []);
  };

  useEffect(() => {
    syncClockOffset();
    fetchRadioState(channel.id);
  }, [channel.id, syncClockOffset, fetchRadioState]);

  // Batch fetch presence status for channel members
  useEffect(() => {
    if (!members || members.length === 0) return;
    const userIds = members.map((m) => m.user_id);
    const token = localStorage.getItem("chatapp_access_token") || "";

    const fetchBatchPresence = async () => {
      try {
        const res = await fetch("/v1/presence/batch", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ user_ids: userIds }),
        });
        if (res.ok) {
          const data: Record<string, { online: boolean; last_seen?: number }> = await res.json();
          Object.entries(data).forEach(([uid, p]) => {
            useChatStore.getState().setPresence(uid, p.online, p.last_seen);
          });
        }
      } catch (err) {
        console.warn("Failed to fetch batch presence for radio members:", err);
      }
    };

    fetchBatchPresence();
    const interval = setInterval(fetchBatchPresence, 15000);
    return () => clearInterval(interval);
  }, [members, channel.id]);

  // Synchronize playback state to YouTube iframe
  useEffect(() => {
    if (!iframeRef.current?.contentWindow) return;
    if (isPlaying) {
      sendIframeCommand("playVideo");
      if (isMuted) {
        sendIframeCommand("mute");
      } else {
        sendIframeCommand("unMute");
        sendIframeCommand("setVolume", [volume]);
      }
    } else {
      sendIframeCommand("pauseVideo");
    }
  }, [isPlaying, isMuted, volume]);

  // Position ticker and drift sync
  useEffect(() => {
    if (!isPlaying || !data?.started_at) {
      setCurrentPositionSec(data?.paused_at ? Math.floor(data.paused_at / 1000) : 0);
      return;
    }

    const interval = setInterval(() => {
      const serverNow = Date.now() - clockOffsetMs;
      const elapsedMs = Math.max(0, serverNow - data.started_at!);
      setCurrentPositionSec(Math.floor(elapsedMs / 1000));
    }, 1000);

    return () => clearInterval(interval);
  }, [isPlaying, data?.started_at, data?.paused_at, clockOffsetMs]);

  // Visibility change handling: audio continues playing in background, resyncs position on return
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!document.hidden && isPlaying && data?.started_at) {
        const serverNow = Date.now() - clockOffsetMs;
        const posSec = Math.max(0, Math.floor((serverNow - data.started_at) / 1000));
        sendIframeCommand("seekTo", [posSec, true]);
        sendIframeCommand("playVideo", []);
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [isPlaying, data?.started_at, clockOffsetMs]);

  const formatDuration = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s < 10 ? "0" : ""}${s}`;
  };

  const totalTrackSec = currentTrack?.duration_ms ? Math.floor(currentTrack.duration_ms / 1000) : 0;

  const handlePlayToggle = () => {
    if (isPlaying) {
      pause(channel.id);
      sendIframeCommand("pauseVideo");
    } else {
      play(channel.id);
      enableAudioAndPlay();
    }
  };

  const handleTuneToggle = () => {
    const nextTuned = !isTunedIn;
    setTunedIn(nextTuned);
    if (nextTuned) {
      setTimeout(() => {
        enableAudioAndPlay();
      }, 300);
    } else {
      sendIframeCommand("pauseVideo", []);
    }
  };

  const handleOnAirToggle = () => {
    if (isOnAir) {
      offAir(channel.id);
      sendIframeCommand("pauseVideo");
    } else {
      onAir(channel.id);
      enableAudioAndPlay();
    }
  };

  return (
    <div className="w-[320px] min-w-[320px] h-full bg-[#111b21] border-l border-[#202c33] flex flex-col overflow-y-auto select-none shrink-0">
      {/* Radio Header */}
      <div className="p-4 bg-[#111b21] border-b border-[#202c33] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div
            className={`w-8 h-8 rounded-lg flex items-center justify-center transition ${
              isPlaying
                ? "bg-emerald-500/20 text-emerald-400 ring-1 ring-emerald-500/40"
                : "bg-[#202c33] text-[#8696a0]"
            }`}
          >
            <RadioIcon className={`w-4 h-4 ${isPlaying ? "animate-pulse" : ""}`} />
          </div>
          <div>
            <span className="text-xs font-bold text-white uppercase tracking-wider">Channel Radio</span>
            <div className="flex items-center gap-1.5 mt-0.5">
              {/* Online Player Status: Green if playing/on air, else grey */}
              <span
                className={`w-2.5 h-2.5 rounded-full transition ${
                  isPlaying
                    ? "bg-emerald-400 animate-pulse ring-2 ring-emerald-400/30"
                    : isOnAir
                    ? "bg-amber-400"
                    : "bg-[#8696a0]"
                }`}
              />
              <span
                className={`text-[10px] font-bold uppercase tracking-wider ${
                  isPlaying ? "text-emerald-400" : isOnAir ? "text-amber-400" : "text-[#8696a0]"
                }`}
              >
                {isPlaying ? "Online • Live" : isOnAir ? "Online • Paused" : "Offline"}
              </span>
            </div>
          </div>
        </div>

        {isAdmin ? (
          <button
            onClick={handleOnAirToggle}
            className={`px-3 py-1 rounded-xl text-xs font-bold transition shadow ${
              isOnAir
                ? "bg-red-500/20 text-red-400 hover:bg-red-500/30"
                : "bg-[#00a884] text-[#111b21] hover:bg-[#02906f]"
            }`}
          >
            {isOnAir ? "Go Off Air" : "Go On Air"}
          </button>
        ) : (
          <button
            onClick={handleTuneToggle}
            className={`px-3 py-1 rounded-xl text-xs font-bold transition shadow ${
              isTunedIn
                ? "bg-red-500/20 text-red-400 hover:bg-red-500/30"
                : "bg-[#00a884] text-[#111b21] hover:bg-[#02906f]"
            }`}
          >
            {isTunedIn ? "Go Off Air" : "Tune In"}
          </button>
        )}
      </div>

      {/* Embedded YouTube Player Tile (>=200x200 visible tile) */}
      <div className="p-4 flex flex-col items-center border-b border-[#202c33] bg-[#0c1317]">
        <div className="w-[200px] h-[200px] rounded-2xl overflow-hidden bg-black border border-[#2a3942] relative shadow-lg group">
          {currentTrack?.video_id && (isTunedIn || isAdmin) ? (
            <iframe
              ref={iframeRef}
              key={currentTrack.video_id}
              title="Channel Radio YouTube Player"
              src={`https://www.youtube.com/embed/${currentTrack.video_id}?enablejsapi=1&autoplay=1&controls=${isAdmin ? 1 : 0}&playsinline=1&rel=0&origin=${encodeURIComponent(typeof window !== "undefined" ? window.location.origin : "")}`}
              className="w-full h-full object-cover"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
              onLoad={() => {
                sendIframeCommand("listening", []);
                if (isPlaying) {
                  if (data?.started_at) {
                    const serverNow = Date.now() - clockOffsetMs;
                    const posSec = Math.max(0, Math.floor((serverNow - data.started_at) / 1000));
                    sendIframeCommand("seekTo", [posSec, true]);
                  }
                  sendIframeCommand("playVideo", []);
                  if (!isMuted) {
                    sendIframeCommand("unMute", []);
                    sendIframeCommand("setVolume", [volume || 80]);
                  }
                }
              }}
            />
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center p-4 text-center bg-[#111b21] text-[#8696a0]">
              <RadioIcon className="w-10 h-10 mb-2 opacity-30" />
              <span className="text-xs font-semibold text-white">Station Idle</span>
              <p className="text-[10px] mt-1">
                {isOnAir
                  ? isTunedIn || isAdmin
                    ? "Queue empty. Add songs to play."
                    : "Click Tune In to listen with members."
                  : "Station is currently off air."}
              </p>
            </div>
          )}
        </div>

        {/* Audio Unmute / Sound Fix Banner */}
        {isPlaying && (
          <button
            onClick={enableAudioAndPlay}
            className={`w-full mt-2 py-1.5 px-3 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition shadow ${
              isMuted
                ? "bg-amber-500/20 text-amber-300 border border-amber-500/40 hover:bg-amber-500/30 animate-pulse"
                : "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/25"
            }`}
          >
            <Volume2 className="w-4 h-4 shrink-0 text-emerald-400" />
            <span>{isMuted ? "Sound Muted • Tap to Enable Sound" : "Sound Active • Click to Unmute / Boost"}</span>
          </button>
        )}

        {/* Track Title and Artist */}
        <div className="w-full text-center mt-3 px-2">
          <div className="text-xs font-bold text-white truncate" title={currentTrack?.title || "No track playing"}>
            {currentTrack?.title || "No track selected"}
          </div>
          <div className="text-[11px] text-[#8696a0] truncate mt-0.5">
            {currentTrack?.artist || "YouTube Music"}
          </div>
        </div>

        {/* Progress Bar & Seek */}
        {currentTrack && (
          <div className="w-full mt-3 px-2 space-y-1">
            <div className="w-full h-1.5 bg-[#202c33] rounded-full overflow-hidden relative">
              <div
                className="h-full bg-[#00a884] transition-all"
                style={{
                  width: `${totalTrackSec > 0 ? (currentPositionSec / totalTrackSec) * 100 : 0}%`,
                }}
              />
            </div>
            <div className="flex justify-between text-[10px] font-mono text-[#8696a0]">
              <span>{formatDuration(currentPositionSec)}</span>
              <span>{formatDuration(totalTrackSec)}</span>
            </div>
          </div>
        )}

        {/* Controls */}
        <div className="w-full flex items-center justify-center gap-3 mt-3">
          {isAdmin ? (
            <>
              <button
                onClick={() => previous(channel.id)}
                title="Previous Track"
                className="p-2 text-[#8696a0] hover:text-white hover:bg-[#202c33] rounded-xl transition"
              >
                <SkipBack className="w-4 h-4" />
              </button>

              <button
                onClick={handlePlayToggle}
                className="p-3 bg-[#00a884] hover:bg-[#02906f] text-[#111b21] rounded-2xl font-bold transition shadow-md"
              >
                {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5 ml-0.5" />}
              </button>

              <button
                onClick={() => skip(channel.id)}
                title="Next Track"
                className="p-2 text-[#8696a0] hover:text-white hover:bg-[#202c33] rounded-xl transition"
              >
                <SkipForward className="w-4 h-4" />
              </button>
            </>
          ) : (
            <div className="text-[11px] text-[#8696a0] flex items-center gap-1.5 py-1.5 px-2 bg-[#111b21] rounded-xl border border-[#202c33]">
              <RadioIcon className={`w-3.5 h-3.5 ${isPlaying ? "text-[#00a884] animate-pulse" : "text-[#8696a0]"}`} />
              <span className="font-medium">
                {isPlaying ? "Live Broadcast by Admin" : isOnAir ? "Paused by Admin" : "Station Idle"}
              </span>
            </div>
          )}

          {/* Volume slider */}
          <div className="flex items-center gap-1.5 ml-2">
            <button
              onClick={() => {
                const nextMuted = !isMuted;
                setMuted(nextMuted);
                if (nextMuted) {
                  sendIframeCommand("mute");
                } else {
                  sendIframeCommand("unMute");
                  sendIframeCommand("setVolume", [volume]);
                }
              }}
              className="p-1.5 text-[#8696a0] hover:text-white transition"
              title={isMuted ? "Unmute" : "Mute"}
            >
              {isMuted ? <VolumeX className="w-4 h-4 text-red-400" /> : <Volume2 className="w-4 h-4" />}
            </button>
            <input
              type="range"
              min={0}
              max={100}
              value={isMuted ? 0 : volume}
              onChange={(e) => {
                const newVol = Number(e.target.value);
                setVolume(newVol);
                if (isMuted) setMuted(false);
                sendIframeCommand("unMute");
                sendIframeCommand("setVolume", [newVol]);
              }}
              className="w-16 h-1 bg-[#202c33] accent-[#00a884] rounded-lg cursor-pointer"
            />
          </div>
        </div>

        {/* Admin Action Buttons: Add Track / Ask LLM */}
        {isAdmin && (
          <div className="w-full flex items-center gap-2 mt-4 px-2">
            <button
              onClick={onOpenAskLlm}
              className="flex-1 py-1.5 px-3 bg-gradient-to-r from-purple-600/30 to-blue-600/30 hover:from-purple-600/50 hover:to-blue-600/50 border border-purple-500/40 text-purple-300 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition shadow"
            >
              <Sparkles className="w-3.5 h-3.5 text-purple-400" />
              <span>Ask LLM</span>
            </button>

            <button
              onClick={onOpenAddMusic}
              className="py-1.5 px-3 bg-[#202c33] hover:bg-[#2a3942] border border-[#2a3942] text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 transition"
            >
              <Plus className="w-3.5 h-3.5 text-[#00a884]" />
              <span>Add Music</span>
            </button>
          </div>
        )}
      </div>

      {/* Up Next Queue Management */}
      <div className="p-4 border-b border-[#202c33] space-y-2">
        <div className="flex items-center justify-between text-xs text-[#8696a0] font-bold uppercase tracking-wider">
          <span>Queue ({data?.queue?.length || 0})</span>

          {isAdmin && (
            <div className="flex items-center gap-1.5">
              {/* Shuffle toggle button */}
              <button
                onClick={() => toggleShuffle(channel.id)}
                title={data?.shuffle ? "Shuffle: Active" : "Shuffle: Inactive"}
                className={`p-1.5 rounded-lg transition flex items-center gap-1 ${
                  data?.shuffle
                    ? "bg-[#00a884]/20 text-[#00a884] border border-[#00a884]/40"
                    : "text-[#8696a0] hover:text-white hover:bg-[#202c33]"
                }`}
              >
                <Shuffle className="w-3.5 h-3.5" />
              </button>

              {/* Loop / Repeat toggle button */}
              <button
                onClick={() => toggleRepeat(channel.id)}
                title={`Repeat: ${data?.repeat_mode || "off"}`}
                className={`p-1.5 rounded-lg transition flex items-center gap-1 ${
                  data?.repeat_mode && data.repeat_mode !== "off"
                    ? "bg-[#00a884]/20 text-[#00a884] border border-[#00a884]/40"
                    : "text-[#8696a0] hover:text-white hover:bg-[#202c33]"
                }`}
              >
                {data?.repeat_mode === "one" ? (
                  <Repeat1 className="w-3.5 h-3.5" />
                ) : (
                  <Repeat className="w-3.5 h-3.5" />
                )}
                <span className="text-[9px] font-mono uppercase">
                  {data?.repeat_mode === "one" ? "1" : data?.repeat_mode === "all" ? "all" : "off"}
                </span>
              </button>
            </div>
          )}
        </div>

        {(!data?.queue || data.queue.length === 0) ? (
          <p className="text-xs text-[#8696a0] py-3 text-center">Queue is empty</p>
        ) : (
          <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
            {data.queue.map((item, idx) => {
              const isCurrent = item.video_id === currentTrack?.video_id;
              return (
                <div
                  key={item.id || idx}
                  className={`group p-2 rounded-xl text-xs flex items-center justify-between gap-2 transition ${
                    isCurrent
                      ? "bg-[#00a884]/15 border border-[#00a884]/30 text-white font-semibold"
                      : "bg-[#202c33]/40 hover:bg-[#202c33] text-[#8696a0] hover:text-white"
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <span className="font-mono text-[10px] text-[#8696a0] w-4 shrink-0">
                      {idx + 1}
                    </span>
                    <div
                      className="truncate flex-1 cursor-pointer"
                      onClick={() => {
                        if (isAdmin && !isCurrent) {
                          playQueueItem(channel.id, item.id);
                          enableAudioAndPlay();
                        }
                      }}
                      title={isAdmin && !isCurrent ? "Click to play this track" : undefined}
                    >
                      <div className="truncate text-white text-xs">{item.title}</div>
                      <div className="text-[10px] text-[#8696a0] truncate">{item.artist}</div>
                    </div>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <span className="text-[10px] font-mono text-[#8696a0] mr-1">
                      {formatDuration(Math.floor(item.duration_ms / 1000))}
                    </span>

                    {isAdmin && (
                      <>
                        {/* Play Now button */}
                        {!isCurrent && (
                          <button
                            onClick={() => {
                              playQueueItem(channel.id, item.id);
                              enableAudioAndPlay();
                            }}
                            title="Play this track now"
                            className="p-1 text-[#8696a0] hover:text-[#00a884] hover:bg-[#00a884]/15 rounded transition"
                          >
                            <Play className="w-3 h-3 fill-current" />
                          </button>
                        )}

                        {/* Move Up */}
                        <button
                          onClick={() => moveQueueItem(channel.id, item.id, "up")}
                          disabled={idx === 0}
                          title="Move track up"
                          className="p-1 text-[#8696a0] hover:text-white hover:bg-[#2a3942] rounded transition disabled:opacity-20"
                        >
                          <ChevronUp className="w-3.5 h-3.5" />
                        </button>

                        {/* Move Down */}
                        <button
                          onClick={() => moveQueueItem(channel.id, item.id, "down")}
                          disabled={idx === data.queue.length - 1}
                          title="Move track down"
                          className="p-1 text-[#8696a0] hover:text-white hover:bg-[#2a3942] rounded transition disabled:opacity-20"
                        >
                          <ChevronDown className="w-3.5 h-3.5" />
                        </button>

                        {/* Remove from queue */}
                        <button
                          onClick={() => removeFromQueue(channel.id, item.id)}
                          title="Remove from queue"
                          className="p-1 text-[#8696a0] hover:text-red-400 hover:bg-red-500/20 rounded transition"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Channel Members List with Online (Green) else Offline (Grey) Status */}
      <div className="p-4 space-y-2 flex-1">
        <div className="flex items-center justify-between text-xs text-[#8696a0] font-bold uppercase tracking-wider">
          <span>Members ({members.length})</span>
        </div>

        <div className="space-y-1.5">
          {members.map((m) => {
            const isSelf = !!(currentUserId && m.user_id === currentUserId);
            const isOnline = isSelf || !!presence[m.user_id]?.isOnline;
            return (
              <div
                key={m.user_id}
                className="p-1.5 rounded-lg flex items-center justify-between hover:bg-[#202c33] text-xs text-white transition"
              >
                <div className="flex items-center gap-2 min-w-0">
                  {/* Status Indicator: Green if online, Grey if offline */}
                  <span
                    className={`w-2.5 h-2.5 rounded-full shrink-0 transition ${
                      isOnline
                        ? "bg-emerald-400 ring-2 ring-emerald-400/30 shadow-sm shadow-emerald-400/50"
                        : "bg-[#8696a0]"
                    }`}
                    title={isOnline ? "Online" : "Offline"}
                  />
                  <span className="truncate">
                    {m.display_name || m.email || "Member"}{isSelf ? " (You)" : ""}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span
                    className={`text-[10px] font-semibold ${
                      isOnline ? "text-emerald-400" : "text-[#8696a0]"
                    }`}
                  >
                    {isOnline ? "Online" : "Offline"}
                  </span>
                  {m.role === "owner" ? (
                    <span title="Channel Owner" className="flex items-center">
                      <Crown className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                    </span>
                  ) : m.role === "admin" ? (
                    <span className="text-[9px] bg-blue-500/20 text-blue-400 px-1 rounded font-semibold">
                      Admin
                    </span>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Compliance Footer */}
      <div className="p-3 bg-[#0c1317] border-t border-[#202c33] text-center text-[10px] text-[#8696a0] space-y-1">
        <p>Uses YouTube API Services</p>
        <div className="flex items-center justify-center gap-2 text-[#58a6ff]">
          <a
            href="https://www.youtube.com/t/terms"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:underline flex items-center gap-0.5"
          >
            <span>YouTube Terms</span>
            <ExternalLink className="w-2.5 h-2.5" />
          </a>
          <span>•</span>
          <a
            href="https://policies.google.com/privacy"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:underline flex items-center gap-0.5"
          >
            <span>Google Privacy</span>
            <ExternalLink className="w-2.5 h-2.5" />
          </a>
        </div>
      </div>
    </div>
  );
};

import React, { useEffect, useRef, useState } from "react";
import {
  Mic,
  MicOff,
  MonitorUp,
  PhoneOff,
  ShieldCheck,
  User as UserIcon,
  Video,
  VideoOff,
  Volume2,
  Zap,
} from "lucide-react";
import { useCallStore } from "../store/callStore";
import { callManager } from "../calls/CallManager";

function formatSeconds(totalSeconds: number): string {
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
}

interface RemoteAudioStreamPlayerProps {
  stream: MediaStream;
  sinkId: string | null;
  onAutoplayBlocked?: () => void;
  onAutoplaySuccess?: () => void;
}

const RemoteAudioStreamPlayer: React.FC<RemoteAudioStreamPlayerProps> = ({
  stream,
  sinkId,
  onAutoplayBlocked,
  onAutoplaySuccess,
}) => {
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;

    if (el.srcObject !== stream) {
      el.srcObject = stream;
    }

    if (sinkId && "setSinkId" in el && typeof (el as any).setSinkId === "function") {
      (el as any).setSinkId(sinkId).catch((err: any) => {
        console.warn("Failed to set audio sink ID on audio element:", err);
      });
    }

    const promise = el.play();
    if (promise !== undefined) {
      promise
        .then(() => {
          onAutoplaySuccess?.();
        })
        .catch((err) => {
          console.warn("Audio autoplay blocked or failed:", err);
          if (err.name === "NotAllowedError") {
            onAutoplayBlocked?.();
          }
        });
    }

    return () => {
      el.srcObject = null;
    };
  }, [stream, sinkId]);

  return <audio ref={audioRef} autoPlay playsInline className="hidden" aria-hidden="true" />;
};

export const ActiveCallModal: React.FC = () => {
  const {
    callState,
    callType,
    peerDisplayName,
    peerPhoneNumber,
    isCaller,
    isMuted,
    isVideoOff,
    isScreenSharing,
    isLowDataMode,
    networkQuality,
    callDuration,
    localStream,
    remoteStreams,
    isGroup,
    selectedAudioDeviceId,
  } = useCallStore();

  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
  const [showSpeakerMenu, setShowSpeakerMenu] = useState(false);
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const primaryRemoteVideoRef = useRef<HTMLVideoElement>(null);

  const isActive =
    callState === "calling" ||
    callState === "connecting" ||
    callState === "connected";

  // Bind local stream
  useEffect(() => {
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream;
    }
  }, [localStream, callType, isVideoOff, isScreenSharing]);

  // Bind primary remote stream in 1:1
  const remoteEntries = Object.entries(remoteStreams);
  useEffect(() => {
    if (primaryRemoteVideoRef.current && remoteEntries.length > 0) {
      primaryRemoteVideoRef.current.srcObject = remoteEntries[0][1];
    }
  }, [remoteEntries]);

  // Enumerate audio output devices
  useEffect(() => {
    if (isActive && navigator.mediaDevices?.enumerateDevices) {
      navigator.mediaDevices.enumerateDevices().then((devices) => {
        const audioOutputs = devices.filter((d) => d.kind === "audiooutput");
        setAudioDevices(audioOutputs);
      });
    }
  }, [isActive]);

  if (!isActive) return null;

  const isConnecting = callState === "calling" || callState === "connecting";

  const handleUnblockAudio = () => {
    document.querySelectorAll("audio").forEach((el) => {
      el.play().catch(() => {});
    });
    setAutoplayBlocked(false);
  };

  return (
    <div
      onClick={() => {
        if (autoplayBlocked) handleUnblockAudio();
      }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/95 backdrop-blur-lg select-none"
    >
      {/* Dedicated Remote Audio Players (Ensures audio is always played for 1:1 and group voice/video) */}
      <div className="hidden" aria-hidden="true">
        {remoteEntries.map(([peerId, stream]) => (
          <RemoteAudioStreamPlayer
            key={peerId}
            stream={stream}
            sinkId={selectedAudioDeviceId}
            onAutoplayBlocked={() => setAutoplayBlocked(true)}
            onAutoplaySuccess={() => setAutoplayBlocked(false)}
          />
        ))}
      </div>

      <div className="relative w-full h-full flex flex-col justify-between p-4 md:p-8 max-w-6xl">
        {/* Top Header Bar */}
        <div className="flex items-center justify-between text-white z-20">
          <div className="flex flex-col">
            <div className="flex items-center gap-2">
              <span className="text-lg font-bold truncate max-w-sm">
                {peerDisplayName || peerPhoneNumber || "Active Call"}
              </span>
              {isGroup && (
                <span className="text-[10px] bg-[#00a884]/20 text-[#00a884] px-2 py-0.5 rounded-full font-semibold">
                  Group Call
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-xs text-[#8696a0]">
                {isConnecting
                  ? isCaller
                    ? "Calling..."
                    : "Connecting..."
                  : formatSeconds(callDuration)}
              </span>
              {networkQuality !== "good" && (
                <span
                  className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                    networkQuality === "critical"
                      ? "bg-red-500/20 text-red-300 animate-pulse"
                      : "bg-yellow-500/20 text-yellow-300"
                  }`}
                >
                  {networkQuality === "critical" ? "Unstable Network" : "Poor Network"}
                </span>
              )}
              {isLowDataMode && (
                <span className="text-[10px] bg-blue-500/20 text-blue-300 px-1.5 py-0.5 rounded font-medium flex items-center gap-1">
                  <Zap className="w-2.5 h-2.5" />
                  Low Data
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 text-xs text-[#8696a0]">
            <span className="w-2.5 h-2.5 rounded-full bg-[#00a884] animate-ping" />
            <span className="hidden sm:inline">End-to-End Encrypted</span>
          </div>
        </div>

        {/* Browser Autoplay Blocked Banner */}
        {autoplayBlocked && (
          <div className="z-30 my-2 flex justify-center">
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleUnblockAudio();
              }}
              className="bg-yellow-500 hover:bg-yellow-400 text-black px-4 py-2 rounded-full font-semibold text-xs shadow-lg flex items-center gap-2 animate-bounce cursor-pointer"
            >
              <Volume2 className="w-4 h-4" />
              <span>Audio is paused by browser policy. Click here to unmute</span>
            </button>
          </div>
        )}

        {/* Center Stage: Video Grid or Voice Avatar */}
        <div className="flex-1 my-4 flex items-center justify-center relative overflow-hidden rounded-3xl bg-[#111b21] border border-[#2a3942]">
          {/* 1:1 Video Stream */}
          {!isGroup && remoteEntries.length > 0 && callType === "video" ? (
            <video
              ref={primaryRemoteVideoRef}
              autoPlay
              playsInline
              muted
              className="w-full h-full object-cover rounded-3xl"
            />
          ) : isGroup && remoteEntries.length > 0 ? (
            /* Group Mesh 2x2 Grid */
            <div className="w-full h-full p-2 grid grid-cols-1 md:grid-cols-2 gap-2">
              {remoteEntries.map(([peerId, stream]) => (
                <div
                  key={peerId}
                  className="relative rounded-2xl overflow-hidden bg-[#202c33] flex items-center justify-center border border-[#2a3942]"
                >
                  <video
                    ref={(el) => {
                      if (el && el.srcObject !== stream) el.srcObject = stream;
                    }}
                    autoPlay
                    playsInline
                    muted
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute bottom-2 left-2 px-2 py-0.5 bg-black/60 rounded text-[11px] text-white">
                    {peerId.slice(0, 8)}...
                  </div>
                </div>
              ))}
            </div>
          ) : (
            /* Voice Only / Camera Off Avatar View */
            <div className="flex flex-col items-center justify-center p-8 text-center animate-in zoom-in-95 duration-200">
              <div className="relative mb-6">
                <div className="w-32 h-32 rounded-full bg-[#00a884]/20 border-4 border-[#00a884]/40 flex items-center justify-center text-white text-4xl font-bold shadow-2xl">
                  {peerDisplayName ? (
                    peerDisplayName.charAt(0).toUpperCase()
                  ) : (
                    <UserIcon className="w-16 h-16 text-[#00a884]" />
                  )}
                </div>
                {callState === "connected" && (
                  <span className="absolute inset-0 rounded-full border-2 border-[#00a884] animate-ping opacity-40 pointer-events-none" />
                )}
              </div>
              <h4 className="text-xl font-bold text-white mb-1">
                {peerDisplayName || peerPhoneNumber || "Peer"}
              </h4>
              <p className="text-xs text-[#8696a0]">
                {callState === "connected" ? "Voice Call Active" : "Connecting audio..."}
              </p>
            </div>
          )}

          {/* Local Picture-in-Picture Preview */}
          {callType === "video" && localStream && (
            <div className="absolute top-4 right-4 w-36 h-48 sm:w-44 sm:h-60 rounded-2xl overflow-hidden border-2 border-[#00a884] shadow-2xl bg-[#202c33] z-30">
              <video
                ref={localVideoRef}
                autoPlay
                playsInline
                muted
                className="w-full h-full object-cover"
              />
              <span className="absolute bottom-1 left-2 text-[10px] bg-black/60 px-1.5 py-0.2 rounded text-white font-medium">
                You {isMuted ? "(Muted)" : ""}
              </span>
            </div>
          )}
        </div>

        {/* Bottom Call Controls Toolbar */}
        <div className="flex items-center justify-center gap-3 sm:gap-6 z-20 py-2">
          {/* Mute Mic */}
          <button
            onClick={() => useCallStore.getState().toggleMute()}
            className={`p-3.5 sm:p-4 rounded-full transition active:scale-95 shadow-md ${
              isMuted
                ? "bg-red-500/20 text-red-400 hover:bg-red-500/30 border border-red-500/40"
                : "bg-[#2a3942] hover:bg-[#374248] text-white"
            }`}
            title={isMuted ? "Unmute Microphone" : "Mute Microphone"}
          >
            {isMuted ? <MicOff className="w-5 h-5 sm:w-6 sm:h-6" /> : <Mic className="w-5 h-5 sm:w-6 sm:h-6" />}
          </button>

          {/* Video Toggle */}
          {callType === "video" && (
            <button
              onClick={() => useCallStore.getState().toggleVideo()}
              className={`p-3.5 sm:p-4 rounded-full transition active:scale-95 shadow-md ${
                isVideoOff
                  ? "bg-red-500/20 text-red-400 hover:bg-red-500/30 border border-red-500/40"
                  : "bg-[#2a3942] hover:bg-[#374248] text-white"
              }`}
              title={isVideoOff ? "Turn Camera On" : "Turn Camera Off"}
            >
              {isVideoOff ? <VideoOff className="w-5 h-5 sm:w-6 sm:h-6" /> : <Video className="w-5 h-5 sm:w-6 sm:h-6" />}
            </button>
          )}

          {/* Screen Share */}
          {callType === "video" && (
            <button
              onClick={() => callManager.toggleScreenShare()}
              className={`p-3.5 sm:p-4 rounded-full transition active:scale-95 shadow-md ${
                isScreenSharing
                  ? "bg-[#00a884] text-white shadow-[#00a884]/30"
                  : "bg-[#2a3942] hover:bg-[#374248] text-white"
              }`}
              title={isScreenSharing ? "Stop Screen Sharing" : "Share Screen"}
            >
              <MonitorUp className="w-5 h-5 sm:w-6 sm:h-6" />
            </button>
          )}

          {/* Low Data Mode Toggle */}
          <button
            onClick={() => useCallStore.getState().toggleLowDataMode()}
            className={`p-3.5 sm:p-4 rounded-full transition active:scale-95 shadow-md ${
              isLowDataMode
                ? "bg-blue-600 text-white"
                : "bg-[#2a3942] hover:bg-[#374248] text-[#8696a0] hover:text-white"
            }`}
            title={isLowDataMode ? "Low Data Mode: ON (Opus DTX active)" : "Toggle Low Data Mode"}
          >
            {isLowDataMode ? <Zap className="w-5 h-5 sm:w-6 sm:h-6" /> : <ShieldCheck className="w-5 h-5 sm:w-6 sm:h-6" />}
          </button>

          {/* Speaker Device Selector (if available) */}
          {audioDevices.length > 0 && (
            <div className="relative">
              <button
                onClick={() => setShowSpeakerMenu(!showSpeakerMenu)}
                className="p-3.5 sm:p-4 rounded-full bg-[#2a3942] hover:bg-[#374248] text-white transition active:scale-95 shadow-md"
                title="Select Speaker"
              >
                <Volume2 className="w-5 h-5 sm:w-6 sm:h-6" />
              </button>

              {showSpeakerMenu && (
                <div className="absolute bottom-16 left-1/2 -translate-x-1/2 w-56 bg-[#202c33] border border-[#2a3942] rounded-2xl p-2 shadow-2xl flex flex-col gap-1 z-50">
                  <span className="text-[10px] text-[#8696a0] px-2 py-1 font-semibold uppercase">
                    Audio Output
                  </span>
                  {audioDevices.map((device) => (
                    <button
                      key={device.deviceId}
                      onClick={() => {
                        useCallStore.getState().setSelectedAudioDevice(device.deviceId);
                        if (primaryRemoteVideoRef.current) {
                          callManager.setAudioOutputDevice(primaryRemoteVideoRef.current, device.deviceId);
                        }
                        setShowSpeakerMenu(false);
                      }}
                      className={`px-2.5 py-1.5 text-xs text-left rounded-xl hover:bg-[#374248] truncate ${
                        selectedAudioDeviceId === device.deviceId
                          ? "text-[#00a884] font-semibold bg-[#2a3942]/60"
                          : "text-[#e9edef]"
                      }`}
                    >
                      {device.label || `Speaker (${device.deviceId.slice(0, 6)})`}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* End Call Button */}
          <button
            onClick={() => callManager.endCall(true, "completed")}
            className="p-3.5 sm:p-4 rounded-full bg-red-600 hover:bg-red-700 text-white transition active:scale-95 shadow-xl shadow-red-600/30 ml-2"
            title="End Call"
          >
            <PhoneOff className="w-6 h-6 sm:w-7 sm:h-7" />
          </button>
        </div>
      </div>
    </div>
  );
};

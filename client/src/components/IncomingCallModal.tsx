import React from "react";
import { Phone, PhoneOff, User as UserIcon, Video } from "lucide-react";
import { useCallStore } from "../store/callStore";
import { callManager } from "../calls/CallManager";

export const IncomingCallModal: React.FC = () => {
  const { callState, callType, peerDisplayName, peerPhoneNumber } = useCallStore();

  if (callState !== "ringing") return null;

  const isVideo = callType === "video";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-in fade-in duration-200 select-none">
      <div className="w-full max-w-sm bg-[#202c33] border border-[#2a3942] rounded-3xl p-6 shadow-2xl flex flex-col items-center text-center">
        {/* Pulsing Avatar */}
        <div className="relative mb-5">
          <div className="w-24 h-24 rounded-full bg-[#00a884]/20 border-2 border-[#00a884] flex items-center justify-center text-white text-3xl font-bold shadow-lg animate-pulse">
            {peerDisplayName ? (
              peerDisplayName.charAt(0).toUpperCase()
            ) : (
              <UserIcon className="w-12 h-12 text-[#00a884]" />
            )}
          </div>
          <span className="absolute -bottom-1 -right-1 p-2 bg-[#111b21] rounded-full border border-[#2a3942] text-[#00a884]">
            {isVideo ? <Video className="w-4 h-4" /> : <Phone className="w-4 h-4" />}
          </span>
        </div>

        {/* Caller Info */}
        <h3 className="text-xl font-bold text-white mb-1 truncate max-w-xs">
          {peerDisplayName || peerPhoneNumber || "Unknown Caller"}
        </h3>
        {peerPhoneNumber && (
          <p className="text-xs text-[#8696a0] font-mono mb-2">{peerPhoneNumber}</p>
        )}
        <p className="text-sm text-[#00a884] font-medium animate-pulse mb-8">
          Incoming {isVideo ? "Video" : "Voice"} Call...
        </p>

        {/* Action Buttons: Decline & Accept */}
        <div className="flex items-center justify-center gap-12 w-full">
          <div className="flex flex-col items-center gap-2">
            <button
              onClick={() => callManager.rejectCall()}
              className="w-16 h-16 rounded-full bg-red-600 hover:bg-red-700 text-white flex items-center justify-center shadow-lg transition active:scale-95"
              title="Decline"
            >
              <PhoneOff className="w-7 h-7" />
            </button>
            <span className="text-xs text-[#8696a0]">Decline</span>
          </div>

          <div className="flex flex-col items-center gap-2">
            <button
              onClick={() => callManager.acceptCall()}
              className="w-16 h-16 rounded-full bg-[#00a884] hover:bg-[#02906f] text-white flex items-center justify-center shadow-lg transition active:scale-95 animate-bounce"
              title="Accept"
            >
              <Phone className="w-7 h-7" />
            </button>
            <span className="text-xs text-[#8696a0]">Accept</span>
          </div>
        </div>
      </div>
    </div>
  );
};

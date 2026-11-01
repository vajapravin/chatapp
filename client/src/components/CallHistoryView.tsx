import React, { useEffect, useState } from "react";
import { format, isToday, isYesterday } from "date-fns";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Phone,
  PhoneMissed,
  Trash2,
  User as UserIcon,
  Video,
} from "lucide-react";
import { useCallStore } from "../store/callStore";
import { callManager } from "../calls/CallManager";
import { localDB } from "../storage/db";

function formatCallTime(timestamp: number): string {
  const date = new Date(timestamp);
  if (isToday(date)) return format(date, "h:mm a");
  if (isYesterday(date)) return "Yesterday";
  return format(date, "M/d/yy");
}

function formatDuration(seconds: number): string {
  if (seconds <= 0) return "";
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}m ${secs}s`;
}

export const CallHistoryView: React.FC = () => {
  const { callLogs, loadCallLogs } = useCallStore();
  const [filter, setFilter] = useState<"all" | "missed">("all");

  useEffect(() => {
    loadCallLogs();
  }, [loadCallLogs]);

  const filteredLogs = callLogs.filter((log) => {
    if (filter === "missed") {
      return log.status === "missed" || log.status === "rejected" || log.status === "busy";
    }
    return true;
  });

  const handleClearHistory = async () => {
    await localDB.clearCallLogs();
    await loadCallLogs();
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-[#111b21] overflow-hidden select-none">
      {/* Subheader & Filters */}
      <div className="px-4 py-3 bg-[#202c33] border-b border-[#222e35] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setFilter("all")}
            className={`px-3 py-1 rounded-full text-xs font-semibold transition ${
              filter === "all"
                ? "bg-[#00a884] text-white"
                : "bg-[#111b21] text-[#8696a0] hover:text-white"
            }`}
          >
            All
          </button>
          <button
            onClick={() => setFilter("missed")}
            className={`px-3 py-1 rounded-full text-xs font-semibold transition ${
              filter === "missed"
                ? "bg-red-500/20 text-red-400 border border-red-500/30"
                : "bg-[#111b21] text-[#8696a0] hover:text-white"
            }`}
          >
            Missed
          </button>
        </div>

        {callLogs.length > 0 && (
          <button
            onClick={handleClearHistory}
            title="Clear Call History"
            className="p-1.5 text-[#8696a0] hover:text-red-400 rounded-full hover:bg-[#374248] transition"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Call History List */}
      <div className="flex-1 overflow-y-auto">
        {filteredLogs.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center p-6 text-center text-[#8696a0]">
            <div className="w-12 h-12 rounded-full bg-[#202c33] flex items-center justify-center mb-3">
              <Phone className="w-6 h-6 text-[#00a884]" />
            </div>
            <h4 className="text-sm font-semibold text-white">No Call History</h4>
            <p className="text-xs text-[#8696a0] mt-1 max-w-xs">
              {filter === "missed"
                ? "You have no missed calls."
                : "Voice and video calls with your contacts will appear here."}
            </p>
          </div>
        ) : (
          filteredLogs.map((log) => {
            const isMissed =
              log.status === "missed" ||
              log.status === "rejected" ||
              log.status === "busy";
            const isOutgoing = log.direction === "outgoing";

            return (
              <div
                key={log.id}
                className="flex items-center justify-between px-4 py-3 border-b border-[#202c33] hover:bg-[#202c33] transition"
              >
                {/* Peer Avatar & Details */}
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-10 h-10 rounded-full bg-[#00a884]/20 text-[#00a884] flex items-center justify-center font-semibold text-sm flex-shrink-0">
                    {log.peerDisplayName ? (
                      log.peerDisplayName.charAt(0).toUpperCase()
                    ) : (
                      <UserIcon className="w-5 h-5" />
                    )}
                  </div>

                  <div className="flex flex-col min-w-0">
                    <span
                      className={`text-sm font-semibold truncate ${
                        isMissed && !isOutgoing ? "text-red-400" : "text-[#e9edef]"
                      }`}
                    >
                      {log.peerDisplayName || log.peerPhoneNumber || log.peerId}
                    </span>

                    <div className="flex items-center gap-1.5 text-xs text-[#8696a0]">
                      {isMissed && !isOutgoing ? (
                        <PhoneMissed className="w-3.5 h-3.5 text-red-400 flex-shrink-0" />
                      ) : isOutgoing ? (
                        <ArrowUpRight className="w-3.5 h-3.5 text-[#00a884] flex-shrink-0" />
                      ) : (
                        <ArrowDownLeft className="w-3.5 h-3.5 text-[#00a884] flex-shrink-0" />
                      )}
                      <span>{formatCallTime(log.startTime)}</span>
                      {log.durationSeconds > 0 && (
                        <span>• {formatDuration(log.durationSeconds)}</span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Quick Redial Buttons */}
                <div className="flex items-center gap-1">
                  <button
                    onClick={() =>
                      callManager.startCall(
                        log.peerId,
                        log.peerDisplayName,
                        "voice",
                        log.groupId
                      )
                    }
                    title="Voice Call"
                    className="p-2 text-[#00a884] hover:bg-[#374248] rounded-full transition active:scale-95"
                  >
                    <Phone className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() =>
                      callManager.startCall(
                        log.peerId,
                        log.peerDisplayName,
                        "video",
                        log.groupId
                      )
                    }
                    title="Video Call"
                    className="p-2 text-[#00a884] hover:bg-[#374248] rounded-full transition active:scale-95"
                  >
                    <Video className="w-4 h-4" />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

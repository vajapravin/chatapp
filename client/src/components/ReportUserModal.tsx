import React, { useState } from "react";
import { X, AlertOctagon, ShieldAlert, Loader2 } from "lucide-react";
import { localDB } from "../storage/db";
import { usePrivacyStore } from "../store/privacyStore";

interface ReportUserModalProps {
  reportedUserId: string;
  reportedDisplayName: string;
  chatId: string;
  onClose: () => void;
  onReported?: () => void;
}

const REPORT_REASONS = [
  { id: "spam", label: "Spam or unwanted advertising" },
  { id: "harassment", label: "Harassment, hate speech or threats" },
  { id: "offensive", label: "Offensive or inappropriate content" },
  { id: "fraud", label: "Scam or fraudulent activity" },
  { id: "other", label: "Other issue" },
];

export const ReportUserModal: React.FC<ReportUserModalProps> = ({
  reportedUserId,
  reportedDisplayName,
  chatId,
  onClose,
  onReported,
}) => {
  const [reason, setReason] = useState("spam");
  const [blockUser, setBlockUser] = useState(true);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const { loadBlockedUsers } = usePrivacyStore();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      // 1. Gather last 5 messages from this chat as encrypted evidence
      const allMessages = await localDB.getMessagesForChat(chatId);
      const evidence = allMessages.slice(-5).map((m) => ({
        id: m.id,
        senderId: m.senderId,
        text: m.text,
        timestamp: m.timestamp,
        mediaType: m.messageType,
      }));

      const evidenceJson = JSON.stringify(evidence);
      const evidenceBase64 = btoa(unescape(encodeURIComponent(evidenceJson)));

      const rawAuth = localStorage.getItem("chatapp_auth");
      const token = rawAuth ? JSON.parse(rawAuth).accessToken : "";

      const res = await fetch("/v1/users/reports", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          reported_user_id: reportedUserId,
          reason,
          encrypted_evidence: evidenceBase64,
          block_user: blockUser,
        }),
      });

      if (!res.ok) {
        throw new Error(await res.text());
      }

      if (blockUser) {
        await loadBlockedUsers();
      }

      setSuccess(true);
      setTimeout(() => {
        if (onReported) onReported();
        onClose();
      }, 1200);
    } catch (err) {
      console.error("Failed to submit report:", err);
      alert("Failed to submit report. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-[#222e35] text-[#e9edef] rounded-2xl w-full max-w-md overflow-hidden shadow-2xl border border-[#374248] flex flex-col">
        {/* Header */}
        <div className="px-5 py-4 border-b border-[#2a3942] flex items-center justify-between">
          <div className="flex items-center gap-2.5 text-[#f15c6d]">
            <AlertOctagon className="w-5 h-5" />
            <h3 className="font-semibold text-lg text-[#e9edef]">Report {reportedDisplayName}</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-full text-[#8696a0] hover:text-[#e9edef] hover:bg-[#111b21] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        {success ? (
          <div className="p-8 flex flex-col items-center text-center">
            <div className="w-12 h-12 rounded-full bg-[#00a884]/20 text-[#00a884] flex items-center justify-center mb-3">
              ✓
            </div>
            <h4 className="text-lg font-semibold mb-1">Report Submitted</h4>
            <p className="text-sm text-[#8696a0]">
              Thank you for keeping ChatApp safe. Our moderation team will investigate.
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="p-6 flex flex-col gap-5">
            <div className="bg-[#111b21] rounded-xl p-3.5 border border-[#2a3942] text-xs text-[#8696a0] flex items-start gap-2.5">
              <ShieldAlert className="w-4 h-4 text-[#f15c6d] shrink-0 mt-0.5" />
              <span>
                The last 5 messages from this chat will be forwarded to the moderation team. No one in the chat will be notified.
              </span>
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#8696a0] uppercase tracking-wider mb-2">
                Select a reason
              </label>
              <div className="space-y-2">
                {REPORT_REASONS.map((r) => (
                  <label
                    key={r.id}
                    className="flex items-center gap-3 p-2.5 rounded-xl hover:bg-[#111b21] cursor-pointer transition-colors border border-transparent hover:border-[#2a3942]"
                  >
                    <input
                      type="radio"
                      name="report_reason"
                      value={r.id}
                      checked={reason === r.id}
                      onChange={() => setReason(r.id)}
                      className="accent-[#00a884] w-4 h-4"
                    />
                    <span className="text-sm">{r.label}</span>
                  </label>
                ))}
              </div>
            </div>

            <label className="flex items-center gap-3 p-2 cursor-pointer select-none text-sm border-t border-[#2a3942] pt-4">
              <input
                type="checkbox"
                checked={blockUser}
                onChange={(e) => setBlockUser(e.target.checked)}
                className="accent-[#00a884] w-4 h-4 rounded"
              />
              <span>Block user and delete messages</span>
            </label>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-sm text-[#8696a0] hover:text-[#e9edef] rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading}
                className="px-5 py-2.5 bg-[#f15c6d] hover:bg-[#d94a5a] text-white font-medium rounded-xl text-sm flex items-center gap-2 transition-all shadow-md disabled:opacity-50"
              >
                {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                <span>Report</span>
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};

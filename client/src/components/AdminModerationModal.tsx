import React, { useState, useEffect } from "react";
import { X, Shield, CheckCircle, Ban, RefreshCw, ChevronDown, ChevronUp } from "lucide-react";

interface ReportItem {
  id: string;
  reporter_id: string;
  reported_user_id: string;
  reason: string;
  encrypted_evidence: string;
  status: string;
  admin_notes?: string;
  created_at: string;
}

interface AdminModerationModalProps {
  onClose: () => void;
}

export const AdminModerationModal: React.FC<AdminModerationModalProps> = ({ onClose }) => {
  const [reports, setReports] = useState<ReportItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const fetchReports = async () => {
    setLoading(true);
    try {
      const rawAuth = localStorage.getItem("chatapp_auth");
      const token = rawAuth ? JSON.parse(rawAuth).accessToken : "";
      const res = await fetch("/v1/admin/reports", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        setReports(await res.json());
      }
    } catch (err) {
      console.error("Failed to fetch reports:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReports();
  }, []);

  const handleResolve = async (reportId: string, status: "resolved" | "dismissed") => {
    try {
      const rawAuth = localStorage.getItem("chatapp_auth");
      const token = rawAuth ? JSON.parse(rawAuth).accessToken : "";
      await fetch(`/v1/admin/reports/${reportId}/resolve`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ status, admin_notes: `Marked ${status} by admin` }),
      });
      await fetchReports();
    } catch (err) {
      console.error("Failed to resolve report:", err);
    }
  };

  const handleBanUser = async (userId: string, reportId: string) => {
    if (!confirm(`Are you sure you want to ban user ${userId}? This will terminate all active sessions.`)) {
      return;
    }
    try {
      const rawAuth = localStorage.getItem("chatapp_auth");
      const token = rawAuth ? JSON.parse(rawAuth).accessToken : "";
      await fetch(`/v1/admin/users/${userId}/ban`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ reason: "Violation reported and confirmed by moderation" }),
      });
      await handleResolve(reportId, "resolved");
    } catch (err) {
      console.error("Failed to ban user:", err);
    }
  };

  const decodeEvidence = (base64Str: string) => {
    try {
      const jsonStr = decodeURIComponent(escape(atob(base64Str)));
      return JSON.parse(jsonStr);
    } catch {
      return null;
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-[#222e35] text-[#e9edef] rounded-2xl w-full max-w-2xl max-h-[85vh] overflow-hidden shadow-2xl border border-[#374248] flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-[#2a3942] flex items-center justify-between">
          <div className="flex items-center gap-2.5 text-[#00a884]">
            <Shield className="w-5 h-5" />
            <h3 className="font-semibold text-lg text-[#e9edef]">Admin Moderation Center</h3>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={fetchReports}
              className="p-1.5 rounded-full text-[#8696a0] hover:text-[#e9edef] hover:bg-[#111b21] transition-colors"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            </button>
            <button
              onClick={onClose}
              className="p-1 rounded-full text-[#8696a0] hover:text-[#e9edef] hover:bg-[#111b21] transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content list */}
        <div className="p-6 overflow-y-auto flex flex-col gap-4">
          {reports.length === 0 ? (
            <div className="text-center py-12 text-[#8696a0] text-sm">
              <CheckCircle className="w-10 h-10 text-[#00a884] mx-auto mb-2 opacity-50" />
              No pending abuse reports. All clear!
            </div>
          ) : (
            reports.map((report) => {
              const isExpanded = expandedId === report.id;
              const evidenceMessages = decodeEvidence(report.encrypted_evidence);

              return (
                <div
                  key={report.id}
                  className="bg-[#111b21] rounded-xl border border-[#2a3942] p-4 flex flex-col gap-3 transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 rounded text-xs font-semibold uppercase tracking-wider bg-[#f15c6d]/20 text-[#f15c6d]">
                        {report.reason}
                      </span>
                      <span className="text-xs text-[#8696a0]">
                        Reported: <span className="font-mono text-[#e9edef]">{report.reported_user_id.slice(0, 10)}...</span>
                      </span>
                    </div>
                    <span
                      className={`text-xs px-2 py-0.5 rounded capitalize ${
                        report.status === "pending"
                          ? "bg-amber-500/20 text-amber-400"
                          : "bg-emerald-500/20 text-emerald-400"
                      }`}
                    >
                      {report.status}
                    </span>
                  </div>

                  <div className="text-xs text-[#8696a0] flex items-center justify-between">
                    <span>By: <span className="font-mono text-[#e9edef]">{report.reporter_id.slice(0, 10)}...</span></span>
                    <span>{new Date(report.created_at).toLocaleString()}</span>
                  </div>

                  {/* Expand evidence toggle */}
                  <button
                    onClick={() => setExpandedId(isExpanded ? null : report.id)}
                    className="flex items-center gap-1.5 text-xs text-[#00a884] hover:underline self-start mt-1"
                  >
                    <span>{isExpanded ? "Hide Evidence" : "Inspect Forwarded Messages"}</span>
                    {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                  </button>

                  {/* Evidence Display */}
                  {isExpanded && evidenceMessages && (
                    <div className="bg-[#202c33] rounded-lg p-3 text-xs space-y-2 border border-[#2a3942] mt-1">
                      <div className="font-semibold text-[#8696a0] text-[11px] uppercase tracking-wider mb-1">
                        Forwarded Chat Context (Last 5 Messages)
                      </div>
                      {Array.isArray(evidenceMessages) && evidenceMessages.length > 0 ? (
                        evidenceMessages.map((m: any, idx: number) => (
                          <div key={idx} className="bg-[#111b21] p-2 rounded border border-[#2a3942]/60">
                            <span className="text-[10px] text-[#8696a0] font-mono mr-2">
                              {m.senderId === report.reported_user_id ? "Reported User" : "Reporter"}:
                            </span>
                            <span className="text-[#e9edef]">{m.text}</span>
                          </div>
                        ))
                      ) : (
                        <div className="text-[#8696a0] italic">No text content in bundle</div>
                      )}
                    </div>
                  )}

                  {/* Action buttons */}
                  {report.status === "pending" && (
                    <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#2a3942]">
                      <button
                        onClick={() => handleResolve(report.id, "dismissed")}
                        className="px-3 py-1.5 rounded-lg text-xs bg-[#222e35] hover:bg-[#2a3942] text-[#8696a0] transition-colors"
                      >
                        Dismiss
                      </button>
                      <button
                        onClick={() => handleResolve(report.id, "resolved")}
                        className="px-3 py-1.5 rounded-lg text-xs bg-[#00a884]/20 hover:bg-[#00a884]/30 text-[#00a884] font-medium transition-colors"
                      >
                        Resolve
                      </button>
                      <button
                        onClick={() => handleBanUser(report.reported_user_id, report.id)}
                        className="px-3 py-1.5 rounded-lg text-xs bg-[#f15c6d] hover:bg-[#d94a5a] text-white font-medium flex items-center gap-1.5 transition-colors shadow-sm"
                      >
                        <Ban className="w-3.5 h-3.5" />
                        <span>Ban User</span>
                      </button>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};

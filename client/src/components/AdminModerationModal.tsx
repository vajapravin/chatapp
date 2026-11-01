import React, { useState, useEffect } from "react";
import {
  X,
  Shield,
  Ban,
  RefreshCw,
  Mail,
  UserPlus,
  Copy,
  RotateCcw,
  Trash2,
  Send,
} from "lucide-react";

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

interface InviteItem {
  id: string;
  email: string;
  role: string;
  status: string;
  invited_by: string | null;
  expires_at: string;
  created_at: string;
  accepted_at?: string;
  invite_link?: string;
}

interface AdminModerationModalProps {
  onClose: () => void;
}

export const AdminModerationModal: React.FC<AdminModerationModalProps> = ({ onClose }) => {
  const [activeTab, setActiveTab] = useState<"invites" | "reports">("invites");
  const [reports, setReports] = useState<ReportItem[]>([]);
  const [invites, setInvites] = useState<InviteItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // New Invite Form State
  const [newEmails, setNewEmails] = useState("");
  const [newRole, setNewRole] = useState<"user" | "admin">("user");
  const [newDays, setNewDays] = useState(7);
  const [creatingInvites, setCreatingInvites] = useState(false);

  // Disable user input
  const [targetUserId, setTargetUserId] = useState("");
  const [disablingUser, setDisablingUser] = useState(false);

  const getAuthToken = () => {
    const raw = localStorage.getItem("chatapp_auth");
    return raw ? JSON.parse(raw).accessToken : "";
  };

  const fetchInvites = async () => {
    try {
      const res = await fetch("/v1/admin/invites", {
        headers: { Authorization: `Bearer ${getAuthToken()}` },
      });
      if (res.ok) {
        setInvites(await res.json());
      }
    } catch (err) {
      console.error("Failed to load invites:", err);
    }
  };

  const fetchReports = async () => {
    try {
      const res = await fetch("/v1/admin/reports", {
        headers: { Authorization: `Bearer ${getAuthToken()}` },
      });
      if (res.ok) {
        setReports(await res.json());
      }
    } catch (err) {
      console.error("Failed to load reports:", err);
    }
  };

  const reloadData = async () => {
    setLoading(true);
    await Promise.all([fetchInvites(), fetchReports()]);
    setLoading(false);
  };

  useEffect(() => {
    reloadData();
  }, []);

  const handleCreateInvites = async (e: React.FormEvent) => {
    e.preventDefault();
    const emails = newEmails
      .split(/[\n,;]+/)
      .map((e) => e.trim())
      .filter((e) => e.includes("@"));

    if (emails.length === 0) {
      setError("Please enter at least one valid email address.");
      return;
    }

    setCreatingInvites(true);
    setError(null);
    setSuccessMsg(null);
    try {
      const res = await fetch("/v1/admin/invites", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${getAuthToken()}`,
        },
        body: JSON.stringify({
          emails,
          role: newRole,
          expires_in_days: newDays,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || "Failed to create invites.");
      }

      setNewEmails("");
      setSuccessMsg(`Successfully dispatched ${emails.length} invite(s)!`);
      await fetchInvites();
    } catch (err: any) {
      setError(err.message || "Failed to create invites.");
    } finally {
      setCreatingInvites(false);
    }
  };

  const handleResend = async (inviteId: string) => {
    setError(null);
    try {
      const res = await fetch(`/v1/admin/invites/${inviteId}:resend`, {
        method: "POST",
        headers: { Authorization: `Bearer ${getAuthToken()}` },
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || "Failed to resend invite.");
      }
      setSuccessMsg("Invite resent successfully with refreshed token!");
      await fetchInvites();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleRevoke = async (inviteId: string) => {
    if (!confirm("Are you sure you want to revoke this invite?")) return;
    setError(null);
    try {
      const res = await fetch(`/v1/admin/invites/${inviteId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${getAuthToken()}` },
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || "Failed to revoke invite.");
      }
      setSuccessMsg("Invite revoked.");
      await fetchInvites();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleDisableUser = async (userId: string) => {
    if (!confirm(`Disable user ${userId}? All their sessions will be terminated immediately.`)) {
      return;
    }
    setDisablingUser(true);
    setError(null);
    try {
      const res = await fetch(`/v1/admin/users/${userId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${getAuthToken()}`,
        },
        body: JSON.stringify({ status: "disabled" }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || "Failed to disable user.");
      }
      setSuccessMsg(`User ${userId} disabled and kicked.`);
      setTargetUserId("");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setDisablingUser(false);
    }
  };

  const handleResolve = async (reportId: string, status: "resolved" | "dismissed") => {
    try {
      await fetch(`/v1/admin/reports/${reportId}/resolve`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${getAuthToken()}`,
        },
        body: JSON.stringify({ status, admin_notes: `Marked ${status} by admin` }),
      });
      await fetchReports();
    } catch (err) {
      console.error("Failed to resolve report:", err);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="w-full max-w-4xl h-[90vh] bg-[#202c33] rounded-2xl border border-[#2a3942] shadow-2xl flex flex-col overflow-hidden text-[#e9edef]">
        {/* Header */}
        <div className="h-16 px-6 bg-[#111b21] border-b border-[#2a3942] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/20 text-amber-400 flex items-center justify-center font-bold">
              <Shield className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">Admin Control Center</h2>
              <p className="text-xs text-[#8696a0]">Invite-only access & moderation</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex bg-[#202c33] p-1 rounded-xl border border-[#2a3942]">
              <button
                onClick={() => setActiveTab("invites")}
                className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition ${
                  activeTab === "invites"
                    ? "bg-[#00a884] text-[#111b21]"
                    : "text-[#8696a0] hover:text-white"
                }`}
              >
                Invites ({invites.length})
              </button>
              <button
                onClick={() => setActiveTab("reports")}
                className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition ${
                  activeTab === "reports"
                    ? "bg-[#00a884] text-[#111b21]"
                    : "text-[#8696a0] hover:text-white"
                }`}
              >
                Reports ({reports.length})
              </button>
            </div>

            <button
              onClick={reloadData}
              title="Refresh"
              className="p-2 text-[#8696a0] hover:text-white hover:bg-[#2a3942] rounded-xl transition"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            </button>
            <button
              onClick={onClose}
              className="p-2 text-[#8696a0] hover:text-white hover:bg-[#2a3942] rounded-xl transition"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Alerts */}
        {error && (
          <div className="px-6 py-2.5 bg-red-500/10 border-b border-red-500/20 text-red-400 text-xs flex items-center justify-between">
            <span>{error}</span>
            <button onClick={() => setError(null)}><X className="w-3.5 h-3.5" /></button>
          </div>
        )}
        {successMsg && (
          <div className="px-6 py-2.5 bg-[#00a884]/10 border-b border-[#00a884]/20 text-[#00a884] text-xs flex items-center justify-between">
            <span>{successMsg}</span>
            <button onClick={() => setSuccessMsg(null)}><X className="w-3.5 h-3.5" /></button>
          </div>
        )}

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {activeTab === "invites" ? (
            <>
              {/* Issue Invites Box */}
              <div className="p-5 rounded-2xl bg-[#111b21] border border-[#2a3942] space-y-4">
                <div className="flex items-center gap-2 text-sm font-bold text-white">
                  <UserPlus className="w-4 h-4 text-[#00a884]" />
                  <span>Issue New Email Invites</span>
                </div>
                <form onSubmit={handleCreateInvites} className="space-y-3">
                  <div>
                    <label className="block text-xs font-semibold text-[#8696a0] mb-1">
                      Email Addresses (one per line or comma-separated)
                    </label>
                    <textarea
                      rows={2}
                      value={newEmails}
                      onChange={(e) => setNewEmails(e.target.value)}
                      placeholder="user1@example.com, user2@example.com"
                      className="w-full px-3 py-2 bg-[#202c33] border border-[#2a3942] rounded-xl text-xs text-white focus:outline-none focus:border-[#00a884] font-mono resize-none"
                    />
                  </div>

                  <div className="flex items-center gap-4">
                    <div className="flex-1">
                      <label className="block text-xs font-semibold text-[#8696a0] mb-1">Role</label>
                      <select
                        value={newRole}
                        onChange={(e) => setNewRole(e.target.value as any)}
                        className="w-full px-3 py-2 bg-[#202c33] border border-[#2a3942] rounded-xl text-xs text-white focus:outline-none focus:border-[#00a884]"
                      >
                        <option value="user">User</option>
                        <option value="admin">Admin</option>
                      </select>
                    </div>

                    <div className="flex-1">
                      <label className="block text-xs font-semibold text-[#8696a0] mb-1">Expiry (Days)</label>
                      <input
                        type="number"
                        min={1}
                        max={30}
                        value={newDays}
                        onChange={(e) => setNewDays(Number(e.target.value))}
                        className="w-full px-3 py-2 bg-[#202c33] border border-[#2a3942] rounded-xl text-xs text-white focus:outline-none focus:border-[#00a884]"
                      />
                    </div>

                    <div className="self-end">
                      <button
                        type="submit"
                        disabled={creatingInvites}
                        className="px-5 py-2.5 bg-[#00a884] hover:bg-[#02906f] text-[#111b21] rounded-xl text-xs font-bold flex items-center gap-1.5 transition disabled:opacity-50"
                      >
                        {creatingInvites ? (
                          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <>
                            <Send className="w-3.5 h-3.5" />
                            <span>Dispatch Invites</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                </form>
              </div>

              {/* Disable User Quick Action */}
              <div className="p-4 rounded-2xl bg-[#111b21] border border-[#2a3942] flex items-center justify-between gap-4">
                <div className="flex items-center gap-2">
                  <Ban className="w-4 h-4 text-red-400 shrink-0" />
                  <div>
                    <span className="text-xs font-bold text-white">Disable & Kick User</span>
                    <p className="text-[11px] text-[#8696a0]">Terminates all sessions and MQTT connection immediately</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={targetUserId}
                    onChange={(e) => setTargetUserId(e.target.value)}
                    placeholder="Enter user ID"
                    className="px-3 py-1.5 bg-[#202c33] border border-[#2a3942] rounded-xl text-xs text-white focus:outline-none focus:border-red-400 font-mono w-56"
                  />
                  <button
                    onClick={() => handleDisableUser(targetUserId)}
                    disabled={!targetUserId.trim() || disablingUser}
                    className="px-3 py-1.5 bg-red-500/20 hover:bg-red-500/30 text-red-400 rounded-xl text-xs font-semibold transition disabled:opacity-40"
                  >
                    Disable
                  </button>
                </div>
              </div>

              {/* Invites List */}
              <div className="space-y-3">
                <h3 className="text-xs font-bold uppercase tracking-wider text-[#8696a0]">
                  Invites History ({invites.length})
                </h3>

                {invites.length === 0 ? (
                  <div className="text-center py-10 text-xs text-[#8696a0] bg-[#111b21] rounded-2xl border border-[#2a3942]">
                    No invites issued yet.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {invites.map((inv) => (
                      <div
                        key={inv.id}
                        className="p-3.5 rounded-xl bg-[#111b21] border border-[#2a3942] flex items-center justify-between gap-4"
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-lg bg-[#202c33] text-[#8696a0] flex items-center justify-center shrink-0">
                            <Mail className="w-4 h-4" />
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-bold text-white">{inv.email}</span>
                              <span
                                className={`text-[10px] px-2 py-0.5 rounded-full font-semibold uppercase ${
                                  inv.status === "accepted"
                                    ? "bg-[#00a884]/20 text-[#00a884]"
                                    : inv.status === "pending"
                                    ? "bg-amber-500/20 text-amber-400"
                                    : "bg-red-500/20 text-red-400"
                                }`}
                              >
                                {inv.status}
                              </span>
                              <span className="text-[10px] text-[#8696a0] uppercase font-mono">
                                {inv.role}
                              </span>
                            </div>
                            <span className="text-[11px] text-[#8696a0] flex items-center gap-2 mt-0.5">
                              <span>Expires: {new Date(inv.expires_at).toLocaleDateString()}</span>
                              {inv.accepted_at && (
                                <span>• Accepted: {new Date(inv.accepted_at).toLocaleDateString()}</span>
                              )}
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          {inv.invite_link && (
                            <button
                              onClick={() => {
                                navigator.clipboard.writeText(inv.invite_link!);
                                setSuccessMsg("Invite link copied to clipboard!");
                              }}
                              title="Copy Link"
                              className="p-1.5 text-[#8696a0] hover:text-white hover:bg-[#202c33] rounded-lg transition"
                            >
                              <Copy className="w-3.5 h-3.5" />
                            </button>
                          )}
                          {inv.status === "pending" && (
                            <>
                              <button
                                onClick={() => handleResend(inv.id)}
                                title="Resend"
                                className="p-1.5 text-amber-400 hover:bg-[#202c33] rounded-lg transition"
                              >
                                <RotateCcw className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => handleRevoke(inv.id)}
                                title="Revoke"
                                className="p-1.5 text-red-400 hover:bg-[#202c33] rounded-lg transition"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : (
            /* Abuse Reports Tab */
            <div className="space-y-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-[#8696a0]">
                Abuse Reports ({reports.length})
              </h3>
              {reports.length === 0 ? (
                <div className="text-center py-10 text-xs text-[#8696a0] bg-[#111b21] rounded-2xl border border-[#2a3942]">
                  No reports pending review.
                </div>
              ) : (
                reports.map((r) => (
                  <div
                    key={r.id}
                    className="p-4 rounded-xl bg-[#111b21] border border-[#2a3942] space-y-2"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-white">Reason: {r.reason}</span>
                      <span className="text-[10px] text-[#8696a0]">{new Date(r.created_at).toLocaleString()}</span>
                    </div>
                    <p className="text-xs text-[#8696a0]">
                      Reporter: {r.reporter_id} • Target: {r.reported_user_id}
                    </p>
                    {r.status === "pending" && (
                      <div className="flex gap-2 pt-2">
                        <button
                          onClick={() => handleResolve(r.id, "resolved")}
                          className="px-3 py-1 bg-[#00a884]/20 hover:bg-[#00a884]/30 text-[#00a884] rounded-lg text-xs font-semibold transition"
                        >
                          Resolve
                        </button>
                        <button
                          onClick={() => handleResolve(r.id, "dismissed")}
                          className="px-3 py-1 bg-[#202c33] hover:bg-[#2a3942] text-[#8696a0] rounded-lg text-xs font-semibold transition"
                        >
                          Dismiss
                        </button>
                        <button
                          onClick={() => handleDisableUser(r.reported_user_id)}
                          className="px-3 py-1 bg-red-500/20 hover:bg-red-500/30 text-red-400 rounded-lg text-xs font-semibold transition ml-auto"
                        >
                          Ban User
                        </button>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

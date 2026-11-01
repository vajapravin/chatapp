import React, { useState, useEffect } from "react";
import { Mail, CheckCircle, AlertTriangle, ArrowRight, RefreshCw, KeyRound, User as UserIcon } from "lucide-react";
import { useAuthStore } from "../store/authStore";

interface InviteAcceptFormProps {
  token: string;
  onSuccess: () => void;
}

export const InviteAcceptForm: React.FC<InviteAcceptFormProps> = ({ token, onSuccess }) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [inviteData, setInviteData] = useState<{
    status: string;
    masked_email: string;
    role: string;
    expires_at: string;
  } | null>(null);

  const [step, setStep] = useState<"lookup" | "otp">("lookup");
  const [otpCode, setOtpCode] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [countdown, setCountdown] = useState(0);

  const { setAuth, setUser } = useAuthStore();

  useEffect(() => {
    let timer: any;
    if (countdown > 0) {
      timer = setTimeout(() => setCountdown(countdown - 1), 1000);
    }
    return () => clearTimeout(timer);
  }, [countdown]);

  useEffect(() => {
    const fetchInvite = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/v1/invites/${token}`);
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.detail || "This invite is no longer valid or has expired.");
        }
        const data = await res.json();
        setInviteData(data);
      } catch (err: any) {
        setError(err.message || "Failed to load invite details.");
      } finally {
        setLoading(false);
      }
    };

    fetchInvite();
  }, [token]);

  const handleRequestOtp = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/v1/invites/${token}/otp`, { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || "Failed to dispatch verification code.");
      }
      setStep("otp");
      setCountdown(60);
    } catch (err: any) {
      setError(err.message || "Failed to send code.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleAcceptInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (otpCode.length !== 6) {
      setError("Please enter a valid 6-digit verification code.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/v1/invites/${token}/accept`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: otpCode.trim(),
          display_name: displayName.trim() || undefined,
          device_name: "Web Browser",
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || "Verification failed.");
      }

      const tokenRes = await res.json();
      setAuth({
        accessToken: tokenRes.access_token,
        refreshToken: tokenRes.refresh_token,
        userId: tokenRes.user_id,
        deviceId: tokenRes.device_id,
      });

      // Fetch user details
      const userRes = await fetch("/v1/users/me", {
        headers: { Authorization: `Bearer ${tokenRes.access_token}` },
      });
      if (userRes.ok) {
        const userData = await userRes.json();
        setUser(userData);
      }

      // Clear the invite URL from browser history
      window.history.replaceState({}, "", "/");
      onSuccess();
    } catch (err: any) {
      setError(err.message || "Failed to accept invite.");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="w-full max-w-md p-8 bg-[#202c33] rounded-2xl border border-[#2a3942] text-center shadow-2xl">
        <RefreshCw className="w-8 h-8 text-[#00a884] animate-spin mx-auto mb-4" />
        <h2 className="text-lg font-semibold text-white">Validating Invitation...</h2>
        <p className="text-sm text-[#8696a0] mt-2">Checking authorization and validity</p>
      </div>
    );
  }

  if (error && !inviteData) {
    return (
      <div className="w-full max-w-md p-8 bg-[#202c33] rounded-2xl border border-red-500/30 text-center shadow-2xl">
        <div className="w-12 h-12 rounded-full bg-red-500/10 text-red-400 flex items-center justify-center mx-auto mb-4">
          <AlertTriangle className="w-6 h-6" />
        </div>
        <h2 className="text-xl font-bold text-white mb-2">Invalid or Expired Invite</h2>
        <p className="text-sm text-[#8696a0] mb-6">{error}</p>
        <button
          onClick={() => {
            window.history.replaceState({}, "", "/");
            window.location.reload();
          }}
          className="w-full py-3 bg-[#2a3942] hover:bg-[#374248] text-white rounded-xl text-sm font-semibold transition"
        >
          Return to Sign In
        </button>
      </div>
    );
  }

  return (
    <div className="w-full max-w-md p-8 bg-[#202c33] rounded-2xl border border-[#2a3942] shadow-2xl text-[#e9edef]">
      <div className="text-center mb-6">
        <div className="w-14 h-14 rounded-2xl bg-[#00a884]/20 text-[#00a884] flex items-center justify-center mx-auto mb-4 border border-[#00a884]/30 shadow-lg">
          <KeyRound className="w-7 h-7" />
        </div>
        <h1 className="text-2xl font-bold text-white">You're Invited!</h1>
        <p className="text-xs text-[#8696a0] mt-1">
          Exclusive invite-only workspace access
        </p>
      </div>

      {error && (
        <div className="p-3 mb-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {step === "lookup" ? (
        <div className="space-y-4">
          <div className="p-4 rounded-xl bg-[#111b21] border border-[#222e35] space-y-2">
            <div className="flex items-center justify-between text-xs text-[#8696a0]">
              <span>Invited Email</span>
              <span className="capitalize px-2 py-0.5 rounded bg-[#00a884]/20 text-[#00a884] font-medium">
                {inviteData?.role || "user"}
              </span>
            </div>
            <div className="flex items-center gap-2 text-white font-medium text-base">
              <Mail className="w-4 h-4 text-[#00a884]" />
              <span>{inviteData?.masked_email}</span>
            </div>
          </div>

          <p className="text-xs text-[#8696a0] leading-relaxed">
            To accept this invitation and activate your account, we will send a one-time verification code to this email address.
          </p>

          <button
            onClick={handleRequestOtp}
            disabled={submitting}
            className="w-full py-3.5 bg-[#00a884] hover:bg-[#02906f] text-[#111b21] rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition disabled:opacity-50 shadow-md"
          >
            {submitting ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : (
              <>
                <span>Send Verification Code</span>
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
        </div>
      ) : (
        <form onSubmit={handleAcceptInvite} className="space-y-4">
          <div className="p-3 rounded-xl bg-[#111b21] border border-[#222e35] text-xs text-[#8696a0] flex items-center justify-between">
            <span>Code sent to {inviteData?.masked_email}</span>
            <button
              type="button"
              disabled={countdown > 0 || submitting}
              onClick={handleRequestOtp}
              className="text-[#00a884] hover:underline disabled:text-[#8696a0]"
            >
              {countdown > 0 ? `Resend (${countdown}s)` : "Resend code"}
            </button>
          </div>

          <div>
            <label className="block text-xs font-semibold text-[#8696a0] mb-1.5 uppercase tracking-wide">
              Verification Code
            </label>
            <input
              type="text"
              maxLength={6}
              value={otpCode}
              onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ""))}
              placeholder="123456"
              className="w-full px-4 py-3 bg-[#111b21] border border-[#2a3942] rounded-xl text-center text-2xl font-mono tracking-widest text-white focus:outline-none focus:border-[#00a884]"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-[#8696a0] mb-1.5 uppercase tracking-wide">
              Your Display Name
            </label>
            <div className="relative">
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="e.g. Pravin Vaja"
                className="w-full px-4 py-3 pl-10 bg-[#111b21] border border-[#2a3942] rounded-xl text-sm text-white focus:outline-none focus:border-[#00a884]"
              />
              <UserIcon className="w-4 h-4 text-[#8696a0] absolute left-3.5 top-3.5" />
            </div>
          </div>

          <button
            type="submit"
            disabled={submitting || otpCode.length !== 6}
            className="w-full py-3.5 bg-[#00a884] hover:bg-[#02906f] text-[#111b21] rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition disabled:opacity-50 shadow-md mt-2"
          >
            {submitting ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : (
              <>
                <CheckCircle className="w-4 h-4" />
                <span>Complete Account Setup</span>
              </>
            )}
          </button>
        </form>
      )}
    </div>
  );
};

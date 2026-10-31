import React, { useState } from "react";
import { ArrowLeft, CheckCircle2, KeyRound } from "lucide-react";
import { verifyOtp, requestOtp } from "../services/api";
import { useAuthStore } from "../store/authStore";

interface OtpVerifyFormProps {
  phoneNumber: string;
  email?: string;
  onBack: () => void;
}

export const OtpVerifyForm: React.FC<OtpVerifyFormProps> = ({
  phoneNumber,
  email,
  onBack,
}) => {
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const setAuth = useAuthStore((state) => state.setAuth);

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (code.length !== 6) {
      setError("Please enter the complete 6-digit code.");
      return;
    }

    setLoading(true);
    try {
      const data = await verifyOtp(phoneNumber, code, "Web Client");
      setAuth({
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        userId: data.user_id,
        deviceId: data.device_id,
      });
    } catch (err: any) {
      setError(err.message || "Invalid or expired verification code.");
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    setResending(true);
    setError(null);
    setNotice(null);
    try {
      await requestOtp(phoneNumber, email);
      setNotice("A new 6-digit verification code has been dispatched.");
    } catch (err: any) {
      setError(err.message || "Failed to resend code.");
    } finally {
      setResending(false);
    }
  };

  return (
    <div className="w-full max-w-md bg-[#202c33] rounded-2xl shadow-2xl p-8 border border-[#2a3942]">
      <button
        onClick={onBack}
        className="text-[#8696a0] hover:text-white flex items-center gap-1.5 text-xs font-semibold mb-6 transition"
      >
        <ArrowLeft className="w-4 h-4" /> Change phone number
      </button>

      <div className="flex flex-col items-center text-center mb-6">
        <div className="w-16 h-16 bg-[#00a884]/15 rounded-full flex items-center justify-center mb-4 border border-[#00a884]/30">
          <KeyRound className="w-8 h-8 text-[#00a884]" />
        </div>
        <h1 className="text-2xl font-bold text-white tracking-wide">Enter Verification Code</h1>
        <p className="text-sm text-[#8696a0] mt-1">
          Code dispatched to <span className="text-white font-medium">{phoneNumber}</span>
        </p>
      </div>

      {notice && (
        <div className="mb-4 p-3 rounded-lg bg-[#00a884]/15 border border-[#00a884]/30 text-[#00a884] text-sm flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{notice}</span>
        </div>
      )}

      {error && (
        <div className="mb-6 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
          {error}
        </div>
      )}

      <form onSubmit={handleVerify} className="space-y-6">
        <div>
          <label className="block text-xs font-semibold uppercase text-[#8696a0] mb-2 tracking-wider text-center">
            6-Digit Verification Code
          </label>
          <input
            type="text"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            placeholder="123456"
            autoFocus
            className="w-full text-center text-2xl font-mono tracking-[0.5em] px-4 py-3.5 rounded-xl bg-[#111b21] border border-[#2a3942] text-white focus:outline-none focus:border-[#00a884] transition"
          />
        </div>

        <button
          type="submit"
          disabled={loading || code.length !== 6}
          className="w-full py-3.5 px-4 bg-[#00a884] hover:bg-[#008069] text-white font-medium rounded-xl flex items-center justify-center gap-2 transition disabled:opacity-50 shadow-lg shadow-[#00a884]/20"
        >
          {loading ? (
            <span className="inline-block animate-spin w-5 h-5 border-2 border-white border-t-transparent rounded-full" />
          ) : (
            <span>Verify & Launch Messenger</span>
          )}
        </button>
      </form>

      <div className="mt-6 text-center">
        <button
          onClick={handleResend}
          disabled={resending}
          className="text-xs text-[#00a884] hover:underline disabled:opacity-50"
        >
          {resending ? "Dispatching new code..." : "Didn't receive the code? Resend"}
        </button>
      </div>
    </div>
  );
};

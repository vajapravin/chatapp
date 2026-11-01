import React, { useState } from "react";
import { Lock, MessageSquare, ShieldCheck, ArrowRight } from "lucide-react";
import { requestOtp } from "../services/api";

interface LoginFormProps {
  onOtpRequested: (phone: string, email: string) => void;
  onLinkCompanion?: () => void;
}

export const LoginForm: React.FC<LoginFormProps> = ({ onOtpRequested, onLinkCompanion }) => {
  const [phoneNumber, setPhoneNumber] = useState("");
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const cleanPhone = phoneNumber.trim();
    const cleanEmail = email.trim();

    if (!cleanPhone && !cleanEmail) {
      setError("Please enter your email address or phone number.");
      return;
    }

    let finalPhone = cleanPhone;
    let finalEmail = cleanEmail;
    if (cleanPhone.includes("@") && !finalEmail) {
      finalEmail = cleanPhone;
    }
    if (!finalPhone && finalEmail) {
      finalPhone = finalEmail;
    }

    setLoading(true);
    try {
      await requestOtp(finalPhone, finalEmail);
      onOtpRequested(finalPhone, finalEmail);
    } catch (err: any) {
      setError(err.message || "Failed to dispatch verification code.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-full max-w-md bg-[#202c33] rounded-2xl shadow-2xl p-8 border border-[#2a3942]">
      <div className="flex flex-col items-center text-center mb-8">
        <div className="w-16 h-16 bg-[#00a884]/15 rounded-full flex items-center justify-center mb-4 border border-[#00a884]/30">
          <MessageSquare className="w-8 h-8 text-[#00a884]" />
        </div>
        <h1 className="text-2xl font-bold text-white tracking-wide">Welcome to Chatapp</h1>
        <p className="text-sm text-[#8696a0] mt-1 flex items-center gap-1">
          <ShieldCheck className="w-4 h-4 text-[#00a884]" /> Self-hosted, End-to-End Encrypted
        </p>
      </div>

      {error && (
        <div className="mb-6 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label className="block text-xs font-semibold uppercase text-[#8696a0] mb-2 tracking-wider">
            Email Address (or Phone Number)
          </label>
          <input
            type="text"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="w-full px-4 py-3 rounded-xl bg-[#111b21] border border-[#2a3942] text-white focus:outline-none focus:border-[#00a884] transition"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold uppercase text-[#8696a0] mb-2 tracking-wider">
            Phone Number (Optional)
          </label>
          <input
            type="tel"
            value={phoneNumber}
            onChange={(e) => setPhoneNumber(e.target.value)}
            placeholder="+1234567890"
            className="w-full px-4 py-3 rounded-xl bg-[#111b21] border border-[#2a3942] text-white focus:outline-none focus:border-[#00a884] transition"
          />
        </div>

        <div className="flex justify-end gap-2 text-xs text-[#8696a0]">
          <span>Quick fill:</span>
          <button
            type="button"
            onClick={() => {
              setPhoneNumber("+10000000001");
              setEmail("alice@example.com");
            }}
            className="text-[#00a884] hover:underline cursor-pointer"
          >
            Alice Dev
          </button>
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full py-3.5 px-4 bg-[#00a884] hover:bg-[#008069] text-white font-medium rounded-xl flex items-center justify-center gap-2 transition disabled:opacity-50 shadow-lg shadow-[#00a884]/20"
        >
          {loading ? (
            <span className="inline-block animate-spin w-5 h-5 border-2 border-white border-t-transparent rounded-full" />
          ) : (
            <>
              <span>Continue with Verification</span>
              <ArrowRight className="w-4 h-4" />
            </>
          )}
        </button>

        {onLinkCompanion && (
          <button
            type="button"
            onClick={onLinkCompanion}
            className="w-full py-3 px-4 bg-[#111b21] hover:bg-[#182229] border border-[#2a3942] text-[#00a884] font-medium rounded-xl flex items-center justify-center gap-2 text-xs transition"
          >
            <span>Link as companion device with QR code</span>
          </button>
        )}
      </form>

      <div className="mt-8 pt-6 border-t border-[#2a3942] text-center">
        <p className="text-xs text-[#8696a0] flex items-center justify-center gap-1.5">
          <Lock className="w-3.5 h-3.5 text-[#8696a0]" /> Server never stores plaintext content or private keys.
        </p>
      </div>
    </div>
  );
};

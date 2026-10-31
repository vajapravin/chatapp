import React, { useState } from "react";
import { Lock, MessageSquare, ShieldCheck, ArrowRight } from "lucide-react";
import { requestOtp } from "../services/api";

interface LoginFormProps {
  onOtpRequested: (phone: string, email: string) => void;
}

export const LoginForm: React.FC<LoginFormProps> = ({ onOtpRequested }) => {
  const [phoneNumber, setPhoneNumber] = useState("+10000000001");
  const [email, setEmail] = useState("alice@example.com");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!phoneNumber.trim()) {
      setError("Please enter a valid phone number.");
      return;
    }

    setLoading(true);
    try {
      await requestOtp(phoneNumber, email);
      onOtpRequested(phoneNumber, email);
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
            Phone Number (E.164)
          </label>
          <input
            type="tel"
            value={phoneNumber}
            onChange={(e) => setPhoneNumber(e.target.value)}
            placeholder="+1234567890"
            required
            className="w-full px-4 py-3 rounded-xl bg-[#111b21] border border-[#2a3942] text-white focus:outline-none focus:border-[#00a884] transition"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold uppercase text-[#8696a0] mb-2 tracking-wider">
            Email Address (Optional / Recovery)
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="w-full px-4 py-3 rounded-xl bg-[#111b21] border border-[#2a3942] text-white focus:outline-none focus:border-[#00a884] transition"
          />
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
      </form>

      <div className="mt-8 pt-6 border-t border-[#2a3942] text-center">
        <p className="text-xs text-[#8696a0] flex items-center justify-center gap-1.5">
          <Lock className="w-3.5 h-3.5 text-[#8696a0]" /> Server never stores plaintext content or private keys.
        </p>
      </div>
    </div>
  );
};

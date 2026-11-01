import React, { useState } from "react";
import { Lock, KeyRound, ShieldAlert } from "lucide-react";
import { usePrivacyStore } from "../store/privacyStore";

export const AppLockOverlay: React.FC = () => {
  const { appLock, unlockApp } = usePrivacyStore();
  const [pin, setPin] = useState("");
  const [error, setError] = useState(false);

  if (!appLock.enabled || !appLock.isLocked) {
    return null;
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (unlockApp(pin)) {
      setPin("");
      setError(false);
    } else {
      setError(true);
      setPin("");
    }
  };

  return (
    <div className="fixed inset-0 z-[9999] bg-[#111b21] flex flex-col items-center justify-center p-6 text-[#e9edef] select-none">
      <div className="w-full max-w-sm flex flex-col items-center text-center">
        <div className="w-20 h-20 rounded-full bg-[#00a884]/20 text-[#00a884] flex items-center justify-center mb-6 shadow-lg">
          <Lock className="w-10 h-10" />
        </div>

        <h2 className="text-2xl font-bold mb-2">WhatsApp Locked</h2>
        <p className="text-sm text-[#8696a0] mb-8">
          Enter your security PIN to access your end-to-end encrypted chats.
        </p>

        <form onSubmit={handleSubmit} className="w-full flex flex-col items-center">
          <div className="relative w-full max-w-[240px] mb-4">
            <input
              type="password"
              inputMode="numeric"
              maxLength={6}
              value={pin}
              onChange={(e) => {
                setError(false);
                setPin(e.target.value);
              }}
              placeholder="••••••"
              autoFocus
              className="w-full bg-[#202c33] border border-[#2a3942] focus:border-[#00a884] rounded-xl px-4 py-3 text-center text-2xl tracking-[0.5em] text-[#e9edef] placeholder-[#8696a0] outline-none transition-colors"
            />
          </div>

          {error && (
            <div className="flex items-center gap-1.5 text-[#f15c6d] text-sm mb-4">
              <ShieldAlert className="w-4 h-4" />
              <span>Incorrect PIN. Please try again.</span>
            </div>
          )}

          <button
            type="submit"
            disabled={pin.length < 4}
            className="w-full max-w-[240px] py-3 bg-[#00a884] hover:bg-[#02906f] disabled:opacity-50 text-[#111b21] font-semibold rounded-xl flex items-center justify-center gap-2 transition-all shadow-md active:scale-95"
          >
            <KeyRound className="w-4 h-4" />
            <span>Unlock</span>
          </button>
        </form>
      </div>
    </div>
  );
};

import React, { useState, useEffect } from "react";
import { QrCode, Laptop, Smartphone, ArrowLeft, Loader2, CheckCircle2 } from "lucide-react";
import { useAuthStore } from "../store/authStore";

interface CompanionLinkViewProps {
  onBack: () => void;
}

export const CompanionLinkView: React.FC<CompanionLinkViewProps> = ({ onBack }) => {
  const [linkCode, setLinkCode] = useState<string | null>(null);
  const [qrPayload, setQrPayload] = useState<string | null>(null);
  const [expiresIn, setExpiresIn] = useState<number>(120);
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [loading, setLoading] = useState(true);
  const { setAuth, setUser } = useAuthStore();

  const initiateSession = async () => {
    setLoading(true);
    try {
      const res = await fetch("/v1/devices/link/initiate", { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        setLinkCode(data.link_code);
        setQrPayload(data.qr_payload);
        setExpiresIn(data.expires_in || 120);
      }
    } catch (err) {
      console.error("Failed to initiate companion linking:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    initiateSession();
  }, []);

  // Polling loop
  useEffect(() => {
    if (!linkCode || isAuthorized) return;

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/v1/devices/link/poll/${linkCode}`);
        if (res.ok) {
          const data = await res.json();
          if (data.status === "authorized" && data.token) {
            setIsAuthorized(true);
            clearInterval(interval);

            // Store tokens in authStore
            const t = data.token;
            setAuth({
              accessToken: t.access_token,
              refreshToken: t.refresh_token,
              userId: t.user_id,
              deviceId: t.device_id,
            });

            // Fetch user profile
            const profRes = await fetch("/v1/users/me", {
              headers: { Authorization: `Bearer ${t.access_token}` },
            });
            if (profRes.ok) {
              setUser(await profRes.json());
            }
          } else if (data.status === "expired") {
            clearInterval(interval);
          }
        }
      } catch (err) {
        console.error("Error polling device link status:", err);
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [linkCode, isAuthorized, setAuth, setUser]);

  // Countdown timer
  useEffect(() => {
    if (expiresIn <= 0) return;
    const timer = setInterval(() => setExpiresIn((prev) => prev - 1), 1000);
    return () => clearInterval(timer);
  }, [expiresIn]);

  return (
    <div className="w-full max-w-md bg-[#202c33] border border-[#2a3942] rounded-2xl p-6 sm:p-8 text-[#e9edef] shadow-2xl flex flex-col items-center text-center animate-in fade-in duration-200">
      <button
        onClick={onBack}
        className="self-start flex items-center gap-1.5 text-xs text-[#8696a0] hover:text-[#e9edef] transition-colors mb-4"
      >
        <ArrowLeft className="w-4 h-4" />
        <span>Back to phone login</span>
      </button>

      <div className="w-14 h-14 rounded-full bg-[#00a884]/20 text-[#00a884] flex items-center justify-center mb-4">
        <Laptop className="w-7 h-7" />
      </div>

      <h2 className="text-xl font-bold mb-1">Link Companion Device</h2>
      <p className="text-xs text-[#8696a0] mb-6">
        Open ChatApp on your primary phone, go to Settings &gt; Linked Devices, and link this device.
      </p>

      {/* QR Code Container */}
      <div
        title={qrPayload || undefined}
        className="bg-white p-4 rounded-2xl shadow-inner border border-[#374248] mb-4 relative flex items-center justify-center min-w-[200px] min-h-[200px]"
      >
        {loading ? (
          <Loader2 className="w-8 h-8 text-[#00a884] animate-spin" />
        ) : isAuthorized ? (
          <div className="flex flex-col items-center gap-2 text-[#00a884]">
            <CheckCircle2 className="w-16 h-16 animate-bounce" />
            <span className="font-semibold text-sm">Device Authorized!</span>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3">
            <QrCode className="w-36 h-36 text-[#111b21]" />
            <div className="font-mono text-xs text-[#111b21] bg-slate-100 px-2 py-0.5 rounded font-bold tracking-wider">
              {linkCode?.slice(0, 8).toUpperCase()}
            </div>
          </div>
        )}
      </div>

      {/* Code Details & Refresh */}
      {expiresIn > 0 && !isAuthorized ? (
        <div className="flex items-center gap-2 text-xs text-[#8696a0] mb-2">
          <span>Code expires in</span>
          <span className="font-mono font-semibold text-[#00a884]">
            {Math.floor(expiresIn / 60)}:{(expiresIn % 60).toString().padStart(2, "0")}
          </span>
        </div>
      ) : expiresIn <= 0 && !isAuthorized ? (
        <button
          onClick={initiateSession}
          className="text-xs text-[#00a884] hover:underline font-medium mb-2"
        >
          QR code expired. Click to reload.
        </button>
      ) : null}

      <div className="flex items-center gap-2 text-[11px] text-[#8696a0] mt-4 pt-4 border-t border-[#2a3942] w-full justify-center">
        <Smartphone className="w-3.5 h-3.5" />
        <span>End-to-End Encrypted Multi-Device Protocol</span>
      </div>
    </div>
  );
};

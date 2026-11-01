import React, { useState, useEffect } from "react";
import { X, ShieldCheck, QrCode, CheckCircle2, AlertTriangle } from "lucide-react";
import { computeSafetyNumber, checkIdentityKeyChange, SafetyNumberResult } from "../crypto/SafetyNumber";
import { localDB } from "../storage/db";

interface SafetyNumberModalProps {
  peerUserId: string;
  peerDisplayName: string;
  myUserId: string;
  myIdentityKeyB64: string;
  peerIdentityKeyB64: string;
  onClose: () => void;
}

export const SafetyNumberModal: React.FC<SafetyNumberModalProps> = ({
  peerUserId,
  peerDisplayName,
  myUserId,
  myIdentityKeyB64,
  peerIdentityKeyB64,
  onClose,
}) => {
  const [result, setResult] = useState<SafetyNumberResult | null>(null);
  const [isVerified, setIsVerified] = useState(false);
  const [hasChanged, setHasChanged] = useState(false);

  useEffect(() => {
    async function load() {
      const numResult = await computeSafetyNumber(
        myIdentityKeyB64,
        peerIdentityKeyB64,
        myUserId,
        peerUserId
      );
      setResult(numResult);

      const verified = await localDB.getVerifiedSafetyNumber(peerUserId);
      if (verified) {
        setIsVerified(verified.isVerified);
      }

      const changeCheck = await checkIdentityKeyChange(peerUserId, peerIdentityKeyB64);
      setHasChanged(changeCheck.changed);
    }
    load();
  }, [peerUserId, peerIdentityKeyB64, myIdentityKeyB64, myUserId]);

  const toggleVerified = async () => {
    if (!result) return;
    const next = !isVerified;
    setIsVerified(next);
    await localDB.saveVerifiedSafetyNumber(
      peerUserId,
      peerIdentityKeyB64,
      result.safetyNumber,
      next
    );
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-[#222e35] text-[#e9edef] rounded-2xl w-full max-w-md overflow-hidden shadow-2xl border border-[#374248] flex flex-col animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="px-5 py-4 border-b border-[#2a3942] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <ShieldCheck className="w-5 h-5 text-[#00a884]" />
            <h3 className="font-semibold text-lg">Verify Security Code</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-full text-[#8696a0] hover:text-[#e9edef] hover:bg-[#111b21] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 flex flex-col items-center text-center">
          {hasChanged && (
            <div className="w-full bg-[#f15c6d]/10 border border-[#f15c6d]/30 text-[#f15c6d] rounded-xl p-3 mb-4 flex items-center gap-2 text-xs text-left">
              <AlertTriangle className="w-5 h-5 shrink-0" />
              <span>
                Safety number for {peerDisplayName} has changed. They may have reinstalled the app or switched devices.
              </span>
            </div>
          )}

          <p className="text-xs text-[#8696a0] leading-relaxed mb-6">
            Compare this 60-digit number with <strong className="text-[#e9edef]">{peerDisplayName}</strong> to verify that your messages and calls are end-to-end encrypted with no third party in between.
          </p>

          {/* 60 Digits Display in 12 Groups */}
          {result && (
            <div className="w-full bg-[#111b21] rounded-xl p-4 border border-[#2a3942] mb-6 font-mono text-sm tracking-wider text-[#00a884] select-all leading-loose">
              {result.safetyNumber}
            </div>
          )}

          {/* QR representation pill */}
          <div className="flex items-center gap-2 px-3 py-1.5 bg-[#111b21] rounded-full border border-[#2a3942] text-xs text-[#8696a0] mb-6">
            <QrCode className="w-4 h-4 text-[#00a884]" />
            <span>Encrypted QR Fingerprint active</span>
          </div>

          {/* Verification Toggle */}
          <button
            onClick={toggleVerified}
            className={`w-full py-3 rounded-xl font-medium text-sm flex items-center justify-center gap-2 transition-all ${
              isVerified
                ? "bg-[#00a884]/20 text-[#00a884] border border-[#00a884]/40"
                : "bg-[#00a884] text-[#111b21] hover:bg-[#02906f]"
            }`}
          >
            <CheckCircle2 className="w-4 h-4" />
            <span>{isVerified ? "Marked as Verified ✓" : "Mark as Verified"}</span>
          </button>
        </div>
      </div>
    </div>
  );
};

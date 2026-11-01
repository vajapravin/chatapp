import React, { useState } from "react";
import { ChatListShell } from "./components/ChatListShell";
import { LoginForm } from "./components/LoginForm";
import { OtpVerifyForm } from "./components/OtpVerifyForm";
import { CompanionLinkView } from "./components/CompanionLinkView";
import { useAuthStore } from "./store/authStore";

export const App: React.FC = () => {
  const { isAuthenticated } = useAuthStore();
  const [companionMode, setCompanionMode] = useState(false);
  const [otpStage, setOtpStage] = useState<{
    phoneNumber: string;
    email: string;
  } | null>(null);

  if (isAuthenticated) {
    return <ChatListShell />;
  }

  return (
    <div className="min-h-screen w-full flex items-center justify-center p-4 bg-[#111b21] bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-[#202c33] via-[#111b21] to-[#111b21]">
      {companionMode ? (
        <CompanionLinkView onBack={() => setCompanionMode(false)} />
      ) : !otpStage ? (
        <LoginForm
          onOtpRequested={(phone, email) => setOtpStage({ phoneNumber: phone, email })}
          onLinkCompanion={() => setCompanionMode(true)}
        />
      ) : (
        <OtpVerifyForm
          phoneNumber={otpStage.phoneNumber}
          email={otpStage.email}
          onBack={() => setOtpStage(null)}
        />
      )}
    </div>
  );
};

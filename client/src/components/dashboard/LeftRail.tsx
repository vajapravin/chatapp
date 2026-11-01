import React from "react";
import {
  MessageSquare,
  Hash,
  Phone,
  Shield,
  Settings as SettingsIcon,
  LogOut,
  User as UserIcon,
} from "lucide-react";
import { UserProfile } from "../../store/authStore";

interface LeftRailProps {
  currentTab: "chats" | "channels" | "calls";
  onTabChange: (tab: "chats" | "channels" | "calls") => void;
  user: UserProfile | null;
  unreadChatsCount: number;
  unreadChannelsCount: number;
  missedCallsCount: number;
  isAdmin: boolean;
  onOpenAdmin: () => void;
  onOpenSettings: () => void;
  onLogout: () => void;
}

export const LeftRail: React.FC<LeftRailProps> = ({
  currentTab,
  onTabChange,
  user,
  unreadChatsCount,
  unreadChannelsCount,
  missedCallsCount,
  isAdmin,
  onOpenAdmin,
  onOpenSettings,
  onLogout,
}) => {
  return (
    <div className="w-[72px] min-w-[72px] h-full bg-[#0c1317] border-r border-[#202c33] flex flex-col items-center py-4 select-none shrink-0 z-30">
      {/* App Logo / Brand */}
      <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-[#00a884] to-[#007a60] flex items-center justify-center text-white shadow-lg mb-6 cursor-pointer hover:opacity-90 transition">
        <span className="font-extrabold text-xl tracking-tighter">#c</span>
      </div>

      {/* Primary Navigation Icons */}
      <div className="flex-1 flex flex-col items-center gap-3 w-full px-2">
        {/* Channels Tab */}
        <button
          onClick={() => onTabChange("channels")}
          title="Channels (Ctrl+K)"
          className={`relative w-12 h-12 rounded-2xl flex items-center justify-center transition group ${
            currentTab === "channels"
              ? "bg-[#00a884] text-[#111b21] shadow-lg shadow-[#00a884]/20"
              : "text-[#8696a0] hover:text-white hover:bg-[#202c33]"
          }`}
        >
          <Hash className="w-6 h-6 transition-transform group-hover:scale-105" />
          {unreadChannelsCount > 0 && (
            <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 bg-emerald-400 text-[#111b21] text-[10px] font-bold rounded-full flex items-center justify-center shadow">
              {unreadChannelsCount}
            </span>
          )}
        </button>

        {/* Chats Tab */}
        <button
          onClick={() => onTabChange("chats")}
          title="Direct Chats & Groups"
          className={`relative w-12 h-12 rounded-2xl flex items-center justify-center transition group ${
            currentTab === "chats"
              ? "bg-[#00a884] text-[#111b21] shadow-lg shadow-[#00a884]/20"
              : "text-[#8696a0] hover:text-white hover:bg-[#202c33]"
          }`}
        >
          <MessageSquare className="w-6 h-6 transition-transform group-hover:scale-105" />
          {unreadChatsCount > 0 && (
            <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 bg-[#00a884] text-[#111b21] text-[10px] font-bold rounded-full flex items-center justify-center shadow">
              {unreadChatsCount}
            </span>
          )}
        </button>

        {/* Calls Tab */}
        <button
          onClick={() => onTabChange("calls")}
          title="Voice & Video Calls"
          className={`relative w-12 h-12 rounded-2xl flex items-center justify-center transition group ${
            currentTab === "calls"
              ? "bg-[#00a884] text-[#111b21] shadow-lg shadow-[#00a884]/20"
              : "text-[#8696a0] hover:text-white hover:bg-[#202c33]"
          }`}
        >
          <Phone className="w-5 h-5 transition-transform group-hover:scale-105" />
          {missedCallsCount > 0 && (
            <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center shadow">
              {missedCallsCount}
            </span>
          )}
        </button>

        {/* Admin Console Trigger */}
        {isAdmin && (
          <button
            onClick={onOpenAdmin}
            title="Admin Invites & Moderation"
            className="w-12 h-12 rounded-2xl flex items-center justify-center text-amber-400 hover:text-amber-300 hover:bg-[#202c33] transition group mt-1"
          >
            <Shield className="w-5 h-5 transition-transform group-hover:scale-110" />
          </button>
        )}
      </div>

      {/* User Section & Settings */}
      <div className="flex flex-col items-center gap-3 w-full px-2">
        <button
          onClick={onOpenSettings}
          title="Settings"
          className="w-10 h-10 rounded-xl flex items-center justify-center text-[#8696a0] hover:text-white hover:bg-[#202c33] transition"
        >
          <SettingsIcon className="w-5 h-5" />
        </button>

        <button
          onClick={onLogout}
          title="Sign out"
          className="w-10 h-10 rounded-xl flex items-center justify-center text-[#8696a0] hover:text-red-400 hover:bg-[#202c33] transition"
        >
          <LogOut className="w-5 h-5" />
        </button>

        <div
          title={user?.display_name || user?.email || "Account Profile"}
          className="relative w-10 h-10 rounded-full bg-[#202c33] border border-[#2a3942] flex items-center justify-center text-sm font-bold text-white shadow cursor-pointer mt-1"
        >
          {user?.avatar_url ? (
            <img src={user.avatar_url} alt="Avatar" className="w-full h-full rounded-full object-cover" />
          ) : user?.display_name ? (
            user.display_name.charAt(0).toUpperCase()
          ) : (
            <UserIcon className="w-4 h-4 text-[#8696a0]" />
          )}
          <span className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-[#00a884] border-2 border-[#0c1317] rounded-full" />
        </div>
      </div>
    </div>
  );
};

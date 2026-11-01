import { create } from "zustand";
import { localDB } from "../storage/db";

const API_BASE = (import.meta as any).env?.VITE_API_BASE || "";

export interface PrivacySettings {
  last_seen: "everyone" | "contacts" | "nobody";
  online: "everyone" | "same_as_last_seen";
  profile_photo: "everyone" | "contacts" | "nobody";
  about: "everyone" | "contacts" | "nobody";
  read_receipts: boolean;
  add_to_groups: "everyone" | "contacts" | "contacts_except" | "nobody";
  silence_unknown_callers: boolean;
}

export interface BlockedUserItem {
  id: string;
  user_id: string;
  blocked_user_id: string;
  display_name?: string;
  phone_number: string;
  created_at: string;
}

export interface AppLockConfig {
  enabled: boolean;
  isLocked: boolean;
  timeoutMinutes: number; // 0=immediately, 1, 5, 15
  pin: string | null;
  lastActive: number;
}

interface PrivacyState {
  privacySettings: PrivacySettings;
  blockedUsers: BlockedUserItem[];
  appLock: AppLockConfig;
  lockedChatIds: string[];
  isLockedChatsFolderOpen: boolean;

  loadPrivacySettings: () => Promise<void>;
  updatePrivacySettings: (updated: Partial<PrivacySettings>) => Promise<void>;
  loadBlockedUsers: () => Promise<void>;
  blockUser: (targetUserId: string) => Promise<void>;
  unblockUser: (targetUserId: string) => Promise<void>;

  loadAppLockConfig: () => Promise<void>;
  configureAppLock: (enabled: boolean, pin?: string, timeout?: number) => Promise<void>;
  unlockApp: (inputPin: string) => boolean;
  lockApp: () => void;
  recordActivity: () => void;

  loadLockedChats: () => Promise<void>;
  lockChat: (chatId: string) => Promise<void>;
  unlockChat: (chatId: string) => Promise<void>;
  setLockedChatsFolderOpen: (open: boolean) => void;
}

function getAuthToken(): string | null {
  try {
    const raw = localStorage.getItem("chatapp_auth");
    if (raw) return JSON.parse(raw).accessToken;
  } catch {}
  return null;
}

export const usePrivacyStore = create<PrivacyState>((set, get) => ({
  privacySettings: {
    last_seen: "everyone",
    online: "everyone",
    profile_photo: "everyone",
    about: "everyone",
    read_receipts: true,
    add_to_groups: "everyone",
    silence_unknown_callers: false,
  },
  blockedUsers: [],
  appLock: {
    enabled: false,
    isLocked: false,
    timeoutMinutes: 0,
    pin: null,
    lastActive: Date.now(),
  },
  lockedChatIds: [],
  isLockedChatsFolderOpen: false,

  loadPrivacySettings: async () => {
    const token = getAuthToken();
    if (!token) return;
    try {
      const res = await fetch(`${API_BASE}/v1/privacy/settings`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        set({ privacySettings: data });
      }
    } catch (err) {
      console.error("Failed to load privacy settings:", err);
    }
  },

  updatePrivacySettings: async (updated: Partial<PrivacySettings>) => {
    const token = getAuthToken();
    if (!token) return;
    const current = get().privacySettings;
    const next = { ...current, ...updated };
    set({ privacySettings: next });

    try {
      await fetch(`${API_BASE}/v1/privacy/settings`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(next),
      });
    } catch (err) {
      console.error("Failed to update privacy settings:", err);
    }
  },

  loadBlockedUsers: async () => {
    const token = getAuthToken();
    if (!token) return;
    try {
      const res = await fetch(`${API_BASE}/v1/users/blocks`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        set({ blockedUsers: data });
      }
    } catch (err) {
      console.error("Failed to load blocked users:", err);
    }
  },

  blockUser: async (targetUserId: string) => {
    const token = getAuthToken();
    if (!token) return;
    try {
      await fetch(`${API_BASE}/v1/users/blocks/${targetUserId}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      await get().loadBlockedUsers();
    } catch (err) {
      console.error("Failed to block user:", err);
    }
  },

  unblockUser: async (targetUserId: string) => {
    const token = getAuthToken();
    if (!token) return;
    try {
      await fetch(`${API_BASE}/v1/users/blocks/${targetUserId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      await get().loadBlockedUsers();
    } catch (err) {
      console.error("Failed to unblock user:", err);
    }
  },

  loadAppLockConfig: async () => {
    const config = await localDB.getSecuritySetting("app_lock");
    if (config) {
      set({
        appLock: {
          ...config,
          isLocked: config.enabled, // Lock on initial load if enabled
          lastActive: Date.now(),
        },
      });
    }
  },

  configureAppLock: async (enabled: boolean, pin?: string, timeout?: number) => {
    const current = get().appLock;
    const nextConfig = {
      enabled,
      isLocked: false,
      pin: pin !== undefined ? pin : current.pin,
      timeoutMinutes: timeout !== undefined ? timeout : current.timeoutMinutes,
      lastActive: Date.now(),
    };
    set({ appLock: nextConfig });
    await localDB.saveSecuritySetting("app_lock", nextConfig);
  },

  unlockApp: (inputPin: string) => {
    const current = get().appLock;
    if (!current.enabled || inputPin === current.pin) {
      set({
        appLock: {
          ...current,
          isLocked: false,
          lastActive: Date.now(),
        },
      });
      return true;
    }
    return false;
  },

  lockApp: () => {
    const current = get().appLock;
    if (current.enabled) {
      set({ appLock: { ...current, isLocked: true } });
    }
  },

  recordActivity: () => {
    const current = get().appLock;
    if (!current.enabled || current.isLocked) return;

    const now = Date.now();
    if (current.timeoutMinutes > 0) {
      const elapsedMinutes = (now - current.lastActive) / 60000;
      if (elapsedMinutes >= current.timeoutMinutes) {
        set({ appLock: { ...current, isLocked: true } });
        return;
      }
    }
    set({ appLock: { ...current, lastActive: now } });
  },

  loadLockedChats: async () => {
    const lockedIds = await localDB.getLockedChatIds();
    set({ lockedChatIds: lockedIds });
  },

  lockChat: async (chatId: string) => {
    await localDB.lockChat(chatId);
    const lockedIds = await localDB.getLockedChatIds();
    set({ lockedChatIds: lockedIds });
  },

  unlockChat: async (chatId: string) => {
    await localDB.unlockChat(chatId);
    const lockedIds = await localDB.getLockedChatIds();
    set({ lockedChatIds: lockedIds });
  },

  setLockedChatsFolderOpen: (open: boolean) => {
    set({ isLockedChatsFolderOpen: open });
  },
}));

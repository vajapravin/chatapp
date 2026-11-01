import { create } from "zustand";

export interface UserProfile {
  id: string;
  phone_number?: string | null;
  email: string | null;
  display_name: string | null;
  avatar_url: string | null;
  role?: string;
  status?: string;
  created_at?: string;
}

interface AuthState {
  accessToken: string | null;
  refreshToken: string | null;
  userId: string | null;
  deviceId: number | null;
  user: UserProfile | null;
  isAuthenticated: boolean;
  setAuth: (params: {
    accessToken: string;
    refreshToken: string;
    userId: string;
    deviceId: number;
  }) => void;
  setUser: (user: UserProfile) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>((set) => {
  const storedAccess = localStorage.getItem("chatapp_access_token");
  const storedRefresh = localStorage.getItem("chatapp_refresh_token");
  const storedUserId = localStorage.getItem("chatapp_user_id");
  const storedDeviceId = localStorage.getItem("chatapp_device_id");

  return {
    accessToken: storedAccess,
    refreshToken: storedRefresh,
    userId: storedUserId,
    deviceId: storedDeviceId ? parseInt(storedDeviceId, 10) : null,
    user: null,
    isAuthenticated: !!storedAccess,

    setAuth: ({ accessToken, refreshToken, userId, deviceId }) => {
      localStorage.setItem("chatapp_access_token", accessToken);
      localStorage.setItem("chatapp_refresh_token", refreshToken);
      localStorage.setItem("chatapp_user_id", userId);
      localStorage.setItem("chatapp_device_id", deviceId.toString());

      set({
        accessToken,
        refreshToken,
        userId,
        deviceId,
        isAuthenticated: true,
      });
    },

    setUser: (user) => set({ user }),

    logout: () => {
      localStorage.removeItem("chatapp_access_token");
      localStorage.removeItem("chatapp_refresh_token");
      localStorage.removeItem("chatapp_user_id");
      localStorage.removeItem("chatapp_device_id");

      set({
        accessToken: null,
        refreshToken: null,
        userId: null,
        deviceId: null,
        user: null,
        isAuthenticated: false,
      });
    },
  };
});

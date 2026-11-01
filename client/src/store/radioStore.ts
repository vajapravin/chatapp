import { create } from "zustand";

export interface QueueItem {
  id: string;
  position: number;
  video_id: string;
  title: string;
  artist: string;
  duration_ms: number;
  thumb_url: string | null;
  source: string;
}

export interface RadioStateData {
  channel_id: string;
  status: "playing" | "paused" | "stopped";
  track_id: string | null;
  started_at: number | null;
  paused_at: number | null;
  repeat_mode: string;
  shuffle: boolean;
  queue_version: number;
  current_track: QueueItem | null;
  queue: QueueItem[];
}

interface RadioStoreState {
  radioData: Record<string, RadioStateData>;
  isTunedIn: boolean;
  volume: number;
  isMuted: boolean;
  clockOffsetMs: number; // local_now - server_now

  setTunedIn: (tuned: boolean) => void;
  setVolume: (vol: number) => void;
  setMuted: (muted: boolean) => void;
  setRadioState: (channelId: string, data: RadioStateData) => void;

  syncClockOffset: () => Promise<number>;
  fetchRadioState: (channelId: string) => Promise<RadioStateData | null>;
  onAir: (channelId: string) => Promise<void>;
  offAir: (channelId: string) => Promise<void>;
  play: (channelId: string) => Promise<void>;
  pause: (channelId: string) => Promise<void>;
  skip: (channelId: string) => Promise<void>;
  previous: (channelId: string) => Promise<void>;
  seek: (channelId: string, positionMs: number) => Promise<void>;
  addToQueue: (channelId: string, track: { video_id: string; title: string; artist: string; duration_ms: number; thumb_url?: string }) => Promise<void>;
  removeFromQueue: (channelId: string, itemId: string) => Promise<void>;
  playQueueItem: (channelId: string, itemId: string) => Promise<void>;
  reorderQueue: (channelId: string, itemIds: string[]) => Promise<void>;
  moveQueueItem: (channelId: string, itemId: string, direction: "up" | "down") => Promise<void>;
  toggleShuffle: (channelId: string) => Promise<void>;
  toggleRepeat: (channelId: string, mode?: string) => Promise<void>;
}

const getAuthToken = () => localStorage.getItem("chatapp_access_token") || "";

export const useRadioStore = create<RadioStoreState>((set, get) => ({
  radioData: {},
  isTunedIn: false,
  volume: 80,
  isMuted: false,
  clockOffsetMs: 0,

  setTunedIn: (isTunedIn) => set({ isTunedIn }),
  setVolume: (volume) => set({ volume }),
  setMuted: (isMuted) => set({ isMuted }),
  setRadioState: (channelId, data) =>
    set((state) => ({
      radioData: { ...state.radioData, [channelId]: data },
    })),

  // NTP 3-roundtrip clock offset calculator
  syncClockOffset: async () => {
    let lowestRtt = Infinity;
    let bestOffset = 0;

    for (let i = 0; i < 3; i++) {
      const t0 = Date.now();
      try {
        const res = await fetch("/v1/time");
        const t1 = Date.now();
        if (res.ok) {
          const data = await res.json();
          const serverTime = data.server_time_ms;
          const rtt = t1 - t0;
          if (rtt < lowestRtt) {
            lowestRtt = rtt;
            // offset = local - (server + rtt/2)
            bestOffset = Math.round((t0 + t1) / 2 - serverTime);
          }
        }
      } catch (err) {
        console.warn("NTP sync probe failed:", err);
      }
    }

    set({ clockOffsetMs: bestOffset });
    return bestOffset;
  },

  fetchRadioState: async (channelId: string) => {
    const token = getAuthToken();
    if (!token) return null;
    try {
      const res = await fetch(`/v1/channels/${channelId}/radio`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        get().setRadioState(channelId, data);
        return data;
      }
    } catch (err) {
      console.error("Failed to fetch radio state:", err);
    }
    return null;
  },

  onAir: async (channelId: string) => {
    const token = getAuthToken();
    if (!token) return;
    const res = await fetch(`/v1/channels/${channelId}/radio:onair`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      const data = await res.json();
      get().setRadioState(channelId, data);
      set({ isTunedIn: true });
    }
  },

  offAir: async (channelId: string) => {
    const token = getAuthToken();
    if (!token) return;
    const res = await fetch(`/v1/channels/${channelId}/radio:offair`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      const data = await res.json();
      get().setRadioState(channelId, data);
      set({ isTunedIn: false });
    }
  },

  play: async (channelId: string) => {
    const token = getAuthToken();
    if (!token) return;
    const res = await fetch(`/v1/channels/${channelId}/radio:play`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      const data = await res.json();
      get().setRadioState(channelId, data);
    }
  },

  pause: async (channelId: string) => {
    const token = getAuthToken();
    if (!token) return;
    const res = await fetch(`/v1/channels/${channelId}/radio:pause`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      const data = await res.json();
      get().setRadioState(channelId, data);
    }
  },

  skip: async (channelId: string) => {
    const token = getAuthToken();
    if (!token) return;
    const res = await fetch(`/v1/channels/${channelId}/radio:skip`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      const data = await res.json();
      get().setRadioState(channelId, data);
    }
  },

  previous: async (channelId: string) => {
    const token = getAuthToken();
    if (!token) return;
    const res = await fetch(`/v1/channels/${channelId}/radio:previous`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      const data = await res.json();
      get().setRadioState(channelId, data);
    }
  },

  seek: async (channelId: string, positionMs: number) => {
    const token = getAuthToken();
    if (!token) return;
    const res = await fetch(`/v1/channels/${channelId}/radio:seek`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ position_ms: positionMs }),
    });
    if (res.ok) {
      const data = await res.json();
      get().setRadioState(channelId, data);
    }
  },

  addToQueue: async (channelId: string, track) => {
    const token = getAuthToken();
    if (!token) return;
    const res = await fetch(`/v1/channels/${channelId}/radio/queue/items`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(track),
    });
    if (res.ok) {
      const data = await res.json();
      get().setRadioState(channelId, data);
    }
  },

  removeFromQueue: async (channelId: string, itemId: string) => {
    const token = getAuthToken();
    if (!token) return;
    try {
      const res = await fetch(`/v1/channels/${channelId}/radio/queue/${itemId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        get().setRadioState(channelId, data);
      }
    } catch (err) {
      console.error("Failed to remove item from queue:", err);
    }
  },

  playQueueItem: async (channelId: string, itemId: string) => {
    const token = getAuthToken();
    if (!token) return;
    try {
      const res = await fetch(`/v1/channels/${channelId}/radio/queue/${itemId}:play`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        get().setRadioState(channelId, data);
      }
    } catch (err) {
      console.error("Failed to play queue item:", err);
    }
  },

  reorderQueue: async (channelId: string, itemIds: string[]) => {
    const token = getAuthToken();
    if (!token) return;
    try {
      const res = await fetch(`/v1/channels/${channelId}/radio/queue`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ item_ids: itemIds }),
      });
      if (res.ok) {
        const data = await res.json();
        get().setRadioState(channelId, data);
      }
    } catch (err) {
      console.error("Failed to reorder queue:", err);
    }
  },

  moveQueueItem: async (channelId: string, itemId: string, direction: "up" | "down") => {
    const token = getAuthToken();
    if (!token) return;
    try {
      const res = await fetch(`/v1/channels/${channelId}/radio/queue/${itemId}:move`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ direction }),
      });
      if (res.ok) {
        const data = await res.json();
        get().setRadioState(channelId, data);
      }
    } catch (err) {
      console.error("Failed to move queue item:", err);
    }
  },

  toggleShuffle: async (channelId: string) => {
    const token = getAuthToken();
    if (!token) return;
    try {
      const res = await fetch(`/v1/channels/${channelId}/radio:shuffle`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        get().setRadioState(channelId, data);
      }
    } catch (err) {
      console.error("Failed to toggle shuffle:", err);
    }
  },

  toggleRepeat: async (channelId: string, mode?: string) => {
    const token = getAuthToken();
    if (!token) return;
    try {
      const res = await fetch(`/v1/channels/${channelId}/radio:repeat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ mode: mode || null }),
      });
      if (res.ok) {
        const data = await res.json();
        get().setRadioState(channelId, data);
      }
    } catch (err) {
      console.error("Failed to toggle repeat:", err);
    }
  },
}));

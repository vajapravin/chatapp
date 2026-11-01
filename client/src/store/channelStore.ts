import { create } from "zustand";

export interface ChannelItem {
  id: string;
  owner_id: string;
  name: string;
  topic: string | null;
  icon_ref: string | null;
  radio_enabled: boolean;
  members_can_invite: boolean;
  history_handover: boolean;
  retention_days: number | null;
  archived_at: string | null;
  created_at: string;
  member_count: number;
  current_user_role: "owner" | "admin" | "member";
  unread_count?: number;
}

export interface ChannelMemberItem {
  user_id: string;
  email: string | null;
  display_name: string | null;
  role: "owner" | "admin" | "member";
  joined_at: string;
}

export interface ChannelInviteItem {
  id: string;
  channel_id: string;
  channel_name: string;
  channel_topic: string | null;
  invited_by_name: string | null;
  created_at: string;
  expires_at: string;
}

export interface ChannelPostItem {
  id: string;
  channel_id: string;
  sender_user: string;
  sender_display_name?: string;
  ciphertext: string;
  content_text?: string;
  created_at: number;
  edited_at?: number;
  reactions?: Record<string, string[]>;
  snippet?: {
    title: string;
    language: string;
    blob_id: string;
  };
}

interface ChannelState {
  channels: ChannelItem[];
  activeChannelId: string | null;
  activeChannelMembers: ChannelMemberItem[];
  pendingInvites: ChannelInviteItem[];
  posts: Record<string, ChannelPostItem[]>;
  loading: boolean;
  error: string | null;

  setChannels: (channels: ChannelItem[]) => void;
  setActiveChannelId: (id: string | null) => void;
  setActiveChannelMembers: (members: ChannelMemberItem[]) => void;
  setPendingInvites: (invites: ChannelInviteItem[]) => void;
  addPost: (channelId: string, post: ChannelPostItem) => void;
  setPosts: (channelId: string, posts: ChannelPostItem[]) => void;

  loadChannels: () => Promise<void>;
  loadChannelMembers: (channelId: string) => Promise<void>;
  loadPendingInvites: () => Promise<void>;
  createChannel: (name: string, topic?: string) => Promise<ChannelItem | null>;
  acceptInvite: (inviteId: string) => Promise<void>;
  declineInvite: (inviteId: string) => Promise<void>;
  loadPosts: (channelId: string) => Promise<void>;
  createPost: (channelId: string, ciphertext: string) => Promise<ChannelPostItem | null>;
  deletePost: (channelId: string, postId: string) => Promise<void>;
}

const getAuthToken = () => {
  const stored = localStorage.getItem("chatapp_access_token");
  return stored || "";
};

export const useChannelStore = create<ChannelState>((set, get) => ({
  channels: [],
  activeChannelId: null,
  activeChannelMembers: [],
  pendingInvites: [],
  posts: {},
  loading: false,
  error: null,

  setChannels: (channels) => set({ channels }),
  setActiveChannelId: (activeChannelId) => set({ activeChannelId }),
  setActiveChannelMembers: (activeChannelMembers) => set({ activeChannelMembers }),
  setPendingInvites: (pendingInvites) => set({ pendingInvites }),

  addPost: (channelId, post) =>
    set((state) => ({
      posts: {
        ...state.posts,
        [channelId]: [...(state.posts[channelId] || []), post],
      },
    })),

  setPosts: (channelId, posts) =>
    set((state) => ({
      posts: {
        ...state.posts,
        [channelId]: posts,
      },
    })),

  loadChannels: async () => {
    const token = getAuthToken();
    if (!token) return;
    try {
      const res = await fetch("/v1/channels", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const channels = await res.json();
        set({ channels });
        if (!get().activeChannelId && channels.length > 0) {
          set({ activeChannelId: channels[0].id });
        }
      }
    } catch (err: any) {
      console.error("Failed to fetch channels:", err);
    }
  },

  loadChannelMembers: async (channelId: string) => {
    const token = getAuthToken();
    if (!token) return;
    try {
      const res = await fetch(`/v1/channels/${channelId}/members`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        set({ activeChannelMembers: await res.json() });
      }
    } catch (err: any) {
      console.error("Failed to load channel members:", err);
    }
  },

  loadPendingInvites: async () => {
    const token = getAuthToken();
    if (!token) return;
    try {
      const res = await fetch("/v1/channel-invites", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        set({ pendingInvites: await res.json() });
      }
    } catch (err: any) {
      console.error("Failed to load pending channel invites:", err);
    }
  },

  createChannel: async (name: string, topic?: string) => {
    const token = getAuthToken();
    if (!token) return null;
    try {
      const res = await fetch("/v1/channels", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ name, topic }),
      });
      if (res.ok) {
        const newChan = await res.json();
        set((state) => ({
          channels: [newChan, ...state.channels],
          activeChannelId: newChan.id,
        }));
        return newChan;
      }
    } catch (err: any) {
      console.error("Failed to create channel:", err);
    }
    return null;
  },

  acceptInvite: async (inviteId: string) => {
    const token = getAuthToken();
    if (!token) return;
    try {
      const res = await fetch(`/v1/channel-invites/${inviteId}:accept`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        await get().loadChannels();
        await get().loadPendingInvites();
        set({ activeChannelId: data.channel_id });
      }
    } catch (err: any) {
      console.error("Failed to accept channel invite:", err);
    }
  },

  declineInvite: async (inviteId: string) => {
    const token = getAuthToken();
    if (!token) return;
    try {
      const res = await fetch(`/v1/channel-invites/${inviteId}:decline`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        await get().loadPendingInvites();
      }
    } catch (err: any) {
      console.error("Failed to decline channel invite:", err);
    }
  },

  loadPosts: async (channelId: string) => {
    const token = getAuthToken();
    if (!token) return;
    try {
      const res = await fetch(`/v1/channels/${channelId}/posts`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        const mapped: ChannelPostItem[] = data.map((p: any) => ({
          id: p.id,
          channel_id: p.channel_id,
          sender_user: p.sender_user,
          sender_display_name: p.sender_display_name,
          ciphertext: p.ciphertext,
          created_at: new Date(p.created_at).getTime(),
          edited_at: p.edited_at ? new Date(p.edited_at).getTime() : undefined,
        }));
        get().setPosts(channelId, mapped);
      }
    } catch (err: any) {
      console.error("Failed to load channel posts:", err);
    }
  },

  createPost: async (channelId: string, ciphertext: string) => {
    const token = getAuthToken();
    if (!token) return null;
    try {
      const res = await fetch(`/v1/channels/${channelId}/posts`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ ciphertext }),
      });
      if (res.ok) {
        const p = await res.json();
        const item: ChannelPostItem = {
          id: p.id,
          channel_id: p.channel_id,
          sender_user: p.sender_user,
          sender_display_name: p.sender_display_name,
          ciphertext: p.ciphertext,
          created_at: new Date(p.created_at).getTime(),
          edited_at: p.edited_at ? new Date(p.edited_at).getTime() : undefined,
        };
        get().addPost(channelId, item);
        return item;
      }
    } catch (err: any) {
      console.error("Failed to create channel post:", err);
    }
    return null;
  },

  deletePost: async (channelId: string, postId: string) => {
    const token = getAuthToken();
    if (!token) return;
    try {
      const res = await fetch(`/v1/channels/${channelId}/posts/${postId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        set((state) => ({
          posts: {
            ...state.posts,
            [channelId]: (state.posts[channelId] || []).filter((p) => p.id !== postId),
          },
        }));
      }
    } catch (err: any) {
      console.error("Failed to delete channel post:", err);
    }
  },
}));

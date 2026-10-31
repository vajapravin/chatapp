import { create } from "zustand";
import { ChatItem, localDB, MessageItem } from "../storage/db";

interface ChatState {
  chats: ChatItem[];
  activeChatId: string | null;
  messages: Record<string, MessageItem[]>;
  presence: Record<string, { isOnline: boolean; lastSeen?: number }>;
  peerTyping: Record<string, boolean>;

  loadInitialData: () => Promise<void>;
  setActiveChat: (chatId: string | null) => void;
  addOrUpdateChat: (chat: ChatItem) => Promise<void>;
  addMessage: (msg: MessageItem) => Promise<void>;
  updateMessage: (chatId: string, msgId: string, updates: Partial<MessageItem>) => Promise<void>;
  updateMessageStatusByEnvelopeId: (
    envelopeId: string,
    status: MessageItem["status"]
  ) => Promise<void>;
  updateMessageStatusById: (
    chatId: string,
    msgId: string,
    status: MessageItem["status"]
  ) => Promise<void>;
  setPresence: (userId: string, isOnline: boolean, lastSeen?: number) => void;
  setPeerTyping: (chatId: string, isTyping: boolean) => void;
  markChatAsRead: (chatId: string) => Promise<void>;
}

export const useChatStore = create<ChatState>((set, get) => ({
  chats: [],
  activeChatId: null,
  messages: {},
  presence: {},
  peerTyping: {},

  loadInitialData: async () => {
    const chats = await localDB.getAllChats();
    const messages: Record<string, MessageItem[]> = {};

    for (const chat of chats) {
      messages[chat.id] = await localDB.getMessagesForChat(chat.id);
    }

    set({ chats, messages });
  },

  setActiveChat: (chatId: string | null) => {
    set({ activeChatId: chatId });
    if (chatId) {
      get().markChatAsRead(chatId);
    }
  },

  addOrUpdateChat: async (chat: ChatItem) => {
    await localDB.saveChat(chat);
    set((state) => {
      const existingIdx = state.chats.findIndex((c) => c.id === chat.id);
      let updatedChats: ChatItem[];
      if (existingIdx >= 0) {
        updatedChats = [...state.chats];
        updatedChats[existingIdx] = { ...updatedChats[existingIdx], ...chat };
      } else {
        updatedChats = [chat, ...state.chats];
      }
      updatedChats.sort((a, b) => b.lastMessageTimestamp - a.lastMessageTimestamp);
      return { chats: updatedChats };
    });
  },

  addMessage: async (msg: MessageItem) => {
    await localDB.saveMessage(msg);
    set((state) => {
      const currentList = state.messages[msg.chatId] || [];
      const updatedList = [...currentList, msg];
      return {
        messages: {
          ...state.messages,
          [msg.chatId]: updatedList,
        },
      };
    });
  },

  updateMessage: async (chatId: string, msgId: string, updates: Partial<MessageItem>) => {
    const list = get().messages[chatId] || [];
    const target = list.find((m) => m.id === msgId);
    if (!target) return;

    const updated = { ...target, ...updates };
    await localDB.saveMessage(updated);

    set((state) => {
      const chatMsgs = state.messages[chatId] || [];
      return {
        messages: {
          ...state.messages,
          [chatId]: chatMsgs.map((m) => (m.id === msgId ? updated : m)),
        },
      };
    });
  },

  updateMessageStatusByEnvelopeId: async (
    envelopeId: string,
    status: MessageItem["status"]
  ) => {
    const allMessages = get().messages;
    for (const chatId of Object.keys(allMessages)) {
      const msgs = allMessages[chatId];
      const match = msgs.find((m) => m.envelopeId === envelopeId);
      if (match) {
        await get().updateMessage(chatId, match.id, { status });
        break;
      }
    }
  },

  updateMessageStatusById: async (
    chatId: string,
    msgId: string,
    status: MessageItem["status"]
  ) => {
    await get().updateMessage(chatId, msgId, { status });
  },

  setPresence: (userId: string, isOnline: boolean, lastSeen?: number) => {
    set((state) => ({
      presence: {
        ...state.presence,
        [userId]: { isOnline, lastSeen },
      },
    }));
  },

  setPeerTyping: (chatId: string, isTyping: boolean) => {
    set((state) => ({
      peerTyping: {
        ...state.peerTyping,
        [chatId]: isTyping,
      },
    }));
  },

  markChatAsRead: async (chatId: string) => {
    const chats = get().chats;
    const chat = chats.find((c) => c.id === chatId);
    if (chat && chat.unreadCount > 0) {
      const updated = { ...chat, unreadCount: 0 };
      await localDB.saveChat(updated);
      set((state) => ({
        chats: state.chats.map((c) => (c.id === chatId ? updated : c)),
      }));
    }
  },
}));

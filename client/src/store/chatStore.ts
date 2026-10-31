import { create } from "zustand";
import { ChatItem, localDB, MessageItem, PollOption } from "../storage/db";

interface ChatState {
  chats: ChatItem[];
  activeChatId: string | null;
  messages: Record<string, MessageItem[]>;
  presence: Record<string, { isOnline: boolean; lastSeen?: number }>;
  peerTyping: Record<string, boolean>;

  loadInitialData: () => Promise<void>;
  setActiveChat: (chatId: string | null) => void;
  addOrUpdateChat: (chat: ChatItem) => Promise<void>;
  deleteChat: (chatId: string) => Promise<void>;
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

  // Phase 3 Rich Messaging Actions
  votePoll: (chatId: string, messageId: string, optionId: string, voterUserId: string) => Promise<void>;
  togglePinMessage: (chatId: string, messageId: string) => Promise<void>;
  toggleStarMessage: (chatId: string, messageId: string) => Promise<void>;
  openViewOnceMessage: (chatId: string, messageId: string) => Promise<void>;
  setDisappearingMode: (chatId: string, seconds: number) => Promise<void>;
}

export const useChatStore = create<ChatState>((set, get) => ({
  chats: [],
  activeChatId: null,
  messages: {},
  presence: {},
  peerTyping: {},

  loadInitialData: async () => {
    await localDB.purgeExpiredMessages();
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

  deleteChat: async (chatId: string) => {
    await localDB.deleteChat(chatId);
    set((state) => {
      const updatedChats = state.chats.filter((c) => c.id !== chatId);
      const updatedMessages = { ...state.messages };
      delete updatedMessages[chatId];
      return {
        chats: updatedChats,
        messages: updatedMessages,
        activeChatId: state.activeChatId === chatId ? null : state.activeChatId,
      };
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
    for (const [chatId, msgs] of Object.entries(allMessages)) {
      const target = msgs.find((m) => m.envelopeId === envelopeId || m.id === envelopeId);
      if (target) {
        await get().updateMessage(chatId, target.id, { status });
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
    const chat = get().chats.find((c) => c.id === chatId);
    if (chat && chat.unreadCount > 0) {
      await get().addOrUpdateChat({ ...chat, unreadCount: 0 });
    }
  },

  // Rich message actions
  votePoll: async (chatId: string, messageId: string, optionId: string, voterUserId: string) => {
    const msgs = get().messages[chatId] || [];
    const msg = msgs.find((m) => m.id === messageId);
    if (!msg || !msg.poll) return;

    const allowMultiple = msg.poll.allowMultiple;
    const updatedOptions: PollOption[] = msg.poll.options.map((opt) => {
      let votes = [...opt.votes];
      if (opt.id === optionId) {
        if (votes.includes(voterUserId)) {
          votes = votes.filter((v) => v !== voterUserId);
        } else {
          votes.push(voterUserId);
        }
      } else if (!allowMultiple) {
        votes = votes.filter((v) => v !== voterUserId);
      }
      return { ...opt, votes };
    });

    const updatedPoll = { ...msg.poll, options: updatedOptions };
    await get().updateMessage(chatId, messageId, { poll: updatedPoll });
  },

  togglePinMessage: async (chatId: string, messageId: string) => {
    const msgs = get().messages[chatId] || [];
    const msg = msgs.find((m) => m.id === messageId);
    if (!msg) return;

    const newPinned = !msg.isPinned;
    await get().updateMessage(chatId, messageId, { isPinned: newPinned });
  },

  toggleStarMessage: async (chatId: string, messageId: string) => {
    const msgs = get().messages[chatId] || [];
    const msg = msgs.find((m) => m.id === messageId);
    if (!msg) return;

    const newStarred = !msg.isStarred;
    await get().updateMessage(chatId, messageId, { isStarred: newStarred });
  },

  openViewOnceMessage: async (chatId: string, messageId: string) => {
    await get().updateMessage(chatId, messageId, { viewed: true });
  },

  setDisappearingMode: async (chatId: string, seconds: number) => {
    const chat = get().chats.find((c) => c.id === chatId);
    if (chat) {
      await get().addOrUpdateChat({ ...chat, disappearingMode: seconds });
    }
  },
}));

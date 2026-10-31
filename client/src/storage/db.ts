export interface ChatItem {
  id: string; // peer user id
  peerUserId: string;
  peerDisplayName?: string;
  peerPhoneNumber: string;
  peerAvatarUrl?: string;
  lastMessageText: string;
  lastMessageTimestamp: number;
  unreadCount: number;
}

export interface MessageItem {
  id: string; // ULID
  envelopeId?: string;
  chatId: string; // peer user ID
  senderId: string;
  senderDeviceId: number;
  recipientId: string;
  recipientDeviceId: number;
  text: string;
  timestamp: number;
  status: "pending" | "sent" | "delivered" | "read" | "failed";
  replyTo?: {
    id: string;
    text: string;
    senderId: string;
  };
  reactions?: Record<string, string>; // userId -> emoji
  isEdited?: boolean;
  editedAt?: number;
  isDeleted?: boolean;
}

class LocalDB {
  private dbPromise: Promise<IDBDatabase> | null = null;

  constructor() {
    if (typeof indexedDB !== "undefined") {
      this.dbPromise = this.openDB();
    }
  }

  private openDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open("chatapp_local_v1", 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains("chats")) {
          db.createObjectStore("chats", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("messages")) {
          const msgStore = db.createObjectStore("messages", { keyPath: "id" });
          msgStore.createIndex("chatId", "chatId", { unique: false });
          msgStore.createIndex("timestamp", "timestamp", { unique: false });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async getAllChats(): Promise<ChatItem[]> {
    if (!this.dbPromise) return [];
    const db = await this.dbPromise;
    return new Promise((resolve) => {
      const tx = db.transaction("chats", "readonly");
      const store = tx.objectStore("chats");
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    });
  }

  async saveChat(chat: ChatItem): Promise<void> {
    if (!this.dbPromise) return;
    const db = await this.dbPromise;
    return new Promise((resolve) => {
      const tx = db.transaction("chats", "readwrite");
      const store = tx.objectStore("chats");
      store.put(chat);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  }

  async getMessagesForChat(chatId: string): Promise<MessageItem[]> {
    if (!this.dbPromise) return [];
    const db = await this.dbPromise;
    return new Promise((resolve) => {
      const tx = db.transaction("messages", "readonly");
      const store = tx.objectStore("messages");
      const index = store.index("chatId");
      const req = index.getAll(chatId);
      req.onsuccess = () => {
        const msgs: MessageItem[] = req.result || [];
        msgs.sort((a, b) => a.timestamp - b.timestamp);
        resolve(msgs);
      };
      req.onerror = () => resolve([]);
    });
  }

  async saveMessage(msg: MessageItem): Promise<void> {
    if (!this.dbPromise) return;
    const db = await this.dbPromise;
    return new Promise((resolve) => {
      const tx = db.transaction("messages", "readwrite");
      const store = tx.objectStore("messages");
      store.put(msg);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  }

  async updateMessageStatus(msgId: string, status: MessageItem["status"]): Promise<void> {
    if (!this.dbPromise) return;
    const db = await this.dbPromise;
    return new Promise((resolve) => {
      const tx = db.transaction("messages", "readwrite");
      const store = tx.objectStore("messages");
      const req = store.get(msgId);
      req.onsuccess = () => {
        const msg = req.result as MessageItem;
        if (msg) {
          msg.status = status;
          store.put(msg);
        }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  }
}

export const localDB = new LocalDB();

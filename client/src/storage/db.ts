export interface PollOption {
  id: string;
  text: string;
  votes: string[]; // user IDs who voted for this option
}

export interface PollData {
  id: string;
  question: string;
  options: PollOption[];
  allowMultiple: boolean;
}

export interface LocationData {
  latitude: number;
  longitude: number;
  name?: string;
  address?: string;
}

export interface ContactData {
  name: string;
  phoneNumber: string;
  vcard?: string;
}

export interface EventData {
  title: string;
  description?: string;
  startTime: number;
  endTime?: number;
  location?: string;
}

export interface ChatItem {
  id: string; // peer user id OR group id
  peerUserId: string; // peer user ID or group creator ID
  peerDisplayName?: string; // peer name or group name
  peerPhoneNumber: string;
  peerAvatarUrl?: string;
  lastMessageText: string;
  lastMessageTimestamp: number;
  unreadCount: number;
  // Group properties
  isGroup?: boolean;
  groupRole?: "admin" | "member";
  memberCount?: number;
  description?: string;
  disappearingMode?: number; // 0=off, 86400=24h, etc.
}

export interface MessageItem {
  id: string; // ULID
  envelopeId?: string;
  chatId: string; // peer user ID or group ID
  groupId?: string;
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

  // Rich message payload fields
  messageType?: "text" | "poll" | "location" | "contact" | "event" | "view_once";
  poll?: PollData;
  location?: LocationData;
  contact?: ContactData;
  event?: EventData;
  mentions?: string[]; // list of mentioned user IDs
  isPinned?: boolean;
  isStarred?: boolean;
  forwardCount?: number;
  viewOnce?: boolean;
  viewed?: boolean;
  disappearingAfter?: number; // seconds (e.g. 86400)
}

class LocalDB {
  private dbPromise: Promise<IDBDatabase> | null = null;

  constructor() {
    if (typeof indexedDB !== "undefined") {
      this.dbPromise = this.openDB();
      // Schedule background eviction of expired disappearing messages
      setInterval(() => {
        this.purgeExpiredMessages().catch(() => {});
      }, 60000);
    }
  }

  private openDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open("chatapp_local_v2", 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains("chats")) {
          db.createObjectStore("chats", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("messages")) {
          const msgStore = db.createObjectStore("messages", { keyPath: "id" });
          msgStore.createIndex("chatId", "chatId", { unique: false });
          msgStore.createIndex("timestamp", "timestamp", { unique: false });
          msgStore.createIndex("isStarred", "isStarred", { unique: false });
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

  async deleteChat(chatId: string): Promise<void> {
    if (!this.dbPromise) return;
    const db = await this.dbPromise;
    return new Promise((resolve) => {
      const tx = db.transaction(["chats", "messages"], "readwrite");
      tx.objectStore("chats").delete(chatId);
      const msgStore = tx.objectStore("messages");
      const index = msgStore.index("chatId");
      const req = index.openCursor(chatId);
      req.onsuccess = (e: any) => {
        const cursor = e.target.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  }

  async getMessagesForChat(chatId: string): Promise<MessageItem[]> {
    if (!this.dbPromise) return [];
    const db = await this.dbPromise;
    const now = Date.now();
    return new Promise((resolve) => {
      const tx = db.transaction("messages", "readonly");
      const store = tx.objectStore("messages");
      const index = store.index("chatId");
      const req = index.getAll(chatId);
      req.onsuccess = () => {
        const msgs: MessageItem[] = req.result || [];
        // Filter out expired disappearing messages
        const validMsgs = msgs.filter((m) => {
          if (m.disappearingAfter && m.disappearingAfter > 0) {
            return now <= m.timestamp + m.disappearingAfter * 1000;
          }
          return true;
        });
        validMsgs.sort((a, b) => a.timestamp - b.timestamp);
        resolve(validMsgs);
      };
      req.onerror = () => resolve([]);
    });
  }

  async saveMessage(message: MessageItem): Promise<void> {
    if (!this.dbPromise) return;
    const db = await this.dbPromise;
    return new Promise((resolve) => {
      const tx = db.transaction("messages", "readwrite");
      const store = tx.objectStore("messages");
      store.put(message);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  }

  async getMessageById(messageId: string): Promise<MessageItem | null> {
    if (!this.dbPromise) return null;
    const db = await this.dbPromise;
    return new Promise((resolve) => {
      const tx = db.transaction("messages", "readonly");
      const store = tx.objectStore("messages");
      const req = store.get(messageId);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  }

  async purgeExpiredMessages(): Promise<number> {
    if (!this.dbPromise) return 0;
    const db = await this.dbPromise;
    const now = Date.now();
    let deletedCount = 0;

    return new Promise((resolve) => {
      const tx = db.transaction("messages", "readwrite");
      const store = tx.objectStore("messages");
      const req = store.openCursor();

      req.onsuccess = (e: any) => {
        const cursor = e.target.result;
        if (cursor) {
          const msg: MessageItem = cursor.value;
          if (msg.disappearingAfter && msg.disappearingAfter > 0) {
            if (now > msg.timestamp + msg.disappearingAfter * 1000) {
              cursor.delete();
              deletedCount++;
            }
          }
          cursor.continue();
        } else {
          resolve(deletedCount);
        }
      };
      req.onerror = () => resolve(0);
    });
  }
}

export const localDB = new LocalDB();

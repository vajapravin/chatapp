export interface SenderKeyState {
  groupId: string;
  senderId: string;
  iteration: number;
  chainKey: string; // Base64 raw 32 bytes
  signingKey: string; // Base64 raw HMAC key
}

export class SenderKeyStore {
  private cache: Map<string, SenderKeyState> = new Map();
  private dbPromise: Promise<IDBDatabase> | null = null;

  constructor() {
    if (typeof indexedDB !== "undefined") {
      this.dbPromise = this.openDB();
    }
  }

  private key(groupId: string, senderId: string): string {
    return `${groupId}::${senderId}`;
  }

  private openDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open("chatapp_sender_keys_v1", 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains("sender_keys")) {
          db.createObjectStore("sender_keys", { keyPath: "compositeKey" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async getSenderKey(groupId: string, senderId: string): Promise<SenderKeyState | null> {
    const k = this.key(groupId, senderId);
    if (this.cache.has(k)) {
      return this.cache.get(k)!;
    }

    if (!this.dbPromise) return null;
    try {
      const db = await this.dbPromise;
      return new Promise((resolve) => {
        const tx = db.transaction("sender_keys", "readonly");
        const store = tx.objectStore("sender_keys");
        const req = store.get(k);
        req.onsuccess = () => {
          const res = req.result;
          if (res) {
            delete res.compositeKey;
            this.cache.set(k, res);
            resolve(res);
          } else {
            resolve(null);
          }
        };
        req.onerror = () => resolve(null);
      });
    } catch {
      return null;
    }
  }

  async saveSenderKey(groupId: string, senderId: string, state: SenderKeyState): Promise<void> {
    const k = this.key(groupId, senderId);
    this.cache.set(k, state);

    if (!this.dbPromise) return;
    try {
      const db = await this.dbPromise;
      return new Promise((resolve) => {
        const tx = db.transaction("sender_keys", "readwrite");
        const store = tx.objectStore("sender_keys");
        store.put({ compositeKey: k, ...state });
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      });
    } catch {
      // Memory fallback if IndexedDB fails
    }
  }

  async resetGroupKeys(groupId: string): Promise<void> {
    for (const [k] of this.cache.entries()) {
      if (k.startsWith(`${groupId}::`)) {
        this.cache.delete(k);
      }
    }
  }
}

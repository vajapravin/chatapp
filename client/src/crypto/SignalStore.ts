import {
  Direction,
  KeyPairType,
  SessionRecordType,
  StorageType,
} from "@privacyresearch/libsignal-protocol-typescript";
import {
  arrayBufferToBase64,
  base64ToArrayBuffer,
} from "./helpers";

interface SerializedKeyPair {
  pubKey: string;
  privKey: string;
}

export class SignalStore implements StorageType {
  private prefix: string;
  private dbPromise: Promise<IDBDatabase> | null = null;
  private memoryCache: Map<string, any> = new Map();

  constructor(userId: string) {
    this.prefix = `sig_${userId}_`;
    if (typeof indexedDB !== "undefined") {
      this.dbPromise = this.initDB();
    }
  }

  private initDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(`chatapp_keystore`, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains("keystore")) {
          db.createObjectStore("keystore");
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  private async get(key: string): Promise<any> {
    const fullKey = this.prefix + key;
    if (this.memoryCache.has(fullKey)) {
      return this.memoryCache.get(fullKey);
    }

    if (this.dbPromise) {
      try {
        const db = await this.dbPromise;
        const val = await new Promise<any>((resolve, reject) => {
          const tx = db.transaction("keystore", "readonly");
          const store = tx.objectStore("keystore");
          const req = store.get(fullKey);
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });
        if (val !== undefined) {
          this.memoryCache.set(fullKey, val);
          return val;
        }
      } catch {
        // Fallback to localStorage
      }
    }

    try {
      const raw = localStorage.getItem(fullKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        this.memoryCache.set(fullKey, parsed);
        return parsed;
      }
    } catch {
      // ignore
    }
    return undefined;
  }

  private async set(key: string, value: any): Promise<void> {
    const fullKey = this.prefix + key;
    this.memoryCache.set(fullKey, value);

    if (this.dbPromise) {
      try {
        const db = await this.dbPromise;
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction("keystore", "readwrite");
          const store = tx.objectStore("keystore");
          const req = store.put(value, fullKey);
          req.onsuccess = () => resolve();
          req.onerror = () => reject(req.error);
        });
        return;
      } catch {
        // Fallback to localStorage
      }
    }

    try {
      localStorage.setItem(fullKey, JSON.stringify(value));
    } catch {
      // ignore
    }
  }

  private async remove(key: string): Promise<void> {
    const fullKey = this.prefix + key;
    this.memoryCache.delete(fullKey);

    if (this.dbPromise) {
      try {
        const db = await this.dbPromise;
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction("keystore", "readwrite");
          const store = tx.objectStore("keystore");
          const req = store.delete(fullKey);
          req.onsuccess = () => resolve();
          req.onerror = () => reject(req.error);
        });
        return;
      } catch {
        // Fallback
      }
    }

    try {
      localStorage.removeItem(fullKey);
    } catch {
      // ignore
    }
  }

  private serializeKeyPair(kp: KeyPairType): SerializedKeyPair {
    return {
      pubKey: arrayBufferToBase64(kp.pubKey),
      privKey: arrayBufferToBase64(kp.privKey),
    };
  }

  private deserializeKeyPair(skp: SerializedKeyPair): KeyPairType {
    return {
      pubKey: base64ToArrayBuffer(skp.pubKey),
      privKey: base64ToArrayBuffer(skp.privKey),
    };
  }

  async getIdentityKeyPair(): Promise<KeyPairType | undefined> {
    const raw = await this.get("identityKey");
    if (!raw) return undefined;
    return this.deserializeKeyPair(raw);
  }

  async setIdentityKeyPair(keyPair: KeyPairType): Promise<void> {
    await this.set("identityKey", this.serializeKeyPair(keyPair));
  }

  async getLocalRegistrationId(): Promise<number | undefined> {
    return this.get("registrationId");
  }

  async setLocalRegistrationId(registrationId: number): Promise<void> {
    await this.set("registrationId", registrationId);
  }

  async isTrustedIdentity(
    _identifier: string,
    _identityKey: ArrayBuffer,
    _direction: Direction
  ): Promise<boolean> {
    // In Phase 2 TOFU (Trust On First Use) model
    return true;
  }

  async saveIdentity(
    encodedAddress: string,
    publicKey: ArrayBuffer,
    _nonblockingApproval?: boolean
  ): Promise<boolean> {
    await this.set(`identity_${encodedAddress}`, arrayBufferToBase64(publicKey));
    return true;
  }

  async loadPreKey(keyId: string | number): Promise<KeyPairType | undefined> {
    const raw = await this.get(`preKey_${keyId}`);
    if (!raw) return undefined;
    return this.deserializeKeyPair(raw);
  }

  async storePreKey(
    keyId: number | string,
    keyPair: KeyPairType
  ): Promise<void> {
    await this.set(`preKey_${keyId}`, this.serializeKeyPair(keyPair));
  }

  async removePreKey(keyId: number | string): Promise<void> {
    await this.remove(`preKey_${keyId}`);
  }

  async storeSession(
    encodedAddress: string,
    record: SessionRecordType
  ): Promise<void> {
    await this.set(`session_${encodedAddress}`, record);
  }

  async loadSession(
    encodedAddress: string
  ): Promise<SessionRecordType | undefined> {
    return this.get(`session_${encodedAddress}`);
  }

  async loadSignedPreKey(
    keyId: number | string
  ): Promise<KeyPairType | undefined> {
    const raw = await this.get(`signedPreKey_${keyId}`);
    if (!raw) return undefined;
    return this.deserializeKeyPair(raw);
  }

  async storeSignedPreKey(
    keyId: number | string,
    keyPair: KeyPairType
  ): Promise<void> {
    await this.set(`signedPreKey_${keyId}`, this.serializeKeyPair(keyPair));
  }

  async removeSignedPreKey(keyId: number | string): Promise<void> {
    await this.remove(`signedPreKey_${keyId}`);
  }
}

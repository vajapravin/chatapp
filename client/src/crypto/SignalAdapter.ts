import {
  KeyHelper,
  SessionBuilder,
  SessionCipher,
  SignalProtocolAddress,
} from "@privacyresearch/libsignal-protocol-typescript";
import { useAuthStore } from "../store/authStore";
import {
  arrayBufferToBase64,
  base64ToArrayBuffer,
  base64ToBinaryString,
  binaryStringToBase64,
} from "./helpers";
import { SignalStore } from "./SignalStore";

export interface EncryptedMessagePayload {
  type: number;
  body: string;
  registrationId?: number;
}

export class SignalAdapter {
  private store: SignalStore;
  private userId: string;
  private deviceId: number;

  constructor(userId: string, deviceId: number = 1) {
    this.userId = userId;
    this.deviceId = deviceId;
    this.store = new SignalStore(userId);
  }

  getStorage(): SignalStore {
    return this.store;
  }

  getUserId(): string {
    return this.userId;
  }

  getDeviceId(): number {
    return this.deviceId;
  }

  async init(): Promise<void> {
    const existingIdentity = await this.store.getIdentityKeyPair();
    const existingRegId = await this.store.getLocalRegistrationId();

    if (!existingIdentity || !existingRegId) {
      await this.generateAndUploadInitialKeys();
    } else {
      await this.checkAndReplenishKeys();
    }
  }

  private async generateAndUploadInitialKeys(): Promise<void> {
    const identityKeyPair = await KeyHelper.generateIdentityKeyPair();
    const registrationId = KeyHelper.generateRegistrationId();

    await this.store.setIdentityKeyPair(identityKeyPair);
    await this.store.setLocalRegistrationId(registrationId);

    const signedPreKey = await KeyHelper.generateSignedPreKey(identityKeyPair, 1);
    await this.store.storeSignedPreKey(1, signedPreKey.keyPair);

    const oneTimePrekeys: Array<{ key_id: number; public_key: string }> = [];
    for (let i = 1; i <= 100; i++) {
      const preKey = await KeyHelper.generatePreKey(i);
      await this.store.storePreKey(i, preKey.keyPair);
      oneTimePrekeys.push({
        key_id: i,
        public_key: arrayBufferToBase64(preKey.keyPair.pubKey),
      });
    }

    const payload = {
      identity_key: arrayBufferToBase64(identityKeyPair.pubKey),
      signed_prekey: {
        key_id: 1,
        public_key: arrayBufferToBase64(signedPreKey.keyPair.pubKey),
        signature: arrayBufferToBase64(signedPreKey.signature),
      },
      one_time_prekeys: oneTimePrekeys,
    };

    const token = useAuthStore.getState().accessToken;
    const res = await fetch("/v1/keys/init", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: "Failed to upload keys" }));
      console.warn("Key upload warning:", err);
    }
  }

  private async checkAndReplenishKeys(): Promise<void> {
    const token = useAuthStore.getState().accessToken;
    if (!token) return;

    try {
      const res = await fetch("/v1/keys/status", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;

      const status = await res.json();
      if (status.unconsumed_prekeys < 20) {
        // Generate 50 new one-time prekeys starting after highest existing
        const startId = Date.now() % 100000;
        const newPrekeys: Array<{ key_id: number; public_key: string }> = [];
        for (let i = 0; i < 50; i++) {
          const keyId = startId + i;
          const preKey = await KeyHelper.generatePreKey(keyId);
          await this.store.storePreKey(keyId, preKey.keyPair);
          newPrekeys.push({
            key_id: keyId,
            public_key: arrayBufferToBase64(preKey.keyPair.pubKey),
          });
        }

        await fetch("/v1/keys/prekeys", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ prekeys: newPrekeys }),
        });
      }
    } catch (e) {
      console.warn("Failed to check or replenish keys:", e);
    }
  }

  async ensureSession(recipientUserId: string, recipientDeviceId: number = 1): Promise<void> {
    const address = new SignalProtocolAddress(recipientUserId, recipientDeviceId);
    const existingSession = await this.store.loadSession(address.toString());
    if (existingSession) return;

    const token = useAuthStore.getState().accessToken;
    const res = await fetch(`/v1/keys/bundle/${recipientUserId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      const error = await res.json().catch(() => ({ detail: "Failed to fetch prekey bundle" }));
      throw new Error(error.detail || "Failed to fetch prekey bundle");
    }

    const bundleResponse = await res.json();
    const deviceBundle = bundleResponse.devices?.find(
      (d: any) => d.device_id === recipientDeviceId
    );

    if (!deviceBundle) {
      throw new Error(`Device ${recipientDeviceId} not found for user ${recipientUserId}`);
    }

    const sessionBuilder = new SessionBuilder(this.store, address);
    await sessionBuilder.processPreKey({
      registrationId: deviceBundle.registration_id,
      identityKey: base64ToArrayBuffer(deviceBundle.identity_key),
      signedPreKey: {
        keyId: deviceBundle.signed_prekey.key_id,
        publicKey: base64ToArrayBuffer(deviceBundle.signed_prekey.public_key),
        signature: base64ToArrayBuffer(deviceBundle.signed_prekey.signature),
      },
      preKey: deviceBundle.one_time_prekey
        ? {
            keyId: deviceBundle.one_time_prekey.key_id,
            publicKey: base64ToArrayBuffer(deviceBundle.one_time_prekey.public_key),
          }
        : undefined,
    });
  }

  async encrypt(
    recipientUserId: string,
    recipientDeviceId: number,
    plaintext: string
  ): Promise<EncryptedMessagePayload> {
    await this.ensureSession(recipientUserId, recipientDeviceId);

    const address = new SignalProtocolAddress(recipientUserId, recipientDeviceId);
    const cipher = new SessionCipher(this.store, address);

    const buffer = new TextEncoder().encode(plaintext).buffer;
    const encrypted = await cipher.encrypt(buffer);

    return {
      type: encrypted.type,
      body: binaryStringToBase64(encrypted.body!),
      registrationId: encrypted.registrationId,
    };
  }

  async decrypt(
    senderUserId: string,
    senderDeviceId: number,
    payload: EncryptedMessagePayload
  ): Promise<string> {
    const address = new SignalProtocolAddress(senderUserId, senderDeviceId);
    const cipher = new SessionCipher(this.store, address);

    const binaryBody = base64ToBinaryString(payload.body);
    let decryptedBytes: ArrayBuffer;

    if (payload.type === 3) {
      decryptedBytes = await cipher.decryptPreKeyWhisperMessage(binaryBody, "binary");
    } else {
      decryptedBytes = await cipher.decryptWhisperMessage(binaryBody, "binary");
    }

    return new TextDecoder().decode(decryptedBytes);
  }
}

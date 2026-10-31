import { arrayBufferToBase64, base64ToArrayBuffer } from "./helpers";
import { SenderKeyStore, SenderKeyState } from "./SenderKeyStore";

export interface SenderKeyDistributionPayload {
  groupId: string;
  senderId: string;
  iteration: number;
  chainKey: string;
  signingKey: string;
}

export interface SenderKeyMessagePayload {
  iteration: number;
  iv: string; // Base64
  ciphertext: string; // Base64
  signature: string; // Base64
}

export class GroupCipher {
  private store: SenderKeyStore;

  constructor(store: SenderKeyStore) {
    this.store = store;
  }

  async createDistributionMessage(
    groupId: string,
    senderId: string
  ): Promise<SenderKeyDistributionPayload> {
    const chainKeyBytes = crypto.getRandomValues(new Uint8Array(32));
    const signingKeyBytes = crypto.getRandomValues(new Uint8Array(32));

    const state: SenderKeyState = {
      groupId,
      senderId,
      iteration: 0,
      chainKey: arrayBufferToBase64(chainKeyBytes.buffer),
      signingKey: arrayBufferToBase64(signingKeyBytes.buffer),
    };

    await this.store.saveSenderKey(groupId, senderId, state);

    return {
      groupId,
      senderId,
      iteration: 0,
      chainKey: state.chainKey,
      signingKey: state.signingKey,
    };
  }

  async processDistributionMessage(
    payload: SenderKeyDistributionPayload
  ): Promise<void> {
    const state: SenderKeyState = {
      groupId: payload.groupId,
      senderId: payload.senderId,
      iteration: payload.iteration,
      chainKey: payload.chainKey,
      signingKey: payload.signingKey,
    };
    await this.store.saveSenderKey(payload.groupId, payload.senderId, state);
  }

  async encrypt(
    groupId: string,
    senderId: string,
    plaintext: string
  ): Promise<string> {
    let state = await this.store.getSenderKey(groupId, senderId);
    if (!state) {
      await this.createDistributionMessage(groupId, senderId);
      state = (await this.store.getSenderKey(groupId, senderId))!;
    }

    const enc = new TextEncoder();
    const chainKeyBytes = new Uint8Array(base64ToArrayBuffer(state.chainKey));
    const signingKeyBytes = new Uint8Array(base64ToArrayBuffer(state.signingKey));

    // 1. Derive MessageKey = HMAC-SHA256(chainKey, "MessageKey")
    const hmacChainKey = await crypto.subtle.importKey(
      "raw",
      chainKeyBytes,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const messageKeyBytes = await crypto.subtle.sign(
      "HMAC",
      hmacChainKey,
      enc.encode("MessageKey")
    );

    // 2. Advance NextChainKey = HMAC-SHA256(chainKey, "ChainKey")
    const nextChainKeyBytes = await crypto.subtle.sign(
      "HMAC",
      hmacChainKey,
      enc.encode("ChainKey")
    );

    const currentIteration = state.iteration;
    state.iteration += 1;
    state.chainKey = arrayBufferToBase64(nextChainKeyBytes);
    await this.store.saveSenderKey(groupId, senderId, state);

    // 3. Encrypt Plaintext with AES-256-GCM
    const aesKey = await crypto.subtle.importKey(
      "raw",
      messageKeyBytes,
      { name: "AES-GCM" },
      false,
      ["encrypt"]
    );
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertextBuffer = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      aesKey,
      enc.encode(plaintext)
    );

    // 4. Sign (iv + ciphertext) with signingKey
    const signHmacKey = await crypto.subtle.importKey(
      "raw",
      signingKeyBytes,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const dataToSign = new Uint8Array(iv.byteLength + ciphertextBuffer.byteLength);
    dataToSign.set(iv, 0);
    dataToSign.set(new Uint8Array(ciphertextBuffer), iv.byteLength);

    const sigBuffer = await crypto.subtle.sign("HMAC", signHmacKey, dataToSign);

    const messagePayload: SenderKeyMessagePayload = {
      iteration: currentIteration,
      iv: arrayBufferToBase64(iv.buffer),
      ciphertext: arrayBufferToBase64(ciphertextBuffer),
      signature: arrayBufferToBase64(sigBuffer),
    };

    return JSON.stringify(messagePayload);
  }

  async decrypt(
    groupId: string,
    senderId: string,
    serializedPayload: string
  ): Promise<string> {
    const payload: SenderKeyMessagePayload = JSON.parse(serializedPayload);
    const state = await this.store.getSenderKey(groupId, senderId);
    if (!state) {
      throw new Error(`Sender key not found for sender ${senderId} in group ${groupId}`);
    }

    const enc = new TextEncoder();
    const dec = new TextDecoder();

    let currentChainKeyBytes = new Uint8Array(base64ToArrayBuffer(state.chainKey));
    const signingKeyBytes = new Uint8Array(base64ToArrayBuffer(state.signingKey));

    // Fast-forward chain key if needed
    while (state.iteration < payload.iteration) {
      const hmacKey = await crypto.subtle.importKey(
        "raw",
        currentChainKeyBytes,
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"]
      );
      currentChainKeyBytes = new Uint8Array(
        await crypto.subtle.sign("HMAC", hmacKey, enc.encode("ChainKey"))
      );
      state.iteration += 1;
    }

    // Derive MessageKey
    const hmacChainKey = await crypto.subtle.importKey(
      "raw",
      currentChainKeyBytes,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const messageKeyBytes = await crypto.subtle.sign(
      "HMAC",
      hmacChainKey,
      enc.encode("MessageKey")
    );

    // Verify HMAC signature
    const iv = new Uint8Array(base64ToArrayBuffer(payload.iv));
    const ciphertext = new Uint8Array(base64ToArrayBuffer(payload.ciphertext));
    const signature = new Uint8Array(base64ToArrayBuffer(payload.signature));

    const signHmacKey = await crypto.subtle.importKey(
      "raw",
      signingKeyBytes,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"]
    );
    const dataToVerify = new Uint8Array(iv.byteLength + ciphertext.byteLength);
    dataToVerify.set(iv, 0);
    dataToVerify.set(ciphertext, iv.byteLength);

    const isValid = await crypto.subtle.verify(
      "HMAC",
      signHmacKey,
      signature,
      dataToVerify
    );
    if (!isValid) {
      throw new Error("Invalid sender key message signature");
    }

    // Decrypt AES-256-GCM
    const aesKey = await crypto.subtle.importKey(
      "raw",
      messageKeyBytes,
      { name: "AES-GCM" },
      false,
      ["decrypt"]
    );
    const decryptedBuffer = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      aesKey,
      ciphertext
    );

    // Advance for next iteration
    const nextChainKey = await crypto.subtle.sign(
      "HMAC",
      hmacChainKey,
      enc.encode("ChainKey")
    );
    state.iteration += 1;
    state.chainKey = arrayBufferToBase64(nextChainKey);
    await this.store.saveSenderKey(groupId, senderId, state);

    return dec.decode(decryptedBuffer);
  }
}

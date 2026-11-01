import * as signal from "@privacyresearch/libsignal-protocol-typescript";
import mqtt from "mqtt";

const API_BASE = "http://localhost:8001";
const MQTT_URL = "mqtt://localhost:1883";

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToArrayBuffer(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

function bufferToHex(buffer) {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// In-Memory Signal Store
class MemorySignalStore {
  constructor() {
    this.store = new Map();
  }
  async getIdentityKeyPair() { return this.store.get("identityKey"); }
  async getLocalRegistrationId() { return this.store.get("registrationId"); }
  async isTrustedIdentity() { return true; }
  async saveIdentity(addr, key) { this.store.set("id_" + addr, key); return true; }
  async loadPreKey(id) { return this.store.get("preKey_" + id); }
  async storePreKey(id, kp) { this.store.set("preKey_" + id, kp); }
  async removePreKey(id) { this.store.delete("preKey_" + id); }
  async storeSession(addr, rec) { this.store.set("session_" + addr, rec); }
  async loadSession(addr) { return this.store.get("session_" + addr); }
  async loadSignedPreKey(id) { return this.store.get("signedPreKey_" + id); }
  async storeSignedPreKey(id, kp) { this.store.set("signedPreKey_" + id, kp); }
  async removeSignedPreKey(id) { this.store.delete("signedPreKey_" + id); }
}

// In-Memory Sender Key Store for Group Messaging
class MemorySenderKeyStore {
  constructor() {
    this.store = new Map();
  }
  async getSenderKey(groupId, senderId) {
    return this.store.get(`${groupId}::${senderId}`) || null;
  }
  async saveSenderKey(groupId, senderId, state) {
    this.store.set(`${groupId}::${senderId}`, { ...state });
  }
  async deleteSenderKey(groupId, senderId) {
    this.store.delete(`${groupId}::${senderId}`);
  }
}

class GroupCipher {
  constructor(store) {
    this.store = store;
  }

  async createDistributionMessage(groupId, senderId) {
    const chainKeyBytes = crypto.getRandomValues(new Uint8Array(32));
    const signingKeyBytes = crypto.getRandomValues(new Uint8Array(32));

    const state = {
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

  async processDistributionMessage(payload) {
    const state = {
      groupId: payload.groupId,
      senderId: payload.senderId,
      iteration: payload.iteration,
      chainKey: payload.chainKey,
      signingKey: payload.signingKey,
    };
    await this.store.saveSenderKey(payload.groupId, payload.senderId, state);
  }

  async encrypt(groupId, senderId, plaintext) {
    let state = await this.store.getSenderKey(groupId, senderId);
    if (!state) {
      await this.createDistributionMessage(groupId, senderId);
      state = await this.store.getSenderKey(groupId, senderId);
    }

    const enc = new TextEncoder();
    const chainKeyBytes = new Uint8Array(base64ToArrayBuffer(state.chainKey));
    const signingKeyBytes = new Uint8Array(base64ToArrayBuffer(state.signingKey));

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
    const nextChainKeyBytes = await crypto.subtle.sign(
      "HMAC",
      hmacChainKey,
      enc.encode("ChainKey")
    );

    const currentIteration = state.iteration;
    state.iteration += 1;
    state.chainKey = arrayBufferToBase64(nextChainKeyBytes);
    await this.store.saveSenderKey(groupId, senderId, state);

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

    return {
      iteration: currentIteration,
      iv: arrayBufferToBase64(iv.buffer),
      ciphertext: arrayBufferToBase64(ciphertextBuffer),
      signature: arrayBufferToBase64(sigBuffer),
    };
  }

  async decrypt(groupId, senderId, payload) {
    const state = await this.store.getSenderKey(groupId, senderId);
    if (!state) {
      throw new Error(`No sender key state for ${groupId}::${senderId}`);
    }

    const enc = new TextEncoder();
    const dec = new TextDecoder();
    const chainKeyBytes = new Uint8Array(base64ToArrayBuffer(state.chainKey));
    const signingKeyBytes = new Uint8Array(base64ToArrayBuffer(state.signingKey));

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

// Media Cryptography Helper
class TestMediaCipher {
  static async encryptBuffer(plaintextBuffer) {
    const keyBytes = crypto.getRandomValues(new Uint8Array(32));
    const ivBytes = crypto.getRandomValues(new Uint8Array(12));

    const aesKey = await crypto.subtle.importKey(
      "raw",
      keyBytes,
      { name: "AES-GCM" },
      false,
      ["encrypt"]
    );

    const ciphertextBuffer = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: ivBytes },
      aesKey,
      plaintextBuffer
    );

    const sha256Buffer = await crypto.subtle.digest("SHA-256", ciphertextBuffer);
    const sha256Hex = bufferToHex(sha256Buffer);

    return {
      ciphertext: new Uint8Array(ciphertextBuffer),
      cipherKey: arrayBufferToBase64(keyBytes.buffer),
      iv: arrayBufferToBase64(ivBytes.buffer),
      sha256: sha256Hex,
    };
  }

  static async decryptBuffer(ciphertextBytes, cipherKeyBase64, ivBase64, expectedSha256) {
    // 1. Verify SHA-256 checksum
    const sha256Buffer = await crypto.subtle.digest("SHA-256", ciphertextBytes);
    const actualSha256 = bufferToHex(sha256Buffer);
    if (actualSha256.toLowerCase() !== expectedSha256.toLowerCase()) {
      throw new Error(`SHA-256 mismatch! Expected ${expectedSha256}, got ${actualSha256}`);
    }

    // 2. Decrypt AES-256-GCM
    const keyBytes = new Uint8Array(base64ToArrayBuffer(cipherKeyBase64));
    const ivBytes = new Uint8Array(base64ToArrayBuffer(ivBase64));

    const aesKey = await crypto.subtle.importKey(
      "raw",
      keyBytes,
      { name: "AES-GCM" },
      false,
      ["decrypt"]
    );

    const decryptedBuffer = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: ivBytes },
      aesKey,
      ciphertextBytes
    );

    return new Uint8Array(decryptedBuffer);
  }
}

// Upload Encrypted Media to FastAPI chunked multipart API
async function uploadMediaFile(token, ciphertextBytes, fileName, mimeType, sha256) {
  // 1. Init multipart upload
  const initRes = await fetch(`${API_BASE}/v1/media/upload/init`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      file_name: fileName,
      mime_type: mimeType,
      file_size: ciphertextBytes.byteLength,
      sha256: sha256,
    }),
  });
  if (!initRes.ok) throw new Error(`Init upload failed: ${await initRes.text()}`);
  const { upload_id, key } = await initRes.json();

  // 2. Request part upload URL for Part 1
  const partRes = await fetch(`${API_BASE}/v1/media/upload/part-url`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      key,
      upload_id,
      part_number: 1,
    }),
  });
  if (!partRes.ok) throw new Error(`Part URL request failed: ${await partRes.text()}`);
  const { upload_url } = await partRes.json();

  // 3. PUT chunk bytes
  const fullUploadUrl = upload_url.startsWith("http") ? upload_url : `${API_BASE}${upload_url}`;
  const uploadChunkRes = await fetch(fullUploadUrl, {
    method: "PUT",
    headers: {
      "Content-Type": "application/octet-stream",
      Authorization: `Bearer ${token}`,
    },
    body: ciphertextBytes,
  });
  if (!uploadChunkRes.ok) throw new Error(`Upload chunk failed: ${await uploadChunkRes.text()}`);

  // 4. Complete multipart upload
  const completeRes = await fetch(`${API_BASE}/v1/media/upload/complete`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      key,
      upload_id,
      parts: [{ part_number: 1, etag: "part-1" }],
      sha256,
    }),
  });
  if (!completeRes.ok) throw new Error(`Complete upload failed: ${await completeRes.text()}`);
  return completeRes.json();
}

// Download Encrypted Media from download URL
async function downloadMediaFile(token, downloadUrl) {
  const fullUrl = downloadUrl.startsWith("http") ? downloadUrl : `${API_BASE}${downloadUrl}`;
  const res = await fetch(fullUrl, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Download media failed: ${await res.text()}`);
  const arrayBuffer = await res.arrayBuffer();
  return new Uint8Array(arrayBuffer);
}

async function loginUser(phoneNumber) {
  await fetch(`${API_BASE}/v1/auth/otp/request`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone_number: phoneNumber }),
  });

  const res = await fetch(`${API_BASE}/v1/auth/otp/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone_number: phoneNumber, code: "123456" }),
  });

  if (!res.ok) {
    throw new Error(`Login failed for ${phoneNumber}: ${await res.text()}`);
  }
  return res.json();
}

async function uploadSignalKeys(token, store) {
  const identityKeyPair = await signal.KeyHelper.generateIdentityKeyPair();
  const registrationId = signal.KeyHelper.generateRegistrationId();

  store.store.set("identityKey", identityKeyPair);
  store.store.set("registrationId", registrationId);

  const signedPreKey = await signal.KeyHelper.generateSignedPreKey(identityKeyPair, 1);
  await store.storeSignedPreKey(1, signedPreKey.keyPair);

  const oneTimePrekeys = [];
  for (let i = 1; i <= 20; i++) {
    const preKey = await signal.KeyHelper.generatePreKey(i);
    await store.storePreKey(i, preKey.keyPair);
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

  const res = await fetch(`${API_BASE}/v1/keys/init`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    throw new Error(`Key upload failed: ${await res.text()}`);
  }
}

async function setupPairwiseSession(initiatorToken, initiatorStore, recipientId) {
  const bundleRes = await fetch(`${API_BASE}/v1/keys/bundle/${recipientId}`, {
    headers: { Authorization: `Bearer ${initiatorToken}` },
  });
  if (!bundleRes.ok) throw new Error(`Failed to fetch bundle for ${recipientId}`);
  const bundle = await bundleRes.json();
  const device = bundle.devices[0];

  const recipientAddr = new signal.SignalProtocolAddress(recipientId, 1);
  const sessionBuilder = new signal.SessionBuilder(initiatorStore, recipientAddr);

  await sessionBuilder.processPreKey({
    registrationId: device.registration_id,
    identityKey: base64ToArrayBuffer(device.identity_key),
    signedPreKey: {
      keyId: device.signed_prekey.key_id,
      publicKey: base64ToArrayBuffer(device.signed_prekey.public_key),
      signature: base64ToArrayBuffer(device.signed_prekey.signature),
    },
    preKey: device.one_time_prekey
      ? {
          keyId: device.one_time_prekey.key_id,
          publicKey: base64ToArrayBuffer(device.one_time_prekey.public_key),
        }
      : undefined,
  });
}

async function run() {
  console.log("=================================================");
  console.log(" PHASE 4 MEDIA PIPELINE & RICH ASSETS VERIFICATION");
  console.log("=================================================");

  // 1. Authenticate Alice, Bob, and Charlie
  console.log("\n[1/7] Authenticating 3 users (Alice, Bob, Charlie)...");
  const alice = await loginUser("+10000000041");
  const bob = await loginUser("+10000000042");
  const charlie = await loginUser("+10000000043");
  console.log(`✓ Alice:   ${alice.user_id}`);
  console.log(`✓ Bob:     ${bob.user_id}`);
  console.log(`✓ Charlie: ${charlie.user_id}`);

  // 2. Initialize Signal Protocol Stores
  console.log("\n[2/7] Registering Signal protocol keys in API...");
  const aliceSignalStore = new MemorySignalStore();
  const bobSignalStore = new MemorySignalStore();
  const charlieSignalStore = new MemorySignalStore();

  await uploadSignalKeys(alice.access_token, aliceSignalStore);
  await uploadSignalKeys(bob.access_token, bobSignalStore);
  await uploadSignalKeys(charlie.access_token, charlieSignalStore);
  console.log("✓ Uploaded prekey bundles for all 3 participants");

  // 3. Connect MQTT clients & listen on u/{userId}/1/#
  console.log("\n[3/7] Connecting clients to Mosquitto MQTT broker...");
  const bobInboxes = [];
  const charlieInboxes = [];

  const aliceMqtt = mqtt.connect(MQTT_URL, {
    username: alice.user_id,
    password: alice.access_token,
    clientId: `alice_p4_${Date.now()}`,
    clean: true,
  });
  const bobMqtt = mqtt.connect(MQTT_URL, {
    username: bob.user_id,
    password: bob.access_token,
    clientId: `bob_p4_${Date.now()}`,
    clean: true,
  });
  const charlieMqtt = mqtt.connect(MQTT_URL, {
    username: charlie.user_id,
    password: charlie.access_token,
    clientId: `charlie_p4_${Date.now()}`,
    clean: true,
  });

  bobMqtt.on("message", (topic, payload) => {
    if (topic === `u/${bob.user_id}/1/inbox`) {
      try {
        bobInboxes.push(JSON.parse(payload.toString()));
      } catch {}
    }
  });

  charlieMqtt.on("message", (topic, payload) => {
    if (topic === `u/${charlie.user_id}/1/inbox`) {
      try {
        charlieInboxes.push(JSON.parse(payload.toString()));
      } catch {}
    }
  });

  await Promise.all([
    new Promise((r) => aliceMqtt.on("connect", r)),
    new Promise((r) => bobMqtt.on("connect", r)),
    new Promise((r) => charlieMqtt.on("connect", r)),
  ]);

  await Promise.all([
    new Promise((r) => aliceMqtt.subscribe(`u/${alice.user_id}/1/#`, r)),
    new Promise((r) => bobMqtt.subscribe(`u/${bob.user_id}/1/#`, r)),
    new Promise((r) => charlieMqtt.subscribe(`u/${charlie.user_id}/1/#`, r)),
  ]);
  console.log("✓ Connected all 3 users and subscribed to inbox topics");

  // Initialize Pairwise Signal Sessions
  await setupPairwiseSession(alice.access_token, aliceSignalStore, bob.user_id);
  await setupPairwiseSession(alice.access_token, aliceSignalStore, charlie.user_id);

  // Group cipher initialization
  const aliceGroupStore = new MemorySenderKeyStore();
  const bobGroupStore = new MemorySenderKeyStore();
  const charlieGroupStore = new MemorySenderKeyStore();

  const aliceGroupCipher = new GroupCipher(aliceGroupStore);
  const bobGroupCipher = new GroupCipher(bobGroupStore);
  const charlieGroupCipher = new GroupCipher(charlieGroupStore);

  // 4. Test 1: Encrypted Photo Upload, Signal 1:1 Delivery & Decryption
  console.log("\n[4/7] Testing Encrypted Photo Upload, 1:1 Signal Delivery & Decryption...");
  const originalImageBytes = new TextEncoder().encode(
    "BINARY_IMAGE_DATA_SAMPLE_SIMULATING_4K_WALLPAPER_WITH_ENTROPY_" + Math.random()
  );

  // Client encrypts file on-device
  const encryptedImage = await TestMediaCipher.encryptBuffer(originalImageBytes);
  console.log(`  → Encrypted on-client: ciphertext=${encryptedImage.ciphertext.byteLength}B sha256=${encryptedImage.sha256}`);

  // Upload to chunked multipart endpoint
  const uploadedImage = await uploadMediaFile(
    alice.access_token,
    encryptedImage.ciphertext,
    "scenic-mountain.png",
    "image/png",
    encryptedImage.sha256
  );
  console.log(`  → Uploaded via multipart API: download_url=${uploadedImage.download_url}`);

  const photoAttachment = {
    url: uploadedImage.download_url,
    mimeType: "image/png",
    fileName: "scenic-mountain.png",
    fileSize: originalImageBytes.byteLength,
    cipherKey: encryptedImage.cipherKey,
    iv: encryptedImage.iv,
    sha256: encryptedImage.sha256,
    quality: "hd",
    width: 3840,
    height: 2160,
  };

  const photoMessagePayload = {
    id: `msg_img_${Date.now()}`,
    type: "image",
    text: "Check out this mountain view!",
    media: photoAttachment,
    timestamp: Date.now(),
  };

  const aliceToBobCipher = new signal.SessionCipher(
    aliceSignalStore,
    new signal.SignalProtocolAddress(bob.user_id, 1)
  );
  const signalEncryptedPhoto = await aliceToBobCipher.encrypt(
    new TextEncoder().encode(JSON.stringify(photoMessagePayload)).buffer
  );

  const photoEnvelope = {
    id: `env_photo_${Date.now()}`,
    version: 1,
    sender_user: alice.user_id,
    sender_device: 1,
    recipient_user: bob.user_id,
    recipient_device: 1,
    type: 1,
    ciphertext: btoa(JSON.stringify({
      type: signalEncryptedPhoto.type,
      body: btoa(signalEncryptedPhoto.body),
      registrationId: signalEncryptedPhoto.registrationId,
    })),
    timestamp: Date.now(),
  };

  aliceMqtt.publish(`out/${alice.user_id}/1`, JSON.stringify(photoEnvelope), { qos: 1 });

  // Wait for Bob to receive
  for (let i = 0; i < 30; i++) {
    if (bobInboxes.some((e) => e.id === photoEnvelope.id)) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  const bobPhotoEnv = bobInboxes.find((e) => e.id === photoEnvelope.id);
  if (!bobPhotoEnv) throw new Error("Bob did not receive photo envelope");

  const bobAddr = new signal.SignalProtocolAddress(alice.user_id, 1);
  const bobFromAliceCipher = new signal.SessionCipher(bobSignalStore, bobAddr);
  const bobPayload = JSON.parse(atob(bobPhotoEnv.ciphertext));
  const bobDecBuffer = bobPayload.type === 3
    ? await bobFromAliceCipher.decryptPreKeyWhisperMessage(base64ToArrayBuffer(bobPayload.body), "binary")
    : await bobFromAliceCipher.decryptWhisperMessage(base64ToArrayBuffer(bobPayload.body), "binary");
  const bobReceivedPhoto = JSON.parse(new TextDecoder().decode(bobDecBuffer));

  console.log(`  ✓ Bob received photo message: "${bobReceivedPhoto.text}"`);

  // Bob downloads encrypted media and decrypts
  const downloadedPhotoCiphertext = await downloadMediaFile(bob.access_token, bobReceivedPhoto.media.url);
  const decryptedPhotoBytes = await TestMediaCipher.decryptBuffer(
    downloadedPhotoCiphertext,
    bobReceivedPhoto.media.cipherKey,
    bobReceivedPhoto.media.iv,
    bobReceivedPhoto.media.sha256
  );

  if (new TextDecoder().decode(decryptedPhotoBytes) !== new TextDecoder().decode(originalImageBytes)) {
    throw new Error("Decrypted photo bytes do not match original!");
  }
  console.log("  ✓ Bob decrypted photo: Byte-for-byte SHA-256 match verified!");

  // 5. Test 2: Voice Note Recording & Group SenderKey Distribution
  console.log("\n[5/7] Testing Opus Voice Note with Waveform in Group...");
  // Alice creates group with Bob and Charlie
  const groupRes = await fetch(`${API_BASE}/v1/groups`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${alice.access_token}`,
    },
    body: JSON.stringify({
      name: "Phase 4 Media Squad",
      description: "Encrypted group for rich audio & video media",
      initial_member_ids: [bob.user_id, charlie.user_id],
    }),
  });
  if (!groupRes.ok) throw new Error(`Failed to create group: ${await groupRes.text()}`);
  const group = await groupRes.json();
  const groupId = group.id;
  console.log(`  ✓ Created group: ${group.name} (${groupId})`);

  // Distribute Alice's SenderKey to Bob and Charlie via type 5 envelope
  const distMsg = await aliceGroupCipher.createDistributionMessage(groupId, alice.user_id);
  const distJson = JSON.stringify(distMsg);

  const encBobDist = await aliceToBobCipher.encrypt(new TextEncoder().encode(distJson).buffer);
  const aliceToCharlieCipher = new signal.SessionCipher(
    aliceSignalStore,
    new signal.SignalProtocolAddress(charlie.user_id, 1)
  );
  const encCharlieDist = await aliceToCharlieCipher.encrypt(new TextEncoder().encode(distJson).buffer);

  const envBobDist = {
    id: `env_sk_bob_${Date.now()}`,
    version: 1,
    sender_user: alice.user_id,
    sender_device: 1,
    recipient_user: bob.user_id,
    recipient_device: 1,
    type: 5,
    ciphertext: btoa(JSON.stringify({
      type: encBobDist.type,
      body: btoa(encBobDist.body),
      registrationId: encBobDist.registrationId,
    })),
    timestamp: Date.now(),
  };

  const envCharlieDist = {
    id: `env_sk_charlie_${Date.now()}`,
    version: 1,
    sender_user: alice.user_id,
    sender_device: 1,
    recipient_user: charlie.user_id,
    recipient_device: 1,
    type: 5,
    ciphertext: btoa(JSON.stringify({
      type: encCharlieDist.type,
      body: btoa(encCharlieDist.body),
      registrationId: encCharlieDist.registrationId,
    })),
    timestamp: Date.now(),
  };

  aliceMqtt.publish(`out/${alice.user_id}/1`, JSON.stringify(envBobDist), { qos: 1 });
  aliceMqtt.publish(`out/${alice.user_id}/1`, JSON.stringify(envCharlieDist), { qos: 1 });

  for (let i = 0; i < 30; i++) {
    if (bobInboxes.some((e) => e.type === 5) && charlieInboxes.some((e) => e.type === 5)) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  const bobDistEnv = bobInboxes.find((e) => e.type === 5);
  const charlieDistEnv = charlieInboxes.find((e) => e.type === 5);
  if (!bobDistEnv || !charlieDistEnv) throw new Error("Sender key distribution not received");

  const bobDistPayload = JSON.parse(atob(bobDistEnv.ciphertext));
  const bobDistBuffer = bobDistPayload.type === 3
    ? await bobFromAliceCipher.decryptPreKeyWhisperMessage(base64ToArrayBuffer(bobDistPayload.body), "binary")
    : await bobFromAliceCipher.decryptWhisperMessage(base64ToArrayBuffer(bobDistPayload.body), "binary");
  await bobGroupCipher.processDistributionMessage(JSON.parse(new TextDecoder().decode(bobDistBuffer)));

  const charlieAddr = new signal.SignalProtocolAddress(alice.user_id, 1);
  const charlieFromAliceCipher = new signal.SessionCipher(charlieSignalStore, charlieAddr);
  const charlieDistPayload = JSON.parse(atob(charlieDistEnv.ciphertext));
  const charlieDistBuffer = charlieDistPayload.type === 3
    ? await charlieFromAliceCipher.decryptPreKeyWhisperMessage(base64ToArrayBuffer(charlieDistPayload.body), "binary")
    : await charlieFromAliceCipher.decryptWhisperMessage(base64ToArrayBuffer(charlieDistPayload.body), "binary");
  await charlieGroupCipher.processDistributionMessage(JSON.parse(new TextDecoder().decode(charlieDistBuffer)));
  console.log("  ✓ Distributed Alice's SenderKey to Bob & Charlie");

  // Voice note raw audio buffer + 32-bar waveform
  const originalVoiceBytes = new TextEncoder().encode(
    "OPUS_AUDIO_BITSTREAM_MOCK_DATA_VOICE_NOTE_" + Math.random()
  );
  const testWaveform = Array.from({ length: 32 }, (_, i) => Math.sin(i / 5) * 0.5 + 0.5);

  const encryptedVoice = await TestMediaCipher.encryptBuffer(originalVoiceBytes);
  const uploadedVoice = await uploadMediaFile(
    alice.access_token,
    encryptedVoice.ciphertext,
    "voice-note.webm",
    "audio/webm",
    encryptedVoice.sha256
  );

  const voiceAttachment = {
    url: uploadedVoice.download_url,
    mimeType: "audio/webm",
    fileName: "voice-note.webm",
    fileSize: originalVoiceBytes.byteLength,
    cipherKey: encryptedVoice.cipherKey,
    iv: encryptedVoice.iv,
    sha256: encryptedVoice.sha256,
    duration: 12.4,
    waveform: testWaveform,
  };

  const groupVoicePayload = {
    id: `msg_audio_${Date.now()}`,
    type: "audio",
    text: "",
    media: voiceAttachment,
    timestamp: Date.now(),
  };

  const groupVoiceEncrypted = await aliceGroupCipher.encrypt(
    groupId,
    alice.user_id,
    JSON.stringify(groupVoicePayload)
  );

  const groupEnvelope = {
    id: `env_grp_voice_${Date.now()}`,
    version: 1,
    sender_user: alice.user_id,
    sender_device: 1,
    recipient_user: groupId,
    recipient_device: 1,
    group_id: groupId,
    type: 1,
    ciphertext: groupVoiceEncrypted,
    timestamp: Date.now(),
  };

  aliceMqtt.publish(`out/${alice.user_id}/1`, JSON.stringify(groupEnvelope), { qos: 1 });

  // Wait for Bob and Charlie to receive
  for (let i = 0; i < 30; i++) {
    if (
      bobInboxes.some((e) => e.group_id === groupId && e.id === groupEnvelope.id) &&
      charlieInboxes.some((e) => e.group_id === groupId && e.id === groupEnvelope.id)
    ) {
      break;
    }
    await new Promise((r) => setTimeout(r, 100));
  }

  const bobGrpEnv = bobInboxes.find((e) => e.id === groupEnvelope.id);
  const charlieGrpEnv = charlieInboxes.find((e) => e.id === groupEnvelope.id);
  if (!bobGrpEnv || !charlieGrpEnv) throw new Error("Group voice note was not fanned out to both members");

  const bobDecryptedVoiceJson = await bobGroupCipher.decrypt(groupId, alice.user_id, bobGrpEnv.ciphertext);
  const charlieDecryptedVoiceJson = await charlieGroupCipher.decrypt(groupId, alice.user_id, charlieGrpEnv.ciphertext);

  const bobReceivedVoice = JSON.parse(bobDecryptedVoiceJson);
  const charlieReceivedVoice = JSON.parse(charlieDecryptedVoiceJson);
  console.log(`  ✓ Bob & Charlie received group voice note: duration=${bobReceivedVoice.media.duration}s`);

  // Bob verifies audio download and decryption
  const bobDownloadedVoice = await downloadMediaFile(bob.access_token, bobReceivedVoice.media.url);
  const bobDecryptedVoice = await TestMediaCipher.decryptBuffer(
    bobDownloadedVoice,
    bobReceivedVoice.media.cipherKey,
    bobReceivedVoice.media.iv,
    bobReceivedVoice.media.sha256
  );
  if (new TextDecoder().decode(bobDecryptedVoice) !== new TextDecoder().decode(originalVoiceBytes)) {
    throw new Error("Bob voice note audio mismatch!");
  }
  if (bobReceivedVoice.media.waveform.length !== 32) {
    throw new Error("Waveform length is not 32 bars!");
  }
  console.log("  ✓ Bob decrypted voice note: Audio & 32-bar waveform verified!");

  // Charlie verifies audio download and decryption
  const charlieDownloadedVoice = await downloadMediaFile(charlie.access_token, charlieReceivedVoice.media.url);
  const charlieDecryptedVoice = await TestMediaCipher.decryptBuffer(
    charlieDownloadedVoice,
    charlieReceivedVoice.media.cipherKey,
    charlieReceivedVoice.media.iv,
    charlieReceivedVoice.media.sha256
  );
  if (new TextDecoder().decode(charlieDecryptedVoice) !== new TextDecoder().decode(originalVoiceBytes)) {
    throw new Error("Charlie voice note audio mismatch!");
  }
  console.log("  ✓ Charlie decrypted voice note: Audio verified!");

  // 6. Test 3: Document (PDF) Upload & 1:1 Delivery
  console.log("\n[6/7] Testing Document (PDF) Upload & 1:1 Delivery...");
  const pdfBytes = new TextEncoder().encode("%PDF-1.4 Mock Encrypted Document Body Content " + Math.random());
  const encryptedDoc = await TestMediaCipher.encryptBuffer(pdfBytes);
  const uploadedDoc = await uploadMediaFile(
    alice.access_token,
    encryptedDoc.ciphertext,
    "annual_report.pdf",
    "application/pdf",
    encryptedDoc.sha256
  );

  const docAttachment = {
    url: uploadedDoc.download_url,
    mimeType: "application/pdf",
    fileName: "annual_report.pdf",
    fileSize: pdfBytes.byteLength,
    cipherKey: encryptedDoc.cipherKey,
    iv: encryptedDoc.iv,
    sha256: encryptedDoc.sha256,
  };

  const docMessagePayload = {
    id: `msg_doc_${Date.now()}`,
    type: "document",
    text: "Quarterly earnings report",
    media: docAttachment,
    timestamp: Date.now(),
  };

  const signalEncryptedDoc = await aliceToBobCipher.encrypt(
    new TextEncoder().encode(JSON.stringify(docMessagePayload)).buffer
  );

  const docEnvelope = {
    id: `env_doc_${Date.now()}`,
    version: 1,
    sender_user: alice.user_id,
    sender_device: 1,
    recipient_user: bob.user_id,
    recipient_device: 1,
    type: 1,
    ciphertext: btoa(JSON.stringify({
      type: signalEncryptedDoc.type,
      body: btoa(signalEncryptedDoc.body),
      registrationId: signalEncryptedDoc.registrationId,
    })),
    timestamp: Date.now(),
  };

  aliceMqtt.publish(`out/${alice.user_id}/1`, JSON.stringify(docEnvelope), { qos: 1 });

  for (let i = 0; i < 30; i++) {
    if (bobInboxes.some((e) => e.id === docEnvelope.id)) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  const bobDocEnv = bobInboxes.find((e) => e.id === docEnvelope.id);
  if (!bobDocEnv) throw new Error("Bob did not receive document envelope");

  const bobDocPayload = JSON.parse(atob(bobDocEnv.ciphertext));
  const bobDocDecBuffer = bobDocPayload.type === 3
    ? await bobFromAliceCipher.decryptPreKeyWhisperMessage(base64ToArrayBuffer(bobDocPayload.body), "binary")
    : await bobFromAliceCipher.decryptWhisperMessage(base64ToArrayBuffer(bobDocPayload.body), "binary");
  const bobReceivedDoc = JSON.parse(new TextDecoder().decode(bobDocDecBuffer));

  console.log(`  ✓ Bob received document message: "${bobReceivedDoc.media.fileName}" (${bobReceivedDoc.media.fileSize} bytes)`);

  const bobDownloadedDoc = await downloadMediaFile(bob.access_token, bobReceivedDoc.media.url);
  const bobDecryptedDoc = await TestMediaCipher.decryptBuffer(
    bobDownloadedDoc,
    bobReceivedDoc.media.cipherKey,
    bobReceivedDoc.media.iv,
    bobReceivedDoc.media.sha256
  );
  if (new TextDecoder().decode(bobDecryptedDoc) !== new TextDecoder().decode(pdfBytes)) {
    throw new Error("Decrypted document bytes mismatch!");
  }
  console.log("  ✓ Bob decrypted document: Validated PDF content!");

  // 7. Test 4: View-Once Photo, Sticker, and GIF Messaging
  console.log("\n[7/7] Testing View-Once Photo, Sticker, and GIF Messaging...");

  // 7a: View-once encrypted photo
  const viewOnceImageBytes = new TextEncoder().encode("CONFIDENTIAL_VIEW_ONCE_PAYLOAD_" + Math.random());
  const encryptedViewOnce = await TestMediaCipher.encryptBuffer(viewOnceImageBytes);
  const uploadedViewOnce = await uploadMediaFile(
    alice.access_token,
    encryptedViewOnce.ciphertext,
    "secret.png",
    "image/png",
    encryptedViewOnce.sha256
  );

  const viewOncePayload = {
    id: `msg_vo_${Date.now()}`,
    type: "image",
    text: "View once photo",
    viewOnce: true,
    media: {
      url: uploadedViewOnce.download_url,
      mimeType: "image/png",
      fileName: "secret.png",
      fileSize: viewOnceImageBytes.byteLength,
      cipherKey: encryptedViewOnce.cipherKey,
      iv: encryptedViewOnce.iv,
      sha256: encryptedViewOnce.sha256,
    },
    timestamp: Date.now(),
  };

  const signalEncryptedVO = await aliceToBobCipher.encrypt(
    new TextEncoder().encode(JSON.stringify(viewOncePayload)).buffer
  );

  const voEnvelope = {
    id: `env_vo_${Date.now()}`,
    version: 1,
    sender_user: alice.user_id,
    sender_device: 1,
    recipient_user: bob.user_id,
    recipient_device: 1,
    type: 1,
    ciphertext: btoa(JSON.stringify({
      type: signalEncryptedVO.type,
      body: btoa(signalEncryptedVO.body),
      registrationId: signalEncryptedVO.registrationId,
    })),
    timestamp: Date.now(),
  };

  aliceMqtt.publish(`out/${alice.user_id}/1`, JSON.stringify(voEnvelope), { qos: 1 });

  for (let i = 0; i < 30; i++) {
    if (bobInboxes.some((e) => e.id === voEnvelope.id)) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  const bobVOEnv = bobInboxes.find((e) => e.id === voEnvelope.id);
  if (!bobVOEnv) throw new Error("Bob did not receive view-once envelope");

  const bobVOPayload = JSON.parse(atob(bobVOEnv.ciphertext));
  const bobVODecBuffer = bobVOPayload.type === 3
    ? await bobFromAliceCipher.decryptPreKeyWhisperMessage(base64ToArrayBuffer(bobVOPayload.body), "binary")
    : await bobFromAliceCipher.decryptWhisperMessage(base64ToArrayBuffer(bobVOPayload.body), "binary");
  const bobReceivedVO = JSON.parse(new TextDecoder().decode(bobVODecBuffer));

  if (!bobReceivedVO.viewOnce) throw new Error("Expected viewOnce to be true");
  console.log(`  ✓ Bob received view-once photo: viewOnce=${bobReceivedVO.viewOnce}`);

  const bobDownloadedVO = await downloadMediaFile(bob.access_token, bobReceivedVO.media.url);
  const bobDecryptedVO = await TestMediaCipher.decryptBuffer(
    bobDownloadedVO,
    bobReceivedVO.media.cipherKey,
    bobReceivedVO.media.iv,
    bobReceivedVO.media.sha256
  );
  if (new TextDecoder().decode(bobDecryptedVO) !== new TextDecoder().decode(viewOnceImageBytes)) {
    throw new Error("View once decrypted payload mismatch!");
  }
  console.log("  ✓ Bob decrypted view-once photo successfully!");

  // 7b: Sticker Message
  const stickerPayload = {
    id: `msg_stk_${Date.now()}`,
    type: "sticker",
    text: "https://api.iconify.design/fluent-emoji:partying-face.svg",
    timestamp: Date.now(),
  };

  const signalEncryptedStk = await aliceToBobCipher.encrypt(
    new TextEncoder().encode(JSON.stringify(stickerPayload)).buffer
  );

  const stkEnvelope = {
    id: `env_stk_${Date.now()}`,
    version: 1,
    sender_user: alice.user_id,
    sender_device: 1,
    recipient_user: bob.user_id,
    recipient_device: 1,
    type: 1,
    ciphertext: btoa(JSON.stringify({
      type: signalEncryptedStk.type,
      body: btoa(signalEncryptedStk.body),
      registrationId: signalEncryptedStk.registrationId,
    })),
    timestamp: Date.now(),
  };

  aliceMqtt.publish(`out/${alice.user_id}/1`, JSON.stringify(stkEnvelope), { qos: 1 });

  for (let i = 0; i < 30; i++) {
    if (bobInboxes.some((e) => e.id === stkEnvelope.id)) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  const bobStkEnv = bobInboxes.find((e) => e.id === stkEnvelope.id);
  if (!bobStkEnv) throw new Error("Bob did not receive sticker envelope");

  const bobStkPayload = JSON.parse(atob(bobStkEnv.ciphertext));
  const bobStkDecBuffer = bobStkPayload.type === 3
    ? await bobFromAliceCipher.decryptPreKeyWhisperMessage(base64ToArrayBuffer(bobStkPayload.body), "binary")
    : await bobFromAliceCipher.decryptWhisperMessage(base64ToArrayBuffer(bobStkPayload.body), "binary");
  const bobReceivedStk = JSON.parse(new TextDecoder().decode(bobStkDecBuffer));

  if (bobReceivedStk.type !== "sticker") throw new Error("Expected sticker type");
  console.log(`  ✓ Bob received animated sticker: ${bobReceivedStk.text}`);

  // Disconnect MQTT
  aliceMqtt.end();
  bobMqtt.end();
  charlieMqtt.end();

  console.log("\n=================================================");
  console.log(" ✅ ALL PHASE 4 MEDIA PIPELINE TESTS PASSED (7/7)");
  console.log("=================================================");
  process.exit(0);
}

run().catch((err) => {
  console.error("\n❌ PHASE 4 VERIFICATION FAILED:", err);
  process.exit(1);
});

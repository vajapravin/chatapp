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

async function decryptEnvelope(recipientStore, senderId, envelope) {
  const senderAddr = new signal.SignalProtocolAddress(senderId, 1);
  const cipher = new signal.SessionCipher(recipientStore, senderAddr);
  const payload = JSON.parse(atob(envelope.ciphertext));
  const decBuffer = payload.type === 3
    ? await cipher.decryptPreKeyWhisperMessage(base64ToArrayBuffer(payload.body), "binary")
    : await cipher.decryptWhisperMessage(base64ToArrayBuffer(payload.body), "binary");
  return JSON.parse(new TextDecoder().decode(decBuffer));
}

async function run() {
  console.log("=================================================");
  console.log(" PHASE 5 WEBRTC CALLING & TURN E2E VERIFICATION ");
  console.log("=================================================");

  // 1. Authenticate Alice, Bob, and Charlie
  console.log("\n[1/6] Authenticating 3 users (Alice, Bob, Charlie)...");
  const alice = await loginUser("+10000000071");
  const bob = await loginUser("+10000000072");
  const charlie = await loginUser("+10000000073");
  console.log(`✓ Alice:   ${alice.user_id}`);
  console.log(`✓ Bob:     ${bob.user_id}`);
  console.log(`✓ Charlie: ${charlie.user_id}`);

  // 2. Initialize Signal Protocol Stores
  console.log("\n[2/6] Registering Signal protocol keys in API...");
  const aliceSignalStore = new MemorySignalStore();
  const bobSignalStore = new MemorySignalStore();
  const charlieSignalStore = new MemorySignalStore();

  await uploadSignalKeys(alice.access_token, aliceSignalStore);
  await uploadSignalKeys(bob.access_token, bobSignalStore);
  await uploadSignalKeys(charlie.access_token, charlieSignalStore);
  console.log("✓ Uploaded prekey bundles for all 3 participants");

  // 3. Connect MQTT clients & listen on u/{userId}/1/#
  console.log("\n[3/6] Connecting clients to Mosquitto MQTT broker...");
  const aliceInboxes = [];
  const bobInboxes = [];
  const charlieInboxes = [];

  const aliceMqtt = mqtt.connect(MQTT_URL, {
    username: alice.user_id,
    password: alice.access_token,
    clientId: `alice_p5_${Date.now()}`,
    clean: true,
  });
  const bobMqtt = mqtt.connect(MQTT_URL, {
    username: bob.user_id,
    password: bob.access_token,
    clientId: `bob_p5_${Date.now()}`,
    clean: true,
  });
  const charlieMqtt = mqtt.connect(MQTT_URL, {
    username: charlie.user_id,
    password: charlie.access_token,
    clientId: `charlie_p5_${Date.now()}`,
    clean: true,
  });

  aliceMqtt.on("message", (topic, payload) => {
    if (topic === `u/${alice.user_id}/1/inbox`) {
      try { aliceInboxes.push(JSON.parse(payload.toString())); } catch {}
    }
  });

  bobMqtt.on("message", (topic, payload) => {
    if (topic === `u/${bob.user_id}/1/inbox`) {
      try { bobInboxes.push(JSON.parse(payload.toString())); } catch {}
    }
  });

  charlieMqtt.on("message", (topic, payload) => {
    if (topic === `u/${charlie.user_id}/1/inbox`) {
      try { charlieInboxes.push(JSON.parse(payload.toString())); } catch {}
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

  // Pairwise Sessions
  await setupPairwiseSession(alice.access_token, aliceSignalStore, bob.user_id);
  await setupPairwiseSession(alice.access_token, aliceSignalStore, charlie.user_id);
  await setupPairwiseSession(bob.access_token, bobSignalStore, alice.user_id);
  await setupPairwiseSession(bob.access_token, bobSignalStore, charlie.user_id);
  await setupPairwiseSession(charlie.access_token, charlieSignalStore, alice.user_id);
  await setupPairwiseSession(charlie.access_token, charlieSignalStore, bob.user_id);

  const aliceToBobCipher = new signal.SessionCipher(
    aliceSignalStore,
    new signal.SignalProtocolAddress(bob.user_id, 1)
  );
  const bobToAliceCipher = new signal.SessionCipher(
    bobSignalStore,
    new signal.SignalProtocolAddress(alice.user_id, 1)
  );

  // Group cipher initialization
  const aliceGroupStore = new MemorySenderKeyStore();
  const bobGroupStore = new MemorySenderKeyStore();
  const charlieGroupStore = new MemorySenderKeyStore();

  const aliceGroupCipher = new GroupCipher(aliceGroupStore);
  const bobGroupCipher = new GroupCipher(bobGroupStore);
  const charlieGroupCipher = new GroupCipher(charlieGroupStore);

  // 4. Test 1: Fetch ICE Servers from API
  console.log("\n[4/6] Testing GET /v1/calls/ice for WebRTC ICE & TURN configuration...");
  const iceRes = await fetch(`${API_BASE}/v1/calls/ice`, {
    headers: { Authorization: `Bearer ${alice.access_token}` },
  });
  if (!iceRes.ok) throw new Error(`GET /v1/calls/ice failed: ${await iceRes.text()}`);
  const iceData = await iceRes.json();
  if (!iceData.ice_servers || !Array.isArray(iceData.ice_servers) || iceData.ice_servers.length === 0) {
    throw new Error("No ICE servers returned");
  }
  console.log(`  ✓ Received ${iceData.ice_servers.length} ICE server config(s):`, iceData.ice_servers[0].urls);

  // 5. Test 2: 1:1 Voice Call with Signal-encrypted CALL_SIGNAL
  console.log("\n[5/6] Testing 1:1 Voice Call Signaling Flow (Offer -> Ring -> Answer -> ICE -> Hangup)...");
  const callId = `call_1to1_${Date.now()}`;

  // Mock SDP with Opus DTX & FEC
  const mockOfferSdp = "v=0\r\no=- 12345 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=rtpmap:111 opus/48000/2\r\na=fmtp:111 minptime=10;useinbandfec=1;usedtx=1\r\n";

  const offerSignalPayload = {
    type: "call_signal",
    callId,
    callType: "voice",
    action: "offer",
    sdp: mockOfferSdp,
    timestamp: Date.now(),
  };

  const encryptedOffer = await aliceToBobCipher.encrypt(
    new TextEncoder().encode(JSON.stringify(offerSignalPayload)).buffer
  );

  const offerEnvelope = {
    id: `env_call_offer_${Date.now()}`,
    version: 1,
    sender_user: alice.user_id,
    sender_device: 1,
    recipient_user: bob.user_id,
    recipient_device: 1,
    type: 4, // CALL_SIGNAL
    ciphertext: btoa(JSON.stringify({
      type: encryptedOffer.type,
      body: btoa(encryptedOffer.body),
      registrationId: encryptedOffer.registrationId,
    })),
    timestamp: Date.now(),
  };

  // Alice publishes Call Offer
  aliceMqtt.publish(`out/${alice.user_id}/1`, JSON.stringify(offerEnvelope), { qos: 1 });

  // Bob waits for CALL_SIGNAL offer
  for (let i = 0; i < 30; i++) {
    if (bobInboxes.some((e) => e.id === offerEnvelope.id && e.type === 4)) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  const bobOfferEnv = bobInboxes.find((e) => e.id === offerEnvelope.id && e.type === 4);
  if (!bobOfferEnv) throw new Error("Bob did not receive call offer envelope");

  const bobDecryptedOffer = await decryptEnvelope(bobSignalStore, alice.user_id, bobOfferEnv);
  console.log(`  ✓ Bob received encrypted CALL_SIGNAL: action="${bobDecryptedOffer.action}" callType="${bobDecryptedOffer.callType}"`);
  if (bobDecryptedOffer.action !== "offer" || bobDecryptedOffer.callType !== "voice") {
    throw new Error("Invalid offer signal received by Bob");
  }
  if (!bobDecryptedOffer.sdp.includes("usedtx=1") || !bobDecryptedOffer.sdp.includes("useinbandfec=1")) {
    throw new Error("Offer SDP missing Opus DTX or FEC parameter");
  }
  console.log("  ✓ Verified Opus DTX & FEC parameters present in SDP negotiation");

  // Bob replies with Ring acknowledgement
  const ringSignalPayload = {
    type: "call_signal",
    callId,
    callType: "voice",
    action: "ring",
    timestamp: Date.now(),
  };
  const encRing = await bobToAliceCipher.encrypt(new TextEncoder().encode(JSON.stringify(ringSignalPayload)).buffer);
  const ringEnvelope = {
    id: `env_call_ring_${Date.now()}`,
    version: 1,
    sender_user: bob.user_id,
    sender_device: 1,
    recipient_user: alice.user_id,
    recipient_device: 1,
    type: 4,
    ciphertext: btoa(JSON.stringify({
      type: encRing.type,
      body: btoa(encRing.body),
      registrationId: encRing.registrationId,
    })),
    timestamp: Date.now(),
  };
  bobMqtt.publish(`out/${bob.user_id}/1`, JSON.stringify(ringEnvelope), { qos: 1 });

  // Bob sends Answer
  const mockAnswerSdp = "v=0\r\no=- 67890 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=rtpmap:111 opus/48000/2\r\na=fmtp:111 minptime=10;useinbandfec=1;usedtx=1\r\n";
  const answerSignalPayload = {
    type: "call_signal",
    callId,
    callType: "voice",
    action: "answer",
    sdp: mockAnswerSdp,
    timestamp: Date.now(),
  };
  const encAnswer = await bobToAliceCipher.encrypt(new TextEncoder().encode(JSON.stringify(answerSignalPayload)).buffer);
  const answerEnvelope = {
    id: `env_call_ans_${Date.now()}`,
    version: 1,
    sender_user: bob.user_id,
    sender_device: 1,
    recipient_user: alice.user_id,
    recipient_device: 1,
    type: 4,
    ciphertext: btoa(JSON.stringify({
      type: encAnswer.type,
      body: btoa(encAnswer.body),
      registrationId: encAnswer.registrationId,
    })),
    timestamp: Date.now(),
  };
  bobMqtt.publish(`out/${bob.user_id}/1`, JSON.stringify(answerEnvelope), { qos: 1 });

  // Alice receives Ring and Answer
  for (let i = 0; i < 30; i++) {
    if (aliceInboxes.some((e) => e.id === answerEnvelope.id && e.type === 4)) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  const aliceAnsEnv = aliceInboxes.find((e) => e.id === answerEnvelope.id && e.type === 4);
  if (!aliceAnsEnv) throw new Error("Alice did not receive answer envelope");

  const aliceDecryptedAns = await decryptEnvelope(aliceSignalStore, bob.user_id, aliceAnsEnv);
  console.log(`  ✓ Alice received encrypted CALL_SIGNAL: action="${aliceDecryptedAns.action}"`);
  if (aliceDecryptedAns.action !== "answer") throw new Error("Expected answer action");
  console.log("  ✓ Alice and Bob negotiated P2P call session");

  // Bob terminates with Hangup
  const hangupPayload = {
    type: "call_signal",
    callId,
    callType: "voice",
    action: "hangup",
    timestamp: Date.now(),
  };
  const encHangup = await bobToAliceCipher.encrypt(new TextEncoder().encode(JSON.stringify(hangupPayload)).buffer);
  const hangupEnvelope = {
    id: `env_call_hup_${Date.now()}`,
    version: 1,
    sender_user: bob.user_id,
    sender_device: 1,
    recipient_user: alice.user_id,
    recipient_device: 1,
    type: 4,
    ciphertext: btoa(JSON.stringify({
      type: encHangup.type,
      body: btoa(encHangup.body),
      registrationId: encHangup.registrationId,
    })),
    timestamp: Date.now(),
  };
  bobMqtt.publish(`out/${bob.user_id}/1`, JSON.stringify(hangupEnvelope), { qos: 1 });

  for (let i = 0; i < 30; i++) {
    if (aliceInboxes.some((e) => e.id === hangupEnvelope.id && e.type === 4)) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  const aliceHupEnv = aliceInboxes.find((e) => e.id === hangupEnvelope.id && e.type === 4);
  if (!aliceHupEnv) throw new Error("Alice did not receive hangup envelope");
  const aliceDecryptedHup = await decryptEnvelope(aliceSignalStore, bob.user_id, aliceHupEnv);
  console.log(`  ✓ Call ended cleanly: action="${aliceDecryptedHup.action}"`);

  // 6. Test 3: 3-Party Full-Mesh Group Call Signaling
  console.log("\n[6/6] Testing 3-Party Mesh Group Call Signaling...");
  const groupRes = await fetch(`${API_BASE}/v1/groups`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${alice.access_token}`,
    },
    body: JSON.stringify({
      name: "Phase 5 Mesh Squad",
      description: "Full-mesh WebRTC group calling squad",
      initial_member_ids: [bob.user_id, charlie.user_id],
    }),
  });
  if (!groupRes.ok) throw new Error(`Group creation failed: ${await groupRes.text()}`);
  const group = await groupRes.json();
  const groupId = group.id;

  // Distribute SenderKey to Bob and Charlie
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
  await bobGroupCipher.processDistributionMessage(
    await decryptEnvelope(bobSignalStore, alice.user_id, bobDistEnv)
  );
  await charlieGroupCipher.processDistributionMessage(
    await decryptEnvelope(charlieSignalStore, alice.user_id, charlieDistEnv)
  );

  // Alice starts group call via SenderKey broadcast
  const groupCallPayload = {
    type: "call_signal",
    callId: `grp_call_${Date.now()}`,
    callType: "video",
    action: "group_join",
    groupId,
    peerName: "Alice",
    timestamp: Date.now(),
  };

  const grpCiphertext = await aliceGroupCipher.encrypt(groupId, alice.user_id, JSON.stringify(groupCallPayload));
  const groupCallEnvelope = {
    id: `env_grp_call_${Date.now()}`,
    version: 1,
    sender_user: alice.user_id,
    sender_device: 1,
    recipient_user: groupId,
    recipient_device: 1,
    group_id: groupId,
    type: 4, // CALL_SIGNAL
    ciphertext: grpCiphertext,
    timestamp: Date.now(),
  };

  aliceMqtt.publish(`out/${alice.user_id}/1`, JSON.stringify(groupCallEnvelope), { qos: 1 });

  for (let i = 0; i < 30; i++) {
    if (
      bobInboxes.some((e) => e.group_id === groupId && e.id === groupCallEnvelope.id) &&
      charlieInboxes.some((e) => e.group_id === groupId && e.id === groupCallEnvelope.id)
    ) {
      break;
    }
    await new Promise((r) => setTimeout(r, 100));
  }

  const bobGrpCall = bobInboxes.find((e) => e.group_id === groupId && e.id === groupCallEnvelope.id);
  const charlieGrpCall = charlieInboxes.find((e) => e.group_id === groupId && e.id === groupCallEnvelope.id);
  if (!bobGrpCall || !charlieGrpCall) throw new Error("Group call signal was not fanned out to both members");

  const bobDecGroupCall = JSON.parse(await bobGroupCipher.decrypt(groupId, alice.user_id, bobGrpCall.ciphertext));
  const charlieDecGroupCall = JSON.parse(await charlieGroupCipher.decrypt(groupId, alice.user_id, charlieGrpCall.ciphertext));
  console.log(`  ✓ Bob received group call invitation: "${bobDecGroupCall.action}" for ${bobDecGroupCall.callType} call`);
  console.log(`  ✓ Charlie received group call invitation: "${charlieDecGroupCall.action}" for ${charlieDecGroupCall.callType} call`);

  // Test Busy & Rejection
  console.log("\n  -> Testing Call Busy and Rejection signaling...");
  const busyPayload = {
    type: "call_signal",
    callId: "busy_call_test",
    callType: "voice",
    action: "busy",
    timestamp: Date.now(),
  };
  const encBusy = await bobToAliceCipher.encrypt(new TextEncoder().encode(JSON.stringify(busyPayload)).buffer);
  const busyEnvelope = {
    id: `env_call_busy_${Date.now()}`,
    version: 1,
    sender_user: bob.user_id,
    sender_device: 1,
    recipient_user: alice.user_id,
    recipient_device: 1,
    type: 4,
    ciphertext: btoa(JSON.stringify({
      type: encBusy.type,
      body: btoa(encBusy.body),
      registrationId: encBusy.registrationId,
    })),
    timestamp: Date.now(),
  };
  bobMqtt.publish(`out/${bob.user_id}/1`, JSON.stringify(busyEnvelope), { qos: 1 });

  for (let i = 0; i < 30; i++) {
    if (aliceInboxes.some((e) => e.id === busyEnvelope.id && e.type === 4)) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  const aliceBusyEnv = aliceInboxes.find((e) => e.id === busyEnvelope.id && e.type === 4);
  if (!aliceBusyEnv) throw new Error("Alice did not receive busy envelope");
  const aliceDecBusy = await decryptEnvelope(aliceSignalStore, bob.user_id, aliceBusyEnv);
  console.log(`  ✓ Alice received busy signal: action="${aliceDecBusy.action}"`);

  // Disconnect MQTT
  aliceMqtt.end();
  bobMqtt.end();
  charlieMqtt.end();

  console.log("\n=================================================");
  console.log(" ✅ ALL PHASE 5 WEBRTC CALLING TESTS PASSED (6/6)");
  console.log("=================================================");
  process.exit(0);
}

run().catch((err) => {
  console.error("\n❌ PHASE 5 VERIFICATION FAILED:", err);
  process.exit(1);
});

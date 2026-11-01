import * as signal from "@privacyresearch/libsignal-protocol-typescript";
import mqtt from "mqtt";
import { execSync } from "child_process";

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

class MemoryStore {
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

async function loginUser(phoneNumber) {
  await fetch(`${API_BASE}/v1/auth/otp/request`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone_number: phoneNumber }),
  });

  let code = "123456";
  try {
    const raw = execSync(`sudo docker exec redis redis-cli -p 6380 get "otp:${phoneNumber}"`).toString().trim();
    if (raw) {
      const data = JSON.parse(raw);
      if (data.code) code = data.code;
    }
  } catch {}

  const res = await fetch(`${API_BASE}/v1/auth/otp/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone_number: phoneNumber, code }),
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

async function runTest() {
  console.log("=== PHASE 2 E2EE INTEGRATION TEST ===");

  // 1. Authenticate Alice & Bob
  console.log("[1/9] Logging in Alice and Bob...");
  const aliceAuth = await loginUser("+10000000001");
  const bobAuth = await loginUser("+10000000002");
  console.log(`✓ Alice authenticated: ${aliceAuth.user_id}`);
  console.log(`✓ Bob authenticated: ${bobAuth.user_id}`);

  // 2. Initialize Signal Stores & Upload Keys
  console.log("[2/9] Registering Signal protocol keys in API...");
  const aliceStore = new MemoryStore();
  const bobStore = new MemoryStore();

  await uploadSignalKeys(aliceAuth.access_token, aliceStore);
  await uploadSignalKeys(bobAuth.access_token, bobStore);
  console.log("✓ Signal keys registered for both Alice and Bob");

  // 3. Connect to MQTT
  console.log("[3/9] Connecting clients to MQTT broker...");
  const aliceMqtt = mqtt.connect(MQTT_URL, {
    username: aliceAuth.user_id,
    password: aliceAuth.access_token,
    clientId: `test_alice_${Date.now()}`,
    clean: true,
  });

  const bobMqtt = mqtt.connect(MQTT_URL, {
    username: bobAuth.user_id,
    password: bobAuth.access_token,
    clientId: `test_bob_${Date.now()}`,
    clean: true,
  });

  await Promise.all([
    new Promise((resolve) => aliceMqtt.on("connect", resolve)),
    new Promise((resolve) => bobMqtt.on("connect", resolve)),
  ]);
  console.log("✓ Both clients connected to MQTT");

  // 4. Subscriptions
  await new Promise((resolve) => aliceMqtt.subscribe(`u/${aliceAuth.user_id}/1/#`, resolve));
  await new Promise((resolve) => aliceMqtt.subscribe("p/#", resolve));
  await new Promise((resolve) => bobMqtt.subscribe(`u/${bobAuth.user_id}/1/#`, resolve));
  await new Promise((resolve) => bobMqtt.subscribe("p/#", resolve));
  console.log("✓ MQTT subscriptions active");

  // Track received events
  let aliceServerAck = null;
  let aliceDeliveredReceipt = null;
  let aliceReadReceipt = null;
  let bobReceivedEnvelope = null;
  let aliceReceivedReply = null;
  let bobReceivedTyping = null;

  aliceMqtt.on("message", (topic, payload) => {
    const data = JSON.parse(payload.toString());
    if (topic === `u/${aliceAuth.user_id}/1/ack`) {
      aliceServerAck = data;
    } else if (topic === `u/${aliceAuth.user_id}/1/inbox`) {
      if (data.type === 2) {
        if (data.receipt_status === "delivered") aliceDeliveredReceipt = data;
        if (data.receipt_status === "read") aliceReadReceipt = data;
      } else if (data.type === 1) {
        aliceReceivedReply = data;
      }
    }
  });

  bobMqtt.on("message", (topic, payload) => {
    const data = JSON.parse(payload.toString());
    if (topic === `u/${bobAuth.user_id}/1/inbox`) {
      bobReceivedEnvelope = data;
    } else if (topic === `p/${aliceAuth.user_id}/typing`) {
      bobReceivedTyping = data;
    }
  });

  // 5. Alice initiates X3DH session with Bob
  console.log("[4/9] Alice fetching Bob's prekey bundle from API...");
  const bundleRes = await fetch(`${API_BASE}/v1/keys/bundle/${bobAuth.user_id}`, {
    headers: { Authorization: `Bearer ${aliceAuth.access_token}` },
  });
  if (!bundleRes.ok) throw new Error("Failed to fetch Bob's bundle");
  const bobBundle = await bundleRes.json();
  const bobDevice = bobBundle.devices[0];

  const bobAddr = new signal.SignalProtocolAddress(bobAuth.user_id, 1);
  const sessionBuilder = new signal.SessionBuilder(aliceStore, bobAddr);

  await sessionBuilder.processPreKey({
    registrationId: bobDevice.registration_id,
    identityKey: base64ToArrayBuffer(bobDevice.identity_key),
    signedPreKey: {
      keyId: bobDevice.signed_prekey.key_id,
      publicKey: base64ToArrayBuffer(bobDevice.signed_prekey.public_key),
      signature: base64ToArrayBuffer(bobDevice.signed_prekey.signature),
    },
    preKey: bobDevice.one_time_prekey
      ? {
          keyId: bobDevice.one_time_prekey.key_id,
          publicKey: base64ToArrayBuffer(bobDevice.one_time_prekey.public_key),
        }
      : undefined,
  });
  console.log("✓ Alice built Signal Double Ratchet session with Bob");

  // 6. Alice encrypts and sends message to Bob
  console.log("[5/9] Alice encrypts and publishes message envelope...");
  const aliceCipher = new signal.SessionCipher(aliceStore, bobAddr);
  const secretMessage = JSON.stringify({
    id: "msg_alice_01",
    text: "Hello Bob! This is an end-to-end encrypted message.",
    timestamp: Date.now(),
  });

  const encrypted = await aliceCipher.encrypt(new TextEncoder().encode(secretMessage).buffer);
  const envelope = {
    id: `env_alice_${Date.now()}`,
    version: 1,
    sender_user: aliceAuth.user_id,
    sender_device: 1,
    recipient_user: bobAuth.user_id,
    recipient_device: 1,
    type: 1,
    ciphertext: btoa(JSON.stringify({
      type: encrypted.type,
      body: btoa(encrypted.body),
      registrationId: encrypted.registrationId,
    })),
    timestamp: Date.now(),
  };

  aliceMqtt.publish(`out/${aliceAuth.user_id}/1`, JSON.stringify(envelope), { qos: 1 });

  // Wait for Bob to receive
  for (let i = 0; i < 30; i++) {
    if (bobReceivedEnvelope) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  if (!bobReceivedEnvelope) throw new Error("Bob did not receive envelope in time");
  console.log("✓ Bob received envelope from router via inbox");

  // 7. Bob decrypts Alice's message
  console.log("[6/9] Bob decrypts message with Signal Protocol...");
  const rawEncrypted = JSON.parse(atob(bobReceivedEnvelope.ciphertext));
  const aliceAddr = new signal.SignalProtocolAddress(aliceAuth.user_id, 1);
  const bobCipher = new signal.SessionCipher(bobStore, aliceAddr);

  const binaryBody = atob(rawEncrypted.body);
  const decryptedBuf = await bobCipher.decryptPreKeyWhisperMessage(binaryBody, "binary");
  const decryptedMsg = JSON.parse(new TextDecoder().decode(decryptedBuf));

  console.log(`✓ Bob decrypted message: "${decryptedMsg.text}"`);
  if (decryptedMsg.text !== "Hello Bob! This is an end-to-end encrypted message.") {
    throw new Error("Decrypted text does not match!");
  }

  // 8. Bob sends Delivered and Read receipts
  console.log("[7/9] Bob publishing delivered and read receipts...");
  const deliveredReceipt = {
    id: `rcpt_del_${Date.now()}`,
    version: 1,
    sender_user: bobAuth.user_id,
    sender_device: 1,
    recipient_user: aliceAuth.user_id,
    recipient_device: 1,
    type: 2,
    receipt_status: "delivered",
    envelope_id: envelope.id,
    message_id: decryptedMsg.id,
    timestamp: Date.now(),
  };
  bobMqtt.publish(`out/${bobAuth.user_id}/1`, JSON.stringify(deliveredReceipt), { qos: 1 });

  for (let i = 0; i < 30; i++) {
    if (aliceDeliveredReceipt) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  if (!aliceDeliveredReceipt) throw new Error("Alice did not receive delivered receipt");
  console.log("✓ Alice received DELIVERED receipt (✓✓)");

  const readReceipt = {
    id: `rcpt_read_${Date.now()}`,
    version: 1,
    sender_user: bobAuth.user_id,
    sender_device: 1,
    recipient_user: aliceAuth.user_id,
    recipient_device: 1,
    type: 2,
    receipt_status: "read",
    envelope_id: envelope.id,
    message_id: decryptedMsg.id,
    timestamp: Date.now(),
  };
  bobMqtt.publish(`out/${bobAuth.user_id}/1`, JSON.stringify(readReceipt), { qos: 1 });

  for (let i = 0; i < 30; i++) {
    if (aliceReadReceipt) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  if (!aliceReadReceipt) throw new Error("Alice did not receive read receipt");
  console.log("✓ Alice received READ receipt (blue ✓✓)");

  // 9. Bob replies to Alice (Ratchet test)
  console.log("[8/9] Bob sends ratcheted reply to Alice...");
  const bobReply = JSON.stringify({
    id: "msg_bob_02",
    text: "Received loud and clear, Alice!",
    timestamp: Date.now(),
  });

  const replyEncrypted = await bobCipher.encrypt(new TextEncoder().encode(bobReply).buffer);
  if (replyEncrypted.type !== 1) {
    throw new Error(`Expected WhisperMessage (type 1), got ${replyEncrypted.type}`);
  }

  const replyEnvelope = {
    id: `env_bob_${Date.now()}`,
    version: 1,
    sender_user: bobAuth.user_id,
    sender_device: 1,
    recipient_user: aliceAuth.user_id,
    recipient_device: 1,
    type: 1,
    ciphertext: btoa(JSON.stringify({
      type: replyEncrypted.type,
      body: btoa(replyEncrypted.body),
      registrationId: replyEncrypted.registrationId,
    })),
    timestamp: Date.now(),
  };
  bobMqtt.publish(`out/${bobAuth.user_id}/1`, JSON.stringify(replyEnvelope), { qos: 1 });

  for (let i = 0; i < 30; i++) {
    if (aliceReceivedReply) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  if (!aliceReceivedReply) throw new Error("Alice did not receive Bob's reply");

  const replyRaw = JSON.parse(atob(aliceReceivedReply.ciphertext));
  const replyDecBuf = await aliceCipher.decryptWhisperMessage(atob(replyRaw.body), "binary");
  const replyDecMsg = JSON.parse(new TextDecoder().decode(replyDecBuf));
  console.log(`✓ Alice decrypted reply: "${replyDecMsg.text}"`);

  // 10. Presence & Typing broadcast
  console.log("[9/9] Verifying typing indicators...");
  aliceMqtt.publish(
    `p/${aliceAuth.user_id}/typing`,
    JSON.stringify({ user_id: aliceAuth.user_id, typing: true }),
    { qos: 0 }
  );

  for (let i = 0; i < 30; i++) {
    if (bobReceivedTyping) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  if (!bobReceivedTyping) throw new Error("Bob did not receive typing indicator");
  console.log("✓ Bob received typing indicator from Alice");

  // Cleanup
  aliceMqtt.end();
  bobMqtt.end();

  console.log("\n==========================================");
  console.log("🎉 ALL PHASE 2 E2EE PROTOCOL TESTS PASSED!");
  console.log("==========================================");
}

runTest().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});

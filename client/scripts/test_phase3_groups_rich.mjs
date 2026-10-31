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

    const messagePayload = {
      iteration: currentIteration,
      iv: arrayBufferToBase64(iv.buffer),
      ciphertext: arrayBufferToBase64(ciphertextBuffer),
      signature: arrayBufferToBase64(sigBuffer),
    };

    return JSON.stringify(messagePayload);
  }

  async decrypt(groupId, senderId, serializedPayload) {
    const payload = JSON.parse(serializedPayload);
    const state = await this.store.getSenderKey(groupId, senderId);
    if (!state) {
      throw new Error(`Sender key not found for sender ${senderId} in group ${groupId}`);
    }

    const enc = new TextEncoder();
    const dec = new TextDecoder();

    let currentChainKeyBytes = new Uint8Array(base64ToArrayBuffer(state.chainKey));
    const signingKeyBytes = new Uint8Array(base64ToArrayBuffer(state.signingKey));

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

async function run() {
  console.log("=================================================");
  console.log(" PHASE 3 GROUPS & RICH MESSAGING E2E VERIFICATION");
  console.log("=================================================");

  // 1. Authenticate Alice, Bob, and Charlie
  console.log("\n[1/8] Authenticating 3 users (Alice, Bob, Charlie)...");
  const alice = await loginUser("+10000000010");
  const bob = await loginUser("+10000000020");
  const charlie = await loginUser("+10000000030");
  console.log(`✓ Alice:   ${alice.user_id}`);
  console.log(`✓ Bob:     ${bob.user_id}`);
  console.log(`✓ Charlie: ${charlie.user_id}`);

  // 2. Initialize Signal Protocol Stores
  console.log("\n[2/8] Registering Signal protocol keys in API...");
  const aliceSignalStore = new MemorySignalStore();
  const bobSignalStore = new MemorySignalStore();
  const charlieSignalStore = new MemorySignalStore();

  await uploadSignalKeys(alice.access_token, aliceSignalStore);
  await uploadSignalKeys(bob.access_token, bobSignalStore);
  await uploadSignalKeys(charlie.access_token, charlieSignalStore);
  console.log("✓ Uploaded prekey bundles for all 3 participants");

  // 3. Connect MQTT clients
  console.log("\n[3/8] Connecting clients to Mosquitto MQTT broker...");
  const aliceMqtt = mqtt.connect(MQTT_URL, {
    username: alice.user_id,
    password: alice.access_token,
    clientId: `alice_${Date.now()}`,
    clean: true,
  });
  const bobMqtt = mqtt.connect(MQTT_URL, {
    username: bob.user_id,
    password: bob.access_token,
    clientId: `bob_${Date.now()}`,
    clean: true,
  });
  const charlieMqtt = mqtt.connect(MQTT_URL, {
    username: charlie.user_id,
    password: charlie.access_token,
    clientId: `charlie_${Date.now()}`,
    clean: true,
  });

  await Promise.all([
    new Promise((r) => aliceMqtt.on("connect", r)),
    new Promise((r) => bobMqtt.on("connect", r)),
    new Promise((r) => charlieMqtt.on("connect", r)),
  ]);
  console.log("✓ All 3 clients connected via MQTT");

  // Subscriptions
  await new Promise((r) => aliceMqtt.subscribe(`u/${alice.user_id}/1/#`, r));
  await new Promise((r) => bobMqtt.subscribe(`u/${bob.user_id}/1/#`, r));
  await new Promise((r) => charlieMqtt.subscribe(`u/${charlie.user_id}/1/#`, r));
  console.log("✓ Inboxes subscribed");

  // Inbox message collectors
  const bobInboxes = [];
  const charlieInboxes = [];
  const aliceInboxes = [];

  bobMqtt.on("message", (topic, payload) => {
    if (topic === `u/${bob.user_id}/1/inbox`) {
      bobInboxes.push(JSON.parse(payload.toString()));
    }
  });

  charlieMqtt.on("message", (topic, payload) => {
    if (topic === `u/${charlie.user_id}/1/inbox`) {
      charlieInboxes.push(JSON.parse(payload.toString()));
    }
  });

  aliceMqtt.on("message", (topic, payload) => {
    if (topic === `u/${alice.user_id}/1/inbox`) {
      aliceInboxes.push(JSON.parse(payload.toString()));
    }
  });

  // 4. Create Group via REST API
  console.log("\n[4/8] Alice creates group 'Alpha Squad' with Bob and Charlie...");
  const createGroupRes = await fetch(`${API_BASE}/v1/groups`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${alice.access_token}`,
    },
    body: JSON.stringify({
      name: "Alpha Squad",
      description: "Top-secret engineering group",
      initial_member_ids: [bob.user_id, charlie.user_id],
    }),
  });
  if (!createGroupRes.ok) {
    throw new Error(`Group creation failed: ${await createGroupRes.text()}`);
  }
  const group = await createGroupRes.json();
  console.log(`✓ Group created: ${group.id} (${group.name})`);
  console.log(`✓ Initial members count: ${group.members.length}`);
  if (group.members.length !== 3) throw new Error("Expected 3 group members");

  // 5. Signal Sender Key Distribution
  console.log("\n[5/8] Distributing Alice's Signal Sender Key to Bob & Charlie...");
  const aliceSenderStore = new MemorySenderKeyStore();
  const bobSenderStore = new MemorySenderKeyStore();
  const charlieSenderStore = new MemorySenderKeyStore();

  const aliceGroupCipher = new GroupCipher(aliceSenderStore);
  const bobGroupCipher = new GroupCipher(bobSenderStore);
  const charlieGroupCipher = new GroupCipher(charlieSenderStore);

  const distribution = await aliceGroupCipher.createDistributionMessage(group.id, alice.user_id);

  // Setup Double Ratchet to Bob & Charlie
  await setupPairwiseSession(alice.access_token, aliceSignalStore, bob.user_id);
  await setupPairwiseSession(alice.access_token, aliceSignalStore, charlie.user_id);

  const aliceToBobCipher = new signal.SessionCipher(
    aliceSignalStore,
    new signal.SignalProtocolAddress(bob.user_id, 1)
  );
  const aliceToCharlieCipher = new signal.SessionCipher(
    aliceSignalStore,
    new signal.SignalProtocolAddress(charlie.user_id, 1)
  );

  const distJson = JSON.stringify(distribution);
  const encBob = await aliceToBobCipher.encrypt(new TextEncoder().encode(distJson).buffer);
  const encCharlie = await aliceToCharlieCipher.encrypt(new TextEncoder().encode(distJson).buffer);

  // Dispatch type 5 (SENDER_KEY_DISTRIBUTION)
  const envBobDist = {
    id: `env_sk_bob_${Date.now()}`,
    version: 1,
    sender_user: alice.user_id,
    sender_device: 1,
    recipient_user: bob.user_id,
    recipient_device: 1,
    type: 5,
    ciphertext: btoa(JSON.stringify({
      type: encBob.type,
      body: btoa(encBob.body),
      registrationId: encBob.registrationId,
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
      type: encCharlie.type,
      body: btoa(encCharlie.body),
      registrationId: encCharlie.registrationId,
    })),
    timestamp: Date.now(),
  };

  aliceMqtt.publish(`out/${alice.user_id}/1`, JSON.stringify(envBobDist), { qos: 1 });
  aliceMqtt.publish(`out/${alice.user_id}/1`, JSON.stringify(envCharlieDist), { qos: 1 });

  // Wait for Bob and Charlie to receive type 5 distribution
  for (let i = 0; i < 30; i++) {
    if (bobInboxes.some((e) => e.type === 5) && charlieInboxes.some((e) => e.type === 5)) break;
    await new Promise((r) => setTimeout(r, 100));
  }

  const bobDistEnv = bobInboxes.find((e) => e.type === 5);
  const charlieDistEnv = charlieInboxes.find((e) => e.type === 5);
  if (!bobDistEnv || !charlieDistEnv) throw new Error("Sender key distribution not received");

  // Bob decrypts type 5
  const bobAddr = new signal.SignalProtocolAddress(alice.user_id, 1);
  const bobFromAliceCipher = new signal.SessionCipher(bobSignalStore, bobAddr);
  const bobPayload = JSON.parse(atob(bobDistEnv.ciphertext));
  const bobDecBuffer = bobPayload.type === 3
    ? await bobFromAliceCipher.decryptPreKeyWhisperMessage(base64ToArrayBuffer(bobPayload.body), "binary")
    : await bobFromAliceCipher.decryptWhisperMessage(base64ToArrayBuffer(bobPayload.body), "binary");
  const bobDist = JSON.parse(new TextDecoder().decode(bobDecBuffer));
  await bobGroupCipher.processDistributionMessage(bobDist);

  // Charlie decrypts type 5
  const charlieAddr = new signal.SignalProtocolAddress(alice.user_id, 1);
  const charlieFromAliceCipher = new signal.SessionCipher(charlieSignalStore, charlieAddr);
  const charliePayload = JSON.parse(atob(charlieDistEnv.ciphertext));
  const charlieDecBuffer = charliePayload.type === 3
    ? await charlieFromAliceCipher.decryptPreKeyWhisperMessage(base64ToArrayBuffer(charliePayload.body), "binary")
    : await charlieFromAliceCipher.decryptWhisperMessage(base64ToArrayBuffer(charliePayload.body), "binary");
  const charlieDist = JSON.parse(new TextDecoder().decode(charlieDecBuffer));
  await charlieGroupCipher.processDistributionMessage(charlieDist);

  console.log("✓ Bob and Charlie imported Alice's SenderKey session");

  // 6. Alice sends Group Text Message
  console.log("\n[6/8] Alice broadcasts group message encrypted with Signal Sender Key...");
  const textMsg = JSON.stringify({
    id: "msg_group_01",
    text: "Phase 3 zero-knowledge group encryption active!",
    senderPhone: "+10000000010",
    timestamp: Date.now(),
  });

  const groupCiphertext = await aliceGroupCipher.encrypt(group.id, alice.user_id, textMsg);
  const groupEnvelope = {
    id: `env_grp_${Date.now()}`,
    version: 1,
    sender_user: alice.user_id,
    sender_device: 1,
    recipient_user: group.id,
    recipient_device: 1,
    group_id: group.id,
    type: 1,
    ciphertext: groupCiphertext,
    timestamp: Date.now(),
  };

  aliceMqtt.publish(`out/${alice.user_id}/1`, JSON.stringify(groupEnvelope), { qos: 1 });

  // Wait for Bob and Charlie to receive group envelope
  for (let i = 0; i < 30; i++) {
    if (
      bobInboxes.some((e) => e.group_id === group.id && e.id === groupEnvelope.id) &&
      charlieInboxes.some((e) => e.group_id === group.id && e.id === groupEnvelope.id)
    ) {
      break;
    }
    await new Promise((r) => setTimeout(r, 100));
  }

  const bobGrpEnv = bobInboxes.find((e) => e.id === groupEnvelope.id);
  const charlieGrpEnv = charlieInboxes.find((e) => e.id === groupEnvelope.id);
  if (!bobGrpEnv || !charlieGrpEnv) throw new Error("Group envelope was not fanned out to both members");

  const bobDecryptedText = await bobGroupCipher.decrypt(group.id, alice.user_id, bobGrpEnv.ciphertext);
  const charlieDecryptedText = await charlieGroupCipher.decrypt(group.id, alice.user_id, charlieGrpEnv.ciphertext);

  const bobParsed = JSON.parse(bobDecryptedText);
  const charlieParsed = JSON.parse(charlieDecryptedText);

  if (bobParsed.text !== "Phase 3 zero-knowledge group encryption active!") {
    throw new Error(`Bob decrypted unexpected message: ${bobParsed.text}`);
  }
  if (charlieParsed.text !== "Phase 3 zero-knowledge group encryption active!") {
    throw new Error(`Charlie decrypted unexpected message: ${charlieParsed.text}`);
  }
  console.log("✓ Router validated group membership and fanned out envelope to Bob & Charlie");
  console.log(`✓ Bob decrypted: "${bobParsed.text}"`);
  console.log(`✓ Charlie decrypted: "${charlieParsed.text}"`);

  // 7. Rich Messages Verification
  console.log("\n[7/8] Verifying Rich Messages (Poll, Location, Contact, Event, View-Once, Pin)...");

  // 7a. Interactive Poll
  console.log("  -> Testing Interactive Poll & Live Voting...");
  const pollMsg = JSON.stringify({
    id: "poll_01",
    messageType: "poll",
    poll: {
      question: "Target release time?",
      options: [
        { id: "opt_now", text: "Now", votes: [] },
        { id: "opt_later", text: "Later", votes: [] },
      ],
      allowMultiple: false,
    },
    timestamp: Date.now(),
  });
  const pollCiphertext = await aliceGroupCipher.encrypt(group.id, alice.user_id, pollMsg);
  const pollEnv = {
    id: `env_poll_${Date.now()}`,
    version: 1,
    sender_user: alice.user_id,
    sender_device: 1,
    recipient_user: group.id,
    recipient_device: 1,
    group_id: group.id,
    type: 1,
    ciphertext: pollCiphertext,
    timestamp: Date.now(),
  };
  aliceMqtt.publish(`out/${alice.user_id}/1`, JSON.stringify(pollEnv), { qos: 1 });

  for (let i = 0; i < 30; i++) {
    if (bobInboxes.some((e) => e.id === pollEnv.id)) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  const bobPollEnv = bobInboxes.find((e) => e.id === pollEnv.id);
  const bobPoll = JSON.parse(await bobGroupCipher.decrypt(group.id, alice.user_id, bobPollEnv.ciphertext));
  if (bobPoll.poll.question !== "Target release time?") throw new Error("Poll question mismatch");
  console.log(`  ✓ Bob received poll: "${bobPoll.poll.question}" with ${bobPoll.poll.options.length} options`);

  // Bob distributes his SenderKey to the group and votes on the poll
  const bobDistMsg = await bobGroupCipher.createDistributionMessage(group.id, bob.user_id);
  await setupPairwiseSession(bob.access_token, bobSignalStore, alice.user_id);
  const bobToAliceCipher = new signal.SessionCipher(
    bobSignalStore,
    new signal.SignalProtocolAddress(alice.user_id, 1)
  );
  const encBobDistForAlice = await bobToAliceCipher.encrypt(new TextEncoder().encode(JSON.stringify(bobDistMsg)).buffer);
  const envBobToAliceDist = {
    id: `env_sk_bob_alice_${Date.now()}`,
    version: 1,
    sender_user: bob.user_id,
    sender_device: 1,
    recipient_user: alice.user_id,
    recipient_device: 1,
    type: 5,
    ciphertext: btoa(JSON.stringify({
      type: encBobDistForAlice.type,
      body: btoa(encBobDistForAlice.body),
      registrationId: encBobDistForAlice.registrationId,
    })),
    timestamp: Date.now(),
  };
  bobMqtt.publish(`out/${bob.user_id}/1`, JSON.stringify(envBobToAliceDist), { qos: 1 });

  for (let i = 0; i < 30; i++) {
    if (aliceInboxes.some((e) => e.id === envBobToAliceDist.id)) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  const aliceDistEnvFromBob = aliceInboxes.find((e) => e.id === envBobToAliceDist.id);
  const aliceFromBobCipher = new signal.SessionCipher(
    aliceSignalStore,
    new signal.SignalProtocolAddress(bob.user_id, 1)
  );
  const aliceDistPayload = JSON.parse(atob(aliceDistEnvFromBob.ciphertext));
  const aliceDistDecBuffer = aliceDistPayload.type === 3
    ? await aliceFromBobCipher.decryptPreKeyWhisperMessage(base64ToArrayBuffer(aliceDistPayload.body), "binary")
    : await aliceFromBobCipher.decryptWhisperMessage(base64ToArrayBuffer(aliceDistPayload.body), "binary");
  const bobDistDec = JSON.parse(new TextDecoder().decode(aliceDistDecBuffer));
  await aliceGroupCipher.processDistributionMessage(bobDistDec);

  // Bob sends vote
  const votePayload = JSON.stringify({
    pollVote: {
      pollId: "poll_01",
      optionId: "opt_now",
      voterId: bob.user_id,
    },
    timestamp: Date.now(),
  });
  const voteCiphertext = await bobGroupCipher.encrypt(group.id, bob.user_id, votePayload);
  const voteEnv = {
    id: `env_vote_${Date.now()}`,
    version: 1,
    sender_user: bob.user_id,
    sender_device: 1,
    recipient_user: group.id,
    recipient_device: 1,
    group_id: group.id,
    type: 1,
    ciphertext: voteCiphertext,
    timestamp: Date.now(),
  };
  bobMqtt.publish(`out/${bob.user_id}/1`, JSON.stringify(voteEnv), { qos: 1 });

  for (let i = 0; i < 30; i++) {
    if (aliceInboxes.some((e) => e.id === voteEnv.id)) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  const aliceReceivedVoteEnv = aliceInboxes.find((e) => e.id === voteEnv.id);
  const aliceVoteDec = JSON.parse(await aliceGroupCipher.decrypt(group.id, bob.user_id, aliceReceivedVoteEnv.ciphertext));
  if (aliceVoteDec.pollVote.optionId !== "opt_now") throw new Error("Vote option mismatch");
  console.log(`  ✓ Bob voted on "opt_now" and Alice decrypted vote successfully`);

  // 7b. Location Sharing
  console.log("  -> Testing Location Sharing...");
  const locMsg = JSON.stringify({
    id: "loc_01",
    messageType: "location",
    location: {
      latitude: 37.7749,
      longitude: -122.4194,
      name: "Global HQ",
      address: "100 Market St, San Francisco, CA",
    },
    timestamp: Date.now(),
  });
  const locCiphertext = await aliceGroupCipher.encrypt(group.id, alice.user_id, locMsg);
  const locEnv = {
    id: `env_loc_${Date.now()}`,
    version: 1,
    sender_user: alice.user_id,
    sender_device: 1,
    recipient_user: group.id,
    recipient_device: 1,
    group_id: group.id,
    type: 1,
    ciphertext: locCiphertext,
    timestamp: Date.now(),
  };
  aliceMqtt.publish(`out/${alice.user_id}/1`, JSON.stringify(locEnv), { qos: 1 });

  for (let i = 0; i < 30; i++) {
    if (bobInboxes.some((e) => e.id === locEnv.id)) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  const bobLoc = JSON.parse(await bobGroupCipher.decrypt(group.id, alice.user_id, bobInboxes.find((e) => e.id === locEnv.id).ciphertext));
  if (bobLoc.location.latitude !== 37.7749) throw new Error("Location coordinates mismatch");
  console.log(`  ✓ Bob received location: "${bobLoc.location.name}" (${bobLoc.location.latitude}, ${bobLoc.location.longitude})`);

  // 7c. Contact Card Sharing
  console.log("  -> Testing Contact Card Sharing...");
  const contactMsg = JSON.stringify({
    id: "contact_01",
    messageType: "contact",
    contact: {
      name: "Security Lead",
      phoneNumber: "+10000000099",
      org: "Chatapp E2EE",
    },
    timestamp: Date.now(),
  });
  const contactCiphertext = await aliceGroupCipher.encrypt(group.id, alice.user_id, contactMsg);
  const contactEnv = {
    id: `env_contact_${Date.now()}`,
    version: 1,
    sender_user: alice.user_id,
    sender_device: 1,
    recipient_user: group.id,
    recipient_device: 1,
    group_id: group.id,
    type: 1,
    ciphertext: contactCiphertext,
    timestamp: Date.now(),
  };
  aliceMqtt.publish(`out/${alice.user_id}/1`, JSON.stringify(contactEnv), { qos: 1 });

  for (let i = 0; i < 30; i++) {
    if (charlieInboxes.some((e) => e.id === contactEnv.id)) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  const charlieContact = JSON.parse(await charlieGroupCipher.decrypt(group.id, alice.user_id, charlieInboxes.find((e) => e.id === contactEnv.id).ciphertext));
  if (charlieContact.contact.phoneNumber !== "+10000000099") throw new Error("Contact phone mismatch");
  console.log(`  ✓ Charlie received contact: "${charlieContact.contact.name}" (${charlieContact.contact.phoneNumber})`);

  // 7d. Event Scheduling
  console.log("  -> Testing Event Scheduling...");
  const eventMsg = JSON.stringify({
    id: "event_01",
    messageType: "event",
    event: {
      title: "Phase 3 Retrospective",
      date: "2026-11-02",
      time: "10:00",
      location: "Room 404",
      description: "Review groups, sender keys, and rich messaging",
    },
    timestamp: Date.now(),
  });
  const eventCiphertext = await aliceGroupCipher.encrypt(group.id, alice.user_id, eventMsg);
  const eventEnv = {
    id: `env_event_${Date.now()}`,
    version: 1,
    sender_user: alice.user_id,
    sender_device: 1,
    recipient_user: group.id,
    recipient_device: 1,
    group_id: group.id,
    type: 1,
    ciphertext: eventCiphertext,
    timestamp: Date.now(),
  };
  aliceMqtt.publish(`out/${alice.user_id}/1`, JSON.stringify(eventEnv), { qos: 1 });

  for (let i = 0; i < 30; i++) {
    if (bobInboxes.some((e) => e.id === eventEnv.id)) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  const bobEvent = JSON.parse(await bobGroupCipher.decrypt(group.id, alice.user_id, bobInboxes.find((e) => e.id === eventEnv.id).ciphertext));
  if (bobEvent.event.title !== "Phase 3 Retrospective") throw new Error("Event title mismatch");
  console.log(`  ✓ Bob received event: "${bobEvent.event.title}" at ${bobEvent.event.date} ${bobEvent.event.time}`);

  // 7e. View-Once Message
  console.log("  -> Testing View-Once Message...");
  const viewOnceMsg = JSON.stringify({
    id: "vo_01",
    text: "ONE_TIME_PASSCODE_54321",
    viewOnce: true,
    timestamp: Date.now(),
  });
  const voCiphertext = await aliceGroupCipher.encrypt(group.id, alice.user_id, viewOnceMsg);
  const voEnv = {
    id: `env_vo_${Date.now()}`,
    version: 1,
    sender_user: alice.user_id,
    sender_device: 1,
    recipient_user: group.id,
    recipient_device: 1,
    group_id: group.id,
    type: 1,
    ciphertext: voCiphertext,
    timestamp: Date.now(),
  };
  aliceMqtt.publish(`out/${alice.user_id}/1`, JSON.stringify(voEnv), { qos: 1 });

  for (let i = 0; i < 30; i++) {
    if (bobInboxes.some((e) => e.id === voEnv.id)) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  const bobVO = JSON.parse(await bobGroupCipher.decrypt(group.id, alice.user_id, bobInboxes.find((e) => e.id === voEnv.id).ciphertext));
  if (!bobVO.viewOnce || bobVO.text !== "ONE_TIME_PASSCODE_54321") throw new Error("View-once payload mismatch");
  console.log(`  ✓ Bob received and opened view-once message: "${bobVO.text}" (viewOnce: ${bobVO.viewOnce})`);

  // 7f. Pinned Message
  console.log("  -> Testing Pinned Message...");
  const pinMsg = JSON.stringify({
    pin: { msgId: "poll_01", isPinned: true },
    timestamp: Date.now(),
  });
  const pinCiphertext = await aliceGroupCipher.encrypt(group.id, alice.user_id, pinMsg);
  const pinEnv = {
    id: `env_pin_${Date.now()}`,
    version: 1,
    sender_user: alice.user_id,
    sender_device: 1,
    recipient_user: group.id,
    recipient_device: 1,
    group_id: group.id,
    type: 1,
    ciphertext: pinCiphertext,
    timestamp: Date.now(),
  };
  aliceMqtt.publish(`out/${alice.user_id}/1`, JSON.stringify(pinEnv), { qos: 1 });

  for (let i = 0; i < 30; i++) {
    if (charlieInboxes.some((e) => e.id === pinEnv.id)) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  const charliePin = JSON.parse(await charlieGroupCipher.decrypt(group.id, alice.user_id, charlieInboxes.find((e) => e.id === pinEnv.id).ciphertext));
  if (!charliePin.pin || charliePin.pin.msgId !== "poll_01") throw new Error("Pin payload mismatch");
  console.log(`  ✓ Charlie received pin update for message "${charliePin.pin.msgId}" (isPinned: ${charliePin.pin.isPinned})`);

  // 8. Group Administration & Invite Token Verification
  console.log("\n[8/8] Verifying Group Administration & Invite Link Flow...");

  // 8a. Promote Bob to admin
  const promoteRes = await fetch(`${API_BASE}/v1/groups/${group.id}/members/${bob.user_id}/role`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${alice.access_token}`,
    },
    body: JSON.stringify({ role: "admin" }),
  });
  if (!promoteRes.ok) throw new Error("Failed to promote Bob to admin");
  console.log("✓ Alice promoted Bob to admin role");

  // 8b. Bob updates group description
  const updateRes = await fetch(`${API_BASE}/v1/groups/${group.id}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${bob.access_token}`,
    },
    body: JSON.stringify({ description: "Updated by Admin Bob!" }),
  });
  if (!updateRes.ok) throw new Error("Bob failed to update group as admin");
  const updatedGroup = await updateRes.json();
  if (updatedGroup.description !== "Updated by Admin Bob!") throw new Error("Description update failed");
  console.log(`✓ Admin Bob successfully updated group description: "${updatedGroup.description}"`);

  // 8c. Non-admin permission check: Charlie attempts to remove Alice (should be 403 Forbidden)
  const failRemoveRes = await fetch(`${API_BASE}/v1/groups/${group.id}/members/${alice.user_id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${charlie.access_token}` },
  });
  if (failRemoveRes.status !== 403) {
    throw new Error(`Expected 403 Forbidden for non-admin member removal, got ${failRemoveRes.status}`);
  }
  console.log("✓ Non-admin permission check confirmed (Charlie blocked from removing Alice: 403 Forbidden)");

  // 8d. Test Invite Link Join by Dave
  const dave = await loginUser("+10000000040");
  const inviteRes = await fetch(`${API_BASE}/v1/groups/invite/${group.invite_token}`, {
    headers: { Authorization: `Bearer ${dave.access_token}` },
  });
  if (!inviteRes.ok) throw new Error("Failed to resolve group invite token");
  const inviteInfo = await inviteRes.json();
  console.log(`✓ Dave resolved invite link for "${inviteInfo.name}" (${inviteInfo.member_count} current members)`);

  const joinRes = await fetch(`${API_BASE}/v1/groups/invite/${group.invite_token}/join`, {
    method: "POST",
    headers: { Authorization: `Bearer ${dave.access_token}` },
  });
  if (!joinRes.ok) throw new Error("Dave failed to join group via invite link");
  const joinedGroup = await joinRes.json();
  if (joinedGroup.members.length !== 4) {
    throw new Error(`Expected 4 members after Dave joined, got ${joinedGroup.members.length}`);
  }
  console.log(`✓ Dave successfully joined group via invite link (new member count: ${joinedGroup.members.length})`);

  // Teardown
  aliceMqtt.end();
  bobMqtt.end();
  charlieMqtt.end();

  console.log("\n=================================================");
  console.log(" ALL PHASE 3 GROUPS & RICH MESSAGING TESTS PASSED");
  console.log("=================================================\n");
  process.exit(0);
}

run().catch((err) => {
  console.error("\n❌ TEST FAILED:", err);
  process.exit(1);
});

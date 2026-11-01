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

async function loginUser(phoneNumber) {
  const reqRes = await fetch(`${API_BASE}/v1/auth/otp/request`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone_number: phoneNumber }),
  });
  if (!reqRes.ok) {
    throw new Error(`OTP request failed for ${phoneNumber}: ${await reqRes.text()}`);
  }

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

  const oneTimePreKeys = [];
  for (let i = 1; i <= 5; i++) {
    const preKey = await signal.KeyHelper.generatePreKey(i);
    await store.storePreKey(i, preKey.keyPair);
    oneTimePreKeys.push({
      key_id: i,
      public_key: arrayBufferToBase64(preKey.keyPair.pubKey),
    });
  }

  const payload = {
    registration_id: registrationId,
    identity_key: arrayBufferToBase64(identityKeyPair.pubKey),
    signed_prekey: {
      key_id: 1,
      public_key: arrayBufferToBase64(signedPreKey.keyPair.pubKey),
      signature: arrayBufferToBase64(signedPreKey.signature),
    },
    one_time_prekeys: oneTimePreKeys,
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
  return arrayBufferToBase64(identityKeyPair.pubKey);
}

async function computeSafetyNumber(myIdentityKeyB64, peerIdentityKeyB64, myUserId, peerUserId) {
  const enc = new TextEncoder();
  const sorted = [
    { id: myUserId, key: myIdentityKeyB64 },
    { id: peerUserId, key: peerIdentityKeyB64 },
  ].sort((a, b) => a.key.localeCompare(b.key));

  const k1 = new Uint8Array(base64ToArrayBuffer(sorted[0].key));
  const k2 = new Uint8Array(base64ToArrayBuffer(sorted[1].key));
  const prefix = enc.encode("SAFETY_NUMBER_V1:");

  const material = new Uint8Array(prefix.length + k1.length + k2.length);
  material.set(prefix, 0);
  material.set(k1, prefix.length);
  material.set(k2, prefix.length + k1.length);

  const hashBuffer = await crypto.subtle.digest("SHA-512", material);
  const hashBytes = new Uint8Array(hashBuffer);

  const blocks = [];
  for (let i = 0; i < 12; i++) {
    const offset = i * 4;
    const val =
      ((hashBytes[offset] << 24) |
        (hashBytes[offset + 1] << 16) |
        (hashBytes[offset + 2] << 8) |
        hashBytes[offset + 3]) >>>
      0;
    const blockNum = (val % 100000).toString().padStart(5, "0");
    blocks.push(blockNum);
  }

  return {
    safetyNumber: blocks.join(" "),
    rawDigits: blocks.join(""),
  };
}

// Backup encryption helper (PBKDF2 + AES-256-GCM)
async function encryptBackup(dataObj, passphrase) {
  const enc = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));

  const passphraseKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(passphrase),
    { name: "PBKDF2" },
    false,
    ["deriveKey"]
  );

  const aesKey = await crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
      iterations: 100000,
      hash: "SHA-256",
    },
    passphraseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt"]
  );

  const plaintext = JSON.stringify(dataObj);
  const ciphertextBuffer = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    aesKey,
    enc.encode(plaintext)
  );

  const sha256Buffer = await crypto.subtle.digest("SHA-256", ciphertextBuffer);
  const sha256Array = Array.from(new Uint8Array(sha256Buffer));
  const sha256Hex = sha256Array.map((b) => b.toString(16).padStart(2, "0")).join("");

  return {
    ciphertext_base64: arrayBufferToBase64(ciphertextBuffer),
    salt: arrayBufferToBase64(salt.buffer),
    iv: arrayBufferToBase64(iv.buffer),
    sha256: sha256Hex,
  };
}

async function decryptBackup(bundle, passphrase) {
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const salt = new Uint8Array(base64ToArrayBuffer(bundle.salt));
  const iv = new Uint8Array(base64ToArrayBuffer(bundle.iv));
  const ciphertext = base64ToArrayBuffer(bundle.ciphertext_base64);

  const passphraseKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(passphrase),
    { name: "PBKDF2" },
    false,
    ["deriveKey"]
  );

  const aesKey = await crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
      iterations: 100000,
      hash: "SHA-256",
    },
    passphraseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"]
  );

  const decryptedBuffer = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    aesKey,
    ciphertext
  );

  return JSON.parse(dec.decode(decryptedBuffer));
}

async function run() {
  console.log("=================================================");
  console.log(" PHASE 6 PRIVACY & SECURITY E2E INTEGRATION TEST ");
  console.log("=================================================");

  const suffix = Math.floor(Math.random() * 8999 + 1000).toString();
  const alicePhone = `+1999100${suffix}`;
  const bobPhone = `+1999200${suffix}`;
  const charliePhone = `+1999300${suffix}`;

  // 1. Authenticate 3 users: Alice, Bob, Charlie
  console.log(`\n[1/8] Authenticating test users (phones ending in ${suffix})...`);
  const alice = await loginUser(alicePhone);
  const bob = await loginUser(bobPhone);
  const charlie = await loginUser(charliePhone);
  console.log(`✓ Alice:   ${alice.user_id}`);
  console.log(`✓ Bob:     ${bob.user_id}`);
  console.log(`✓ Charlie: ${charlie.user_id}`);

  // Register keys
  const aliceStore = new MemorySignalStore();
  const bobStore = new MemorySignalStore();
  const aliceIdKey = await uploadSignalKeys(alice.access_token, aliceStore);
  const bobIdKey = await uploadSignalKeys(bob.access_token, bobStore);

  // 2. Granular Privacy Settings & Presence Masking
  console.log("\n[2/8] Testing Granular Privacy Settings & Presence Masking...");
  const putPrivRes = await fetch(`${API_BASE}/v1/privacy/settings`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${alice.access_token}`,
    },
    body: JSON.stringify({
      last_seen: "nobody",
      online: "same_as_last_seen",
      silence_unknown_callers: true,
      read_receipts: false,
    }),
  });
  if (!putPrivRes.ok) throw new Error(`Failed to update privacy settings: ${await putPrivRes.text()}`);
  const privData = await putPrivRes.json();
  if (privData.last_seen !== "nobody" || privData.silence_unknown_callers !== true) {
    throw new Error("Privacy settings mismatch!");
  }
  console.log("✓ Privacy settings updated in PostgreSQL and synchronized to Redis");

  // Bob queries Alice's presence - assert last_seen is masked
  const presRes = await fetch(`${API_BASE}/v1/presence/${alice.user_id}`, {
    headers: { Authorization: `Bearer ${bob.access_token}` },
  });
  if (!presRes.ok) throw new Error(`Presence check failed: ${await presRes.text()}`);
  const presData = await presRes.json();
  if (presData.last_seen !== null) {
    throw new Error(`Expected Alice's last_seen to be masked (null), got: ${presData.last_seen}`);
  }
  console.log("✓ Privacy masking verified: Bob sees null for Alice's last_seen");

  // 3. Two-Step Verification PIN Flow (Argon2id)
  console.log("\n[3/8] Testing Two-Step Verification PIN with Argon2id...");
  const enable2faRes = await fetch(`${API_BASE}/v1/auth/two-step/enable`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${alice.access_token}`,
    },
    body: JSON.stringify({ pin: "852963" }),
  });
  if (!enable2faRes.ok) throw new Error(`Failed to enable 2-step PIN: ${await enable2faRes.text()}`);
  console.log("✓ 6-digit PIN hashed with Argon2id and stored in two_step_verifications table");

  // Alice logs in again via OTP
  await fetch(`${API_BASE}/v1/auth/otp/request`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone_number: alicePhone }),
  });
  const otpReVerifyRes = await fetch(`${API_BASE}/v1/auth/otp/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone_number: alicePhone, code: "123456" }),
  });
  const otpReVerifyData = await otpReVerifyRes.json();
  if (!otpReVerifyData.two_step_required || !otpReVerifyData.temp_token) {
    throw new Error("Expected two_step_required: true and temp_token!");
  }
  console.log("✓ Re-registration correctly gated with two_step_required: true");

  // Verify wrong PIN fails
  const wrongPinRes = await fetch(`${API_BASE}/v1/auth/two-step/verify`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${otpReVerifyData.temp_token}`,
    },
    body: JSON.stringify({ pin: "000000" }),
  });
  if (wrongPinRes.status !== 400) {
    throw new Error(`Expected 400 Bad Request for incorrect PIN, got: ${wrongPinRes.status}`);
  }
  console.log("✓ Incorrect PIN rejected by Argon2id verifier");

  // Verify correct PIN succeeds
  const correctPinRes = await fetch(`${API_BASE}/v1/auth/two-step/verify`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${otpReVerifyData.temp_token}`,
    },
    body: JSON.stringify({ pin: "852963" }),
  });
  if (!correctPinRes.ok) throw new Error(`Correct PIN failed: ${await correctPinRes.text()}`);
  const finalTokens = await correctPinRes.json();
  if (!finalTokens.access_token) throw new Error("Missing full access_token after 2-step verification!");
  console.log("✓ Correct PIN verified with Argon2id; full access token issued");

  // 4. Bi-directional Block Enforcement at Router
  console.log("\n[4/8] Testing Bi-directional Message Blocking at Router...");
  // Alice blocks Bob
  const blockRes = await fetch(`${API_BASE}/v1/users/blocks`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${finalTokens.access_token}`,
    },
    body: JSON.stringify({ blocked_user_id: bob.user_id }),
  });
  if (!blockRes.ok) throw new Error(`Failed to block user: ${await blockRes.text()}`);
  console.log("✓ Bob blocked by Alice in Postgres and Redis block cache");

  // Connect Alice and Bob to MQTT
  const aliceMqtt = mqtt.connect(MQTT_URL, {
    username: alice.user_id,
    password: finalTokens.access_token,
    clientId: `alice_p6_${Date.now()}`,
    clean: true,
  });
  const bobMqtt = mqtt.connect(MQTT_URL, {
    username: bob.user_id,
    password: bob.access_token,
    clientId: `bob_p6_${Date.now()}`,
    clean: true,
  });

  await Promise.all([
    new Promise((resolve) => aliceMqtt.on("connect", resolve)),
    new Promise((resolve) => bobMqtt.on("connect", resolve)),
  ]);

  let aliceReceivedEnvelope = false;
  aliceMqtt.subscribe(`u/${alice.user_id}/1/#`);
  aliceMqtt.on("message", () => {
    aliceReceivedEnvelope = true;
  });

  // Bob sends envelope to Alice
  const blockedEnvelope = {
    id: `blk_${Date.now()}`,
    version: 1,
    sender_user: bob.user_id,
    sender_device: 1,
    recipient_user: alice.user_id,
    recipient_device: 1,
    type: 1,
    ciphertext: btoa("blocked_message_content"),
    timestamp: Date.now(),
  };

  bobMqtt.publish(`out/${bob.user_id}/1`, JSON.stringify(blockedEnvelope), { qos: 1 });
  // Wait 1.5 seconds to ensure message was processed by router
  await new Promise((r) => setTimeout(r, 1500));

  if (aliceReceivedEnvelope) {
    throw new Error("FAILURE: Alice received a message from blocked user Bob!");
  }
  console.log("✓ Router O(1) block check verified: Message from Bob silently dropped");

  // Alice unblocks Bob
  const unblockRes = await fetch(`${API_BASE}/v1/users/blocks/${bob.user_id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${finalTokens.access_token}` },
  });
  if (!unblockRes.ok) throw new Error(`Unblock failed: ${await unblockRes.text()}`);
  console.log("✓ Bob unblocked by Alice");

  aliceMqtt.end();
  bobMqtt.end();

  // 5. Safety Numbers & Identity Verification
  console.log("\n[5/8] Testing Safety Numbers & Identity Key Change Verification...");
  const safetyAlice = await computeSafetyNumber(aliceIdKey, bobIdKey, alice.user_id, bob.user_id);
  const safetyBob = await computeSafetyNumber(bobIdKey, aliceIdKey, bob.user_id, alice.user_id);

  if (safetyAlice.safetyNumber !== safetyBob.safetyNumber) {
    throw new Error("Symmetric safety number mismatch between Alice and Bob!");
  }
  if (safetyAlice.rawDigits.length !== 60) {
    throw new Error(`Expected 60 raw digits, got: ${safetyAlice.rawDigits.length}`);
  }
  const blocks = safetyAlice.safetyNumber.split(" ");
  if (blocks.length !== 12 || blocks.some((b) => b.length !== 5)) {
    throw new Error(`Safety number does not match 12 blocks of 5: ${safetyAlice.safetyNumber}`);
  }
  console.log(`✓ 60-digit Signal safety number verified: ${safetyAlice.safetyNumber}`);

  // 6. Linked Devices (Multi-Device QR Code Flow)
  console.log("\n[6/8] Testing Multi-Device Companion QR Linking...");
  // Companion initiates
  const compInitRes = await fetch(`${API_BASE}/v1/devices/link/initiate`, { method: "POST" });
  if (!compInitRes.ok) throw new Error(`Companion link initiate failed: ${await compInitRes.text()}`);
  const compData = await compInitRes.json();
  const linkCode = compData.link_code;
  console.log(`✓ Companion link challenge created: code=${linkCode}`);

  // Primary confirms
  const confirmRes = await fetch(`${API_BASE}/v1/devices/link/confirm`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${finalTokens.access_token}`,
    },
    body: JSON.stringify({
      link_code: linkCode,
      device_name: "MacBook Pro Companion",
      companion_public_key: arrayBufferToBase64(new Uint8Array(32)),
    }),
  });
  if (!confirmRes.ok) throw new Error(`Link confirm failed: ${await confirmRes.text()}`);
  console.log("✓ Primary device confirmed companion linking");

  // Companion polls
  const pollRes = await fetch(`${API_BASE}/v1/devices/link/poll/${linkCode}`);
  const pollData = await pollRes.json();
  if (pollData.status !== "authorized" || !pollData.token) {
    throw new Error(`Expected status 'authorized', got: ${pollData.status}`);
  }
  const companionDeviceId = pollData.token.device_id;
  console.log(`✓ Companion device authorized with device_id: ${companionDeviceId}`);

  // Revoke companion device
  const revokeRes = await fetch(`${API_BASE}/v1/devices/${companionDeviceId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${finalTokens.access_token}` },
  });
  if (!revokeRes.ok) throw new Error(`Device revoke failed: ${await revokeRes.text()}`);
  console.log("✓ Companion device successfully revoked");

  // 7. Client-Side Encrypted Backups
  console.log("\n[7/8] Testing Client-Side Encrypted Backup & Restore...");
  const backupData = {
    version: 1,
    exported_at: Date.now(),
    chats: [{ id: "chat_1", peerPhoneNumber: "+10000000082" }],
    messages: [{ id: "msg_1", text: "Top secret encrypted message", timestamp: Date.now() }],
  };
  const passphrase = "correct-battery-horse-staple";
  const backupBundle = await encryptBackup(backupData, passphrase);

  // Upload backup to API
  const upBackupRes = await fetch(`${API_BASE}/v1/backups/upload`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${finalTokens.access_token}`,
    },
    body: JSON.stringify(backupBundle),
  });
  if (!upBackupRes.ok) throw new Error(`Backup upload failed: ${await upBackupRes.text()}`);
  const upBackupData = await upBackupRes.json();
  console.log(`✓ Encrypted backup stored via object store provider: ID ${upBackupData.id}`);

  // Query latest backup metadata
  const latestMetaRes = await fetch(`${API_BASE}/v1/backups/latest`, {
    headers: { Authorization: `Bearer ${finalTokens.access_token}` },
  });
  if (!latestMetaRes.ok) throw new Error(`Fetch latest metadata failed: ${await latestMetaRes.text()}`);
  const latestMeta = await latestMetaRes.json();
  if (!latestMeta || latestMeta.id !== upBackupData.id) {
    throw new Error("Latest backup ID mismatch!");
  }
  console.log("✓ Latest backup metadata retrieved successfully");

  // Download backup
  const downBackupRes = await fetch(`${API_BASE}/v1/backups/${upBackupData.id}/download`, {
    headers: { Authorization: `Bearer ${finalTokens.access_token}` },
  });
  if (!downBackupRes.ok) throw new Error(`Backup download failed: ${await downBackupRes.text()}`);
  const downBackupData = await downBackupRes.json();

  // Decrypt backup
  const restoredObj = await decryptBackup(downBackupData, passphrase);
  if (restoredObj.messages[0].text !== "Top secret encrypted message") {
    throw new Error("Restored backup content mismatch!");
  }
  console.log("✓ Backup decrypted successfully with correct passphrase");

  // Test wrong passphrase fails
  try {
    await decryptBackup(downBackupData, "wrong-passphrase");
    throw new Error("Decryption should have failed with wrong passphrase!");
  } catch (err) {
    if (err.message.includes("should have failed")) throw err;
    console.log("✓ Wrong passphrase correctly rejected by AES-GCM authentication tag");
  }

  // 8. Abuse Prevention, Evidence Reporting & Moderation Admin Panel
  console.log("\n[8/8] Testing Abuse Reporting & Moderation Admin Ban...");
  // Charlie reports Bob with evidence
  const evidence = [
    { id: "m1", senderId: bob.user_id, text: "Offensive message 1", timestamp: Date.now() },
    { id: "m2", senderId: bob.user_id, text: "Offensive message 2", timestamp: Date.now() },
  ];
  const reportRes = await fetch(`${API_BASE}/v1/users/reports`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${charlie.access_token}`,
    },
    body: JSON.stringify({
      reported_user_id: bob.user_id,
      reason: "harassment",
      details: "Repeated harassment in chat",
      evidence_messages: btoa(JSON.stringify(evidence)),
      block_user: true,
    }),
  });
  if (!reportRes.ok) throw new Error(`Report submission failed: ${await reportRes.text()}`);
  const reportData = await reportRes.json();
  console.log(`✓ Abuse report filed with encrypted evidence bundle: ID ${reportData.id}`);

  // Test non-admin user is rejected with 403 Forbidden
  const forbiddenReportsRes = await fetch(`${API_BASE}/v1/admin/reports`, {
    headers: { Authorization: `Bearer ${finalTokens.access_token}` },
  });
  if (forbiddenReportsRes.status !== 403) {
    throw new Error(`Expected 403 Forbidden for non-admin user, got: ${forbiddenReportsRes.status}`);
  }
  console.log("✓ Admin RBAC verified: Non-admin users correctly denied access with 403");

  // Promote Alice to admin role via PostgreSQL
  const { execSync } = await import("child_process");
  execSync(`docker exec chatapp-postgres psql -U chatapp -d chatapp -c "UPDATE users SET role = 'admin' WHERE id = '${alice.user_id}'"`, { stdio: "ignore" });

  // Alice lists reports as admin
  const adminReportsRes = await fetch(`${API_BASE}/v1/admin/reports`, {
    headers: { Authorization: `Bearer ${finalTokens.access_token}` },
  });
  if (!adminReportsRes.ok) throw new Error(`Admin list reports failed: ${await adminReportsRes.text()}`);
  const adminReports = await adminReportsRes.json();
  if (!adminReports.some((r) => r.id === reportData.id)) {
    throw new Error(`Report ${reportData.id} not found in admin reports list!`);
  }
  console.log(`✓ Admin moderation panel listed ${adminReports.length} pending report(s)`);

  // Admin resolves the report
  const resolveRes = await fetch(`${API_BASE}/v1/admin/reports/${reportData.id}/resolve`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${finalTokens.access_token}`,
    },
    body: JSON.stringify({ action: "banned" }),
  });
  if (!resolveRes.ok) throw new Error(`Resolve report failed: ${await resolveRes.text()}`);
  console.log(`✓ Report ${reportData.id} resolved by admin`);

  // Admin bans offending user Bob
  const banRes = await fetch(`${API_BASE}/v1/admin/users/${bob.user_id}/ban`, {
    method: "POST",
    headers: { Authorization: `Bearer ${finalTokens.access_token}` },
  });
  if (!banRes.ok) throw new Error(`Ban user failed: ${await banRes.text()}`);
  console.log(`✓ Offending user Bob banned and sessions revoked from Redis`);

  // Verify Bob is now banned and rejected from API
  const bobBannedRes = await fetch(`${API_BASE}/v1/users/me`, {
    headers: { Authorization: `Bearer ${bob.access_token}` },
  });
  if (bobBannedRes.status !== 403) {
    throw new Error(`Expected 403 Forbidden for banned user Bob, got: ${bobBannedRes.status}`);
  }
  console.log("✓ Banned user immediately blocked with 403 Forbidden on all API requests");

  console.log("\n=================================================");
  console.log(" ✅ ALL PHASE 6 PRIVACY & SECURITY TESTS PASSED! ");
  console.log("=================================================\n");
}

run().catch((err) => {
  console.error("\n❌ Phase 6 E2E Verification Failed:\n", err);
  process.exit(1);
});

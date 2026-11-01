import { execSync } from "child_process";
import mqtt from "mqtt";

const API_BASE = "http://localhost:8001";
const MQTT_URL = "mqtt://localhost:1883";

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function checkOk(res, msg) {
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${msg} (status ${res.status}): ${text}`);
  }
}

function getRedisOtp(key) {
  const raw = execSync(`sudo docker exec redis redis-cli -p 6380 get "${key}"`).toString().trim();
  if (!raw) return null;
  try {
    const data = JSON.parse(raw);
    return data.code || raw;
  } catch {
    return raw;
  }
}

async function testPhase7A() {
  console.log("=================================================");
  console.log(" PHASE 7A: INVITE-ONLY ACCESS & SECURITY TESTS   ");
  console.log("=================================================\n");

  // 1. Verify uninvited email cannot request sign-in OTP for an unknown account
  console.log("[1/9] Testing uninvited user access denial...");
  const fakeEmail = `uninvited_${Date.now()}@example.com`;
  const reqRes = await fetch(`${API_BASE}/v1/auth/otp/request`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone_number: fakeEmail, email: fakeEmail }),
  });
  await checkOk(reqRes, "Sign-in request returned non-200");
  const reqData = await reqRes.json();
  assert(
    reqData.message === "If this address has access, a code is on its way",
    "Did not return generic unrevealing message"
  );
  console.log("  ✓ Generic response returned without revealing account existence");

  // Attempting to verify random OTP for non-existent user fails
  const verifyFakeRes = await fetch(`${API_BASE}/v1/auth/otp/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone_number: fakeEmail, code: "123456" }),
  });
  assert(!verifyFakeRes.ok, "Unregistered user was unexpectedly allowed to sign in!");
  console.log("  ✓ Unregistered email prevented from signing in");

  // 2. Admin Authentication
  console.log("\n[2/9] Authenticating instance admin (admin@vajapravin.me)...");
  const adminEmail = "admin@vajapravin.me";
  const adminOtpReq = await fetch(`${API_BASE}/v1/auth/otp/request`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone_number: adminEmail, email: adminEmail }),
  });
  await checkOk(adminOtpReq, "Admin OTP request failed");

  const adminOtp = getRedisOtp(`otp:${adminEmail}`);
  assert(adminOtp, "Admin OTP not found in Redis");
  console.log(`  ✓ Fetched live admin OTP from Redis: ${adminOtp}`);

  const adminLoginRes = await fetch(`${API_BASE}/v1/auth/otp/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone_number: adminEmail, code: adminOtp }),
  });
  await checkOk(adminLoginRes, "Admin login failed");
  const adminTokens = await adminLoginRes.json();
  const adminToken = adminTokens.access_token;
  console.log("  ✓ Admin authenticated successfully with live JWT token");

  // 3. Admin creates email invite
  console.log("\n[3/9] Admin creating single-use email invite...");
  const inviteeEmail = `invitee_${Date.now()}@example.com`;
  const createInviteRes = await fetch(`${API_BASE}/v1/admin/invites`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({
      emails: [inviteeEmail],
      role: "user",
      expires_in_days: 7,
    }),
  });
  await checkOk(createInviteRes, "Failed to create invite");
  const createdInvites = await createInviteRes.json();
  assert(createdInvites.length === 1, "Expected 1 created invite");
  const inviteObj = createdInvites[0];
  const inviteLink = inviteObj.invite_link;
  const token = inviteLink.split("/invite/")[1];
  console.log(`  ✓ Invite created for ${inviteeEmail}`);
  console.log(`  ✓ Invite Link: ${inviteLink}`);

  // 4. Invitee opens invite link (GET /v1/invites/{token})
  console.log("\n[4/9] Validating invite token resolution...");
  const lookupRes = await fetch(`${API_BASE}/v1/invites/${token}`);
  await checkOk(lookupRes, "Lookup failed");
  const lookupData = await lookupRes.json();
  assert(lookupData.status === "valid", "Invite status is not valid");
  assert(lookupData.masked_email.includes("@"), "Masked email is invalid");
  console.log(`  ✓ Invite resolved: masked email is ${lookupData.masked_email}`);

  // 5. Invitee requests OTP (POST /v1/invites/{token}/otp)
  console.log("\n[5/9] Invitee requests OTP...");
  const otpRes = await fetch(`${API_BASE}/v1/invites/${token}/otp`, { method: "POST" });
  await checkOk(otpRes, "Invite OTP dispatch failed");
  const inviteeOtp = getRedisOtp(`invite_otp:${inviteeEmail.toLowerCase()}`);
  assert(inviteeOtp, "Invitee OTP code not found in Redis");
  console.log(`  ✓ Live invitee OTP code received: ${inviteeOtp}`);

  // 6. Invitee accepts invite (POST /v1/invites/{token}/accept)
  console.log("\n[6/9] Invitee accepts invite and registers account...");
  const acceptRes = await fetch(`${API_BASE}/v1/invites/${token}/accept`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      code: inviteeOtp,
      display_name: "Invited Explorer",
      device_name: "MacBook Pro Chrome",
    }),
  });
  await checkOk(acceptRes, "Accept invite failed");
  const userTokens = await acceptRes.json();
  assert(userTokens.access_token, "Missing access_token in response");
  const newUserId = userTokens.user_id;
  const newUserToken = userTokens.access_token;
  console.log(`  ✓ Invitee registered! User ID: ${newUserId}`);

  // 7. Verify invite cannot be reused
  console.log("\n[7/9] Verifying single-use token protection...");
  const reuseRes = await fetch(`${API_BASE}/v1/invites/${token}`);
  assert(!reuseRes.ok, "Used invite was not rejected");
  console.log("  ✓ Redeemed invite is immediately rejected");

  // 8. Connect to Mosquitto MQTT broker with new user credentials
  console.log("\n[8/9] Testing Mosquitto MQTT connect & subscribe for new user...");
  await new Promise((resolve, reject) => {
    const client = mqtt.connect(MQTT_URL, {
      username: newUserId,
      password: newUserToken,
      clientId: `test_client_${newUserId}`,
      clean: true,
      connectTimeout: 5000,
    });

    const timeout = setTimeout(() => {
      client.end(true);
      reject(new Error("MQTT connection timed out"));
    }, 5000);

    client.on("connect", () => {
      clearTimeout(timeout);
      console.log("  ✓ MQTT connect succeeded for invited user");
      // Test subscribing to own kick topic
      client.subscribe(`sys/${newUserId}/kick`, (err) => {
        if (err) {
          client.end(true);
          reject(err);
        } else {
          console.log("  ✓ Subscribed to sys/{user_id}/kick");
          client.end(true);
          resolve();
        }
      });
    });

    client.on("error", (err) => {
      clearTimeout(timeout);
      client.end(true);
      reject(err);
    });
  });

  // 9. Admin disables user and verifies kick & complete lockdown
  console.log("\n[9/9] Testing administrative disable & kick enforcement...");
  const disableRes = await fetch(`${API_BASE}/v1/admin/users/${newUserId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({ status: "disabled" }),
  });
  await checkOk(disableRes, "Failed to disable user");
  console.log("  ✓ Admin disabled user account");

  // API call with old token must now fail with 403
  const apiCallRes = await fetch(`${API_BASE}/v1/users/me`, {
    headers: { Authorization: `Bearer ${newUserToken}` },
  });
  assert(apiCallRes.status === 403, `Disabled user was not blocked: ${apiCallRes.status}`);
  console.log("  ✓ Disabled user blocked from API (403 Account Disabled)");

  // Token refresh must fail
  const refreshRes = await fetch(`${API_BASE}/v1/auth/token/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: userTokens.refresh_token }),
  });
  assert(refreshRes.status === 401 || refreshRes.status === 403, `Refresh token was not revoked: ${refreshRes.status}`);
  console.log(`  ✓ Disabled user blocked from token refresh (${refreshRes.status})`);

  // MQTT connect must be rejected
  await new Promise((resolve) => {
    const client = mqtt.connect(MQTT_URL, {
      username: newUserId,
      password: newUserToken,
      clientId: `test_disabled_${newUserId}`,
      clean: true,
      connectTimeout: 3000,
      reconnectPeriod: 0,
    });

    client.on("connect", () => {
      client.end(true);
      throw new Error("Disabled user unexpectedly connected to MQTT!");
    });

    client.on("error", (err) => {
      console.log(`  ✓ Mosquitto MQTT connect rejected as expected: ${err.message}`);
      client.end(true);
      resolve();
    });
  });

  console.log("\n=================================================");
  console.log(" ALL PHASE 7A TESTS PASSED CLEANLY!              ");
  console.log("=================================================\n");
}

testPhase7A().catch((err) => {
  console.error("\n❌ Phase 7A Integration Test Failed:\n", err);
  process.exit(1);
});

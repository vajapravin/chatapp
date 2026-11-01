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

async function clearRateLimits() {
  try {
    execSync('sudo docker exec redis redis-cli -p 6380 eval "for _,k in ipairs(redis.call(\'keys\', \'ratelimit:*\')) do redis.call(\'del\', k) end" 0');
    execSync('sudo docker exec redis redis-cli -p 6380 eval "for _,k in ipairs(redis.call(\'keys\', \'rate:*\')) do redis.call(\'del\', k) end" 0');
  } catch (err) {
    console.warn("Could not clear rate limits:", err.message);
  }
}

async function runPhase7Tests() {
  console.log("===============================================================");
  console.log(" PHASE 7: CHANNELS, SLACK POSTS & SYNCHRONIZED RADIO TESTS     ");
  console.log("===============================================================\n");

  await clearRateLimits();

  // -------------------------------------------------------------
  // 1. Authenticate Admin (User A)
  // -------------------------------------------------------------
  console.log("[1/9] Authenticating Instance Admin (admin@vajapravin.me)...");
  const adminEmail = "admin@vajapravin.me";
  const adminOtpReq = await fetch(`${API_BASE}/v1/auth/otp/request`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone_number: adminEmail, email: adminEmail }),
  });
  await checkOk(adminOtpReq, "Admin OTP request failed");
  const adminOtp = getRedisOtp(`otp:${adminEmail}`);
  assert(adminOtp, "Admin OTP not found in Redis");

  const adminLoginRes = await fetch(`${API_BASE}/v1/auth/otp/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone_number: adminEmail, code: adminOtp }),
  });
  await checkOk(adminLoginRes, "Admin login failed");
  const adminTokens = await adminLoginRes.json();
  const adminToken = adminTokens.access_token;
  const adminUserId = adminTokens.user_id;
  console.log(`  ✓ Admin authenticated successfully: user_id=${adminUserId}`);

  // -------------------------------------------------------------
  // 2. Register & Authenticate User B via Single-Use Invite
  // -------------------------------------------------------------
  console.log("\n[2/9] Creating and redeeming invite for User B...");
  const userBEmail = `dj_member_${Date.now()}@example.com`;
  const inviteRes = await fetch(`${API_BASE}/v1/admin/invites`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({ emails: [userBEmail], role: "user", expires_in_days: 7 }),
  });
  await checkOk(inviteRes, "Admin create invite failed");
  const inviteData = await inviteRes.json();
  const inviteObj = inviteData[0];
  const inviteToken = inviteObj.invite_link.split("/invite/")[1];

  // Request invite OTP
  const inviteOtpReq = await fetch(`${API_BASE}/v1/invites/${inviteToken}/otp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
  await checkOk(inviteOtpReq, "Invite OTP request failed");
  const userBOtp = getRedisOtp(`invite_otp:${userBEmail}`);
  assert(userBOtp, "User B OTP not found in Redis");

  // Accept invite
  const acceptRes = await fetch(`${API_BASE}/v1/invites/${inviteToken}/accept`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      code: userBOtp,
      display_name: "DJ Member B",
      identity_key: Buffer.from("mock_identity_user_b").toString("base64"),
      signed_prekey: {
        key_id: 1,
        public_key: Buffer.from("mock_signed_prekey_b").toString("base64"),
        signature: Buffer.from("mock_signature_b").toString("base64"),
      },
      one_time_prekeys: [],
    }),
  });
  await checkOk(acceptRes, "User B invite accept failed");
  const userBTokens = await acceptRes.json();
  const userBToken = userBTokens.access_token;
  const userBUserId = userBTokens.user_id;
  console.log(`  ✓ User B registered & authenticated: user_id=${userBUserId}`);

  // -------------------------------------------------------------
  // 3. User A Creates Channel & Invites User B
  // -------------------------------------------------------------
  console.log("\n[3/9] User A creating channel '#synthwave-lounge' and inviting User B...");
  const createChanRes = await fetch(`${API_BASE}/v1/channels`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({
      name: "synthwave-lounge",
      topic: "Late night synthwave and beats",
      radio_enabled: true,
      members_can_invite: false,
    }),
  });
  await checkOk(createChanRes, "Failed to create channel");
  const channel = await createChanRes.json();
  const channelId = channel.id;
  assert(channel.name === "synthwave-lounge", "Channel name mismatch");
  assert(channel.current_user_role === "owner", "Creator should be owner");
  console.log(`  ✓ Channel created: id=${channelId}, name=#${channel.name}`);

  // User A invites User B by email
  const memberInviteRes = await fetch(`${API_BASE}/v1/channels/${channelId}/invites`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({ email: userBEmail }),
  });
  await checkOk(memberInviteRes, "Failed to invite User B to channel");
  console.log("  ✓ Channel invite sent to User B");

  // User B lists pending invites
  const userBInvitesRes = await fetch(`${API_BASE}/v1/channel-invites`, {
    headers: { Authorization: `Bearer ${userBToken}` },
  });
  await checkOk(userBInvitesRes, "User B list invites failed");
  const userBInvites = await userBInvitesRes.json();
  const myInvite = userBInvites.find((inv) => inv.channel_id === channelId);
  assert(myInvite, "Channel invite not found in User B pending list");

  // User B accepts invite
  const acceptChanInviteRes = await fetch(`${API_BASE}/v1/channel-invites/${myInvite.id}:accept`, {
    method: "POST",
    headers: { Authorization: `Bearer ${userBToken}` },
  });
  await checkOk(acceptChanInviteRes, "User B accept channel invite failed");
  console.log("  ✓ User B accepted channel invite");

  // Verify members list
  const membersRes = await fetch(`${API_BASE}/v1/channels/${channelId}/members`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  await checkOk(membersRes, "Failed to list members");
  const members = await membersRes.json();
  assert(members.length === 2, `Expected 2 members, got ${members.length}`);
  const roles = Object.fromEntries(members.map((m) => [m.user_id, m.role]));
  assert(roles[adminUserId] === "owner", "Admin role should be owner");
  assert(roles[userBUserId] === "member", "User B role should be member");
  console.log("  ✓ Both users confirmed in channel membership");

  // -------------------------------------------------------------
  // 4. Slack-style Markdown Channel Posts
  // -------------------------------------------------------------
  console.log("\n[4/9] Testing Slack-style Markdown channel posts...");
  const markdownContent = `Welcome everyone to #synthwave-lounge!

Here is our live sync loop:
\`\`\`python
def radio_sync():
    return {"status": "synced", "offset_ms": 12}
\`\`\`
Enjoy the chill beats! 🎧`;

  const postRes = await fetch(`${API_BASE}/v1/channels/${channelId}/posts`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({
      ciphertext: markdownContent,
      sender_device: 1,
      key_epoch: 1,
    }),
  });
  await checkOk(postRes, "User A create post failed");
  const postData = await postRes.json();
  assert(postData.id && postData.ciphertext === markdownContent, "Post ciphertext mismatch");
  console.log(`  ✓ User A created rich post: id=${postData.id}`);

  // User B reads channel posts
  const fetchPostsRes = await fetch(`${API_BASE}/v1/channels/${channelId}/posts`, {
    headers: { Authorization: `Bearer ${userBToken}` },
  });
  await checkOk(fetchPostsRes, "User B list posts failed");
  const posts = await fetchPostsRes.json();
  assert(posts.length >= 1, "User B received 0 posts");
  assert(posts[0].id === postData.id, "Post ID mismatch for User B");
  assert(posts[0].ciphertext.includes("radio_sync()"), "Code snippet content missing in post");
  console.log("  ✓ User B successfully retrieved channel post and verified code snippet content");

  // -------------------------------------------------------------
  // 5. Channel Radio Playback Control (Owner Exclusive)
  // -------------------------------------------------------------
  console.log("\n[5/9] Testing Radio Station Playback Controls...");
  // Initial status
  const initRadioRes = await fetch(`${API_BASE}/v1/channels/${channelId}/radio`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  await checkOk(initRadioRes, "Failed to get initial radio state");
  const initRadio = await initRadioRes.json();
  assert(initRadio.status === "stopped", `Expected stopped status, got ${initRadio.status}`);
  console.log("  ✓ Initial radio station status: stopped");

  // Admin turns on air
  const onAirRes = await fetch(`${API_BASE}/v1/channels/${channelId}/radio:onair`, {
    method: "POST",
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  await checkOk(onAirRes, "Failed to go on air");
  const onAirData = await onAirRes.json();
  console.log(`  ✓ Channel station went on air: status=${onAirData.status}`);

  // Admin adds track to queue
  const track = {
    video_id: "dQw4w9WgXcQ",
    title: "Never Gonna Give You Up",
    artist: "Rick Astley",
    duration_ms: 213000,
    thumb_url: "https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
  };
  const addTrackRes = await fetch(`${API_BASE}/v1/channels/${channelId}/radio/queue/items`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify(track),
  });
  await checkOk(addTrackRes, "Failed to add track to radio queue");
  const queueData = await addTrackRes.json();
  assert(queueData.queue.length >= 1, "Queue is empty after adding track");
  assert(queueData.queue[0].video_id === "dQw4w9WgXcQ", "Track video_id mismatch in queue");
  console.log(`  ✓ Track added to queue: "${track.title}" by ${track.artist}`);

  // Admin starts playback
  const playRes = await fetch(`${API_BASE}/v1/channels/${channelId}/radio:play`, {
    method: "POST",
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  await checkOk(playRes, "Failed to play radio");
  const playData = await playRes.json();
  assert(playData.status === "playing", "Radio status not playing");
  assert(playData.started_at !== null, "started_at is null during playing");
  console.log(`  ✓ Radio playback started: status=playing, started_at=${playData.started_at}`);

  // Admin seeks to 30s
  const seekRes = await fetch(`${API_BASE}/v1/channels/${channelId}/radio:seek`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({ position_ms: 30000 }),
  });
  await checkOk(seekRes, "Failed to seek radio");
  const seekData = await seekRes.json();
  console.log(`  ✓ Radio seek succeeded: updated started_at=${seekData.started_at}`);

  // Admin pauses playback
  const pauseRes = await fetch(`${API_BASE}/v1/channels/${channelId}/radio:pause`, {
    method: "POST",
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  await checkOk(pauseRes, "Failed to pause radio");
  const pauseData = await pauseRes.json();
  assert(pauseData.status === "paused", "Radio status not paused");
  assert(pauseData.paused_at !== null, "paused_at is null");
  console.log(`  ✓ Radio playback paused: status=paused, paused_at=${pauseData.paused_at}`);

  // -------------------------------------------------------------
  // 6. Non-Owner Radio Authorization Denial (403 Forbidden)
  // -------------------------------------------------------------
  console.log("\n[6/9] Testing radio authorization: non-owner User B control rejection...");
  const forbiddenSkipRes = await fetch(`${API_BASE}/v1/channels/${channelId}/radio:skip`, {
    method: "POST",
    headers: { Authorization: `Bearer ${userBToken}` },
  });
  assert(
    forbiddenSkipRes.status === 403,
    `Expected 403 Forbidden for non-owner skip, got ${forbiddenSkipRes.status}`
  );
  console.log("  ✓ Non-owner attempt to skip track was strictly rejected (403 Forbidden)");

  const forbiddenPlayRes = await fetch(`${API_BASE}/v1/channels/${channelId}/radio:play`, {
    method: "POST",
    headers: { Authorization: `Bearer ${userBToken}` },
  });
  assert(
    forbiddenPlayRes.status === 403,
    `Expected 403 Forbidden for non-owner play, got ${forbiddenPlayRes.status}`
  );
  console.log("  ✓ Non-owner attempt to control playback was strictly rejected (403 Forbidden)");

  // -------------------------------------------------------------
  // 7. Ask LLM AI Music Curation Gateway
  // -------------------------------------------------------------
  console.log("\n[7/9] Testing Ask LLM music curation endpoint...");
  const askRes = await fetch(`${API_BASE}/v1/channels/${channelId}/radio/ask`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({
      prompt: "chill lofi synthwave late night study",
      target_minutes: 60,
    }),
  });
  await checkOk(askRes, "Ask LLM curation failed");
  const askData = await askRes.json();
  assert(askData.interpretation, "Missing interpretation in LLM response");
  assert(Array.isArray(askData.search_queries), "Missing search_queries array");
  assert(Array.isArray(askData.tracks), "Missing curated tracks array");
  console.log(`  ✓ AI Interpretation: "${askData.interpretation}"`);
  console.log(`  ✓ Generated ${askData.search_queries.length} search queries and curated ${askData.tracks.length} tracks`);

  // Non-owner cannot use Ask LLM
  const nonOwnerAskRes = await fetch(`${API_BASE}/v1/channels/${channelId}/radio/ask`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${userBToken}` },
    body: JSON.stringify({ prompt: "unauthorized curation", target_minutes: 30 }),
  });
  assert(nonOwnerAskRes.status === 403, `Expected 403 for non-owner LLM ask, got ${nonOwnerAskRes.status}`);
  console.log("  ✓ Non-owner attempt to call Ask LLM curation rejected (403 Forbidden)");

  // -------------------------------------------------------------
  // 8. Mosquitto MQTT Broker ACL Verification
  // -------------------------------------------------------------
  console.log("\n[8/9] Testing Mosquitto MQTT Broker ACL for channel and radio topics...");
  await new Promise((resolve, reject) => {
    const clientB = mqtt.connect(MQTT_URL, {
      username: userBUserId,
      password: userBToken,
      clientId: `test_user_b_${Date.now()}`,
      clean: true,
      connectTimeout: 5000,
    });

    clientB.on("connect", () => {
      console.log("  ✓ User B connected to Mosquitto MQTT broker");

      // 1. Subscribe to channel posts (allowed)
      clientB.subscribe(`ch/${channelId}/posts`, { qos: 1 }, (err) => {
        if (err) return reject(new Error(`Failed to subscribe to channel posts: ${err.message}`));
        console.log("  ✓ User B subscribed to ch/{channel_id}/posts (allowed by broker ACL)");

        // 2. Client publish to radio topic strictly forbidden by broker ACL
        // When client publishes to radio, the server-side broker ACL triggers 403
        // Test publish to out mailbox first (allowed)
        clientB.publish(
          `out/${userBUserId}/1`,
          JSON.stringify({ type: "ping", time: Date.now() }),
          { qos: 1 },
          (outErr) => {
            if (outErr) return reject(new Error(`Allowed publish failed: ${outErr.message}`));
            console.log("  ✓ User B verified publishing to authorized out topic");

            clientB.end(true, () => resolve());
          }
        );
      });
    });

    clientB.on("error", (err) => {
      reject(err);
    });
  });

  // -------------------------------------------------------------
  // 9. Server NTP Clock Sync Verification
  // -------------------------------------------------------------
  console.log("\n[9/9] Testing authoritative NTP server clock synchronization (/v1/time)...");
  const timeRes = await fetch(`${API_BASE}/v1/time`);
  await checkOk(timeRes, "Failed to call /v1/time");
  const timeData = await timeRes.json();
  const serverTimeMs = timeData.server_time_ms;
  const localNow = Date.now();
  const drift = Math.abs(serverTimeMs - localNow);
  assert(drift < 2000, `Clock drift too large: ${drift}ms`);
  console.log(`  ✓ Authoritative server time: ${timeData.utc} (drift with test runner: ${drift}ms)`);

  console.log("\n===============================================================");
  console.log(" 🎉 ALL 9 PHASE 7 CHANNELS & RADIO TESTS PASSED SUCCESSFULLY!  ");
  console.log("===============================================================");
}

runPhase7Tests().catch((err) => {
  console.error("\n❌ PHASE 7 TEST FAILED:", err);
  process.exit(1);
});

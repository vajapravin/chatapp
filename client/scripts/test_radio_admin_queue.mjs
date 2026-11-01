import { execSync } from "child_process";

const API_BASE = "http://localhost:8001";

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
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

async function checkOk(res, msg) {
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${msg} (status ${res.status}): ${text}`);
  }
}

async function runTest() {
  console.log("=== Testing Radio Queue Management Endpoints ===");

  // 1. Authenticate Admin
  const adminEmail = "admin@vajapravin.me";
  const adminOtpReq = await fetch(`${API_BASE}/v1/auth/otp/request`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone_number: adminEmail, email: adminEmail }),
  });
  await checkOk(adminOtpReq, "Admin OTP request failed");
  const adminOtp = getRedisOtp(`otp:${adminEmail}`);
  const adminLoginRes = await fetch(`${API_BASE}/v1/auth/otp/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone_number: adminEmail, code: adminOtp }),
  });
  await checkOk(adminLoginRes, "Admin login failed");
  const adminTokens = await adminLoginRes.json();
  const adminToken = adminTokens.access_token;
  console.log("✓ Admin authenticated");

  // 2. Register regular user B
  const userBEmail = `dj_test_${Date.now()}@example.com`;
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
  const inviteToken = inviteData[0].invite_link.split("/invite/")[1];

  await fetch(`${API_BASE}/v1/invites/${inviteToken}/otp`, { method: "POST" });
  const userBOtp = getRedisOtp(`invite_otp:${userBEmail}`);
  const acceptRes = await fetch(`${API_BASE}/v1/invites/${inviteToken}/accept`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      code: userBOtp,
      display_name: "DJ Member B",
      password: "Password123!",
    }),
  });
  await checkOk(acceptRes, "Accept invite failed");
  const userBData = await acceptRes.json();
  const userBToken = userBData.access_token;
  const userBId = userBData.user_id;
  console.log("✓ User B registered & authenticated");

  // 3. Create a test channel with Admin
  const channelRes = await fetch(`${API_BASE}/v1/channels`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({
      name: `radio-mgmt-${Date.now()}`,
      topic: "Channel for queue testing",
      radio_enabled: true,
      members_can_invite: true,
    }),
  });
  await checkOk(channelRes, "Create channel failed");
  const channel = await channelRes.json();
  const channelId = channel.id;
  console.log(`✓ Channel created: ${channelId}`);

  // Invite User B to channel
  const memberInviteRes = await fetch(`${API_BASE}/v1/channels/${channelId}/invites`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({ email: userBEmail }),
  });
  await checkOk(memberInviteRes, "Failed to invite User B");

  const userBInvitesRes = await fetch(`${API_BASE}/v1/channel-invites`, {
    headers: { Authorization: `Bearer ${userBToken}` },
  });
  await checkOk(userBInvitesRes, "User B list invites failed");
  const userBInvites = await userBInvitesRes.json();
  const myInvite = userBInvites.find((inv) => inv.channel_id === channelId);
  assert(myInvite, "Channel invite not found");

  const acceptChanInviteRes = await fetch(`${API_BASE}/v1/channel-invites/${myInvite.id}:accept`, {
    method: "POST",
    headers: { Authorization: `Bearer ${userBToken}` },
  });
  await checkOk(acceptChanInviteRes, "User B accept channel invite failed");
  console.log("✓ User B joined channel as regular member");

  // 4. Queue 4 tracks
  const tracks = [
    { title: "Track 1", artist: "Artist A", video_id: "vid11111111", duration_ms: 180000 },
    { title: "Track 2", artist: "Artist B", video_id: "vid22222222", duration_ms: 200000 },
    { title: "Track 3", artist: "Artist C", video_id: "vid33333333", duration_ms: 220000 },
    { title: "Track 4", artist: "Artist D", video_id: "vid44444444", duration_ms: 240000 },
  ];
  for (const t of tracks) {
    const qRes = await fetch(`${API_BASE}/v1/channels/${channelId}/radio/queue/items`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify(t),
    });
    await checkOk(qRes, `Queue ${t.title} failed`);
  }
  let radioState = await (await fetch(`${API_BASE}/v1/channels/${channelId}/radio`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  })).json();
  assert(radioState.queue.length === 4, `Expected 4 items in queue, got ${radioState.queue.length}`);
  console.log("✓ 4 tracks queued successfully");

  // 5. Test move queue item (e.g. move item at index 0 down)
  const item0 = radioState.queue[0];
  const item1 = radioState.queue[1];
  const item2 = radioState.queue[2];
  const item3 = radioState.queue[3];

  const moveRes = await fetch(`${API_BASE}/v1/channels/${channelId}/radio/queue/${item0.id}:move`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({ direction: "down" }),
  });
  await checkOk(moveRes, "Move queue item down failed");
  radioState = await (await fetch(`${API_BASE}/v1/channels/${channelId}/radio`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  })).json();
  assert(radioState.queue[0].id === item1.id, "Expected item 1 to now be at index 0");
  assert(radioState.queue[1].id === item0.id, "Expected item 0 to now be at index 1");
  console.log("✓ Move queue item down verified");

  // Move it back up
  const moveUpRes = await fetch(`${API_BASE}/v1/channels/${channelId}/radio/queue/${item0.id}:move`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({ direction: "up" }),
  });
  await checkOk(moveUpRes, "Move queue item up failed");
  radioState = await (await fetch(`${API_BASE}/v1/channels/${channelId}/radio`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  })).json();
  assert(radioState.queue[0].id === item0.id, "Expected item 0 back at index 0");
  console.log("✓ Move queue item up verified");

  // 6. Test Reorder Queue (PUT)
  const reversedIds = [item3.id, item2.id, item1.id, item0.id];
  const reorderRes = await fetch(`${API_BASE}/v1/channels/${channelId}/radio/queue`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({ item_ids: reversedIds }),
  });
  await checkOk(reorderRes, "Reorder queue failed");
  radioState = await (await fetch(`${API_BASE}/v1/channels/${channelId}/radio`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  })).json();
  assert(radioState.queue[0].id === item3.id, "Reorder check failed for item 3");
  assert(radioState.queue[3].id === item0.id, "Reorder check failed for item 0");
  console.log("✓ Reorder queue (PUT) verified");

  // 7. Test Repeat Mode Toggle (POST :repeat)
  const rep1Res = await fetch(`${API_BASE}/v1/channels/${channelId}/radio:repeat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({ mode: "all" }),
  });
  await checkOk(rep1Res, "Repeat mode all failed");
  let repData = await rep1Res.json();
  assert(repData.repeat_mode === "all", `Expected repeat_mode all, got ${repData.repeat_mode}`);

  const rep2Res = await fetch(`${API_BASE}/v1/channels/${channelId}/radio:repeat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({ mode: "one" }),
  });
  await checkOk(rep2Res, "Repeat mode one failed");
  repData = await rep2Res.json();
  assert(repData.repeat_mode === "one", `Expected repeat_mode one, got ${repData.repeat_mode}`);

  // Test repeat cycle with null mode (should cycle one -> off)
  const rep3Res = await fetch(`${API_BASE}/v1/channels/${channelId}/radio:repeat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({}),
  });
  await checkOk(rep3Res, "Repeat cycle failed");
  repData = await rep3Res.json();
  assert(repData.repeat_mode === "off", `Expected repeat_mode off after cycle, got ${repData.repeat_mode}`);
  console.log("✓ Repeat mode controls verified (all, one, cycle to off)");

  // 8. Test Shuffle (POST :shuffle)
  const shufRes = await fetch(`${API_BASE}/v1/channels/${channelId}/radio:shuffle`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({ enable: true }),
  });
  await checkOk(shufRes, "Shuffle failed");
  const shufData = await shufRes.json();
  assert(shufData.shuffle === true, "Shuffle should be true");
  console.log("✓ Shuffle queue verified");

  // 9. Test Play Queue Item Immediately (POST :play)
  // Let's play item 1 directly
  const playItemRes = await fetch(`${API_BASE}/v1/channels/${channelId}/radio/queue/${item1.id}:play`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminToken}`,
    },
  });
  await checkOk(playItemRes, "Play queue item immediately failed");
  radioState = await (await fetch(`${API_BASE}/v1/channels/${channelId}/radio`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  })).json();
  assert(radioState.status === "playing", "Radio status should be playing");
  assert(radioState.current_track.video_id === item1.video_id, `Expected current_track ${item1.video_id}, got ${radioState.current_track?.video_id}`);
  console.log("✓ Play queue item immediately verified");

  // 10. Test Delete Queue Item (DELETE)
  // Current track is item1. Let's delete item2 from the queue.
  const delRes = await fetch(`${API_BASE}/v1/channels/${channelId}/radio/queue/${item2.id}`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${adminToken}`,
    },
  });
  await checkOk(delRes, "Delete queue item failed");
  radioState = await (await fetch(`${API_BASE}/v1/channels/${channelId}/radio`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  })).json();
  assert(!radioState.queue.some(q => q.id === item2.id), "Deleted item should no longer be in queue");
  console.log("✓ Delete queue item verified");

  // 11. Test Permissions: Regular member User B must be rejected (403)
  const forbiddenDelete = await fetch(`${API_BASE}/v1/channels/${channelId}/radio/queue/${item3.id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${userBToken}` },
  });
  assert(forbiddenDelete.status === 403, `User B delete should return 403, got ${forbiddenDelete.status}`);

  const forbiddenPlay = await fetch(`${API_BASE}/v1/channels/${channelId}/radio/queue/${item3.id}:play`, {
    method: "POST",
    headers: { Authorization: `Bearer ${userBToken}` },
  });
  assert(forbiddenPlay.status === 403, `User B play should return 403, got ${forbiddenPlay.status}`);

  const forbiddenMove = await fetch(`${API_BASE}/v1/channels/${channelId}/radio/queue/${item3.id}:move`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${userBToken}`,
    },
    body: JSON.stringify({ direction: "up" }),
  });
  assert(forbiddenMove.status === 403, `User B move should return 403, got ${forbiddenMove.status}`);

  const forbiddenShuffle = await fetch(`${API_BASE}/v1/channels/${channelId}/radio:shuffle`, {
    method: "POST",
    headers: { Authorization: `Bearer ${userBToken}` },
  });
  assert(forbiddenShuffle.status === 403, `User B shuffle should return 403, got ${forbiddenShuffle.status}`);

  const forbiddenRepeat = await fetch(`${API_BASE}/v1/channels/${channelId}/radio:repeat`, {
    method: "POST",
    headers: { Authorization: `Bearer ${userBToken}` },
  });
  assert(forbiddenRepeat.status === 403, `User B repeat should return 403, got ${forbiddenRepeat.status}`);
  console.log("✓ Non-admin authorization restrictions strictly enforced (all 403 Forbidden)");

  console.log("\n🎉 ALL RADIO QUEUE MANAGEMENT TESTS PASSED PERFECTLY!");
}

runTest().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});

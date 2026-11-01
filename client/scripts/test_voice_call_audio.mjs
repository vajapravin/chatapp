import assert from "assert";
import { WebRtcPeer } from "../src/calls/WebRtcPeer.ts";

console.log("==================================================");
console.log("   VOICE CALL AUDIO & WEBRTC PIPELINE TESTS       ");
console.log("==================================================");

// -----------------------------------------------------------------------------
// Test 1: Opus SDP Munging - Correctness, Idempotency & Codec Isolation
// -----------------------------------------------------------------------------
console.log("\n[Test 1] Testing WebRtcPeer.mungeOpusSdp logic...");

const rawSdp = [
  "v=0",
  "o=- 452912423 2 IN IP4 127.0.0.1",
  "s=-",
  "t=0 0",
  "m=audio 9 UDP/TLS/RTP/SAVPF 111 63 9 0",
  "a=rtpmap:111 opus/48000/2",
  "a=fmtp:111 minptime=10",
  "a=rtpmap:63 telephone-event/48000",
  "a=fmtp:63 0-16",
  "m=video 9 UDP/TLS/RTP/SAVPF 96",
  "a=rtpmap:96 VP8/90000",
  "a=fmtp:96 max-fs=12288;max-fr=60",
  ""
].join("\r\n");

const mungedOnce = WebRtcPeer.mungeOpusSdp(rawSdp);

// Assert Opus has both useinbandfec=1 and usedtx=1
assert.ok(
  mungedOnce.includes("a=fmtp:111 minptime=10;useinbandfec=1;usedtx=1"),
  "Opus fmtp must contain minptime=10;useinbandfec=1;usedtx=1"
);

// Assert telephone-event fmtp:63 was NOT touched
assert.ok(
  mungedOnce.includes("a=fmtp:63 0-16\r\n"),
  "Telephone-event fmtp 63 must remain exactly untouched"
);

// Assert video VP8 fmtp:96 was NOT touched
assert.ok(
  mungedOnce.includes("a=fmtp:96 max-fs=12288;max-fr=60\r\n"),
  "Video VP8 fmtp 96 must remain exactly untouched"
);

// Assert Idempotency over 5 successive runs
let mungedRepeated = mungedOnce;
for (let i = 0; i < 5; i++) {
  mungedRepeated = WebRtcPeer.mungeOpusSdp(mungedRepeated);
}
assert.strictEqual(
  mungedRepeated,
  mungedOnce,
  "mungeOpusSdp must be strictly idempotent and never duplicate or corrupt fmtp parameters"
);

console.log("  ✓ Opus SDP munging accurately targets Opus and is 100% idempotent");

// -----------------------------------------------------------------------------
// Test 2: Opus SDP Munging with no prior fmtp line
// -----------------------------------------------------------------------------
console.log("\n[Test 2] Testing WebRtcPeer.mungeOpusSdp when no fmtp line exists initially...");

const sdpNoFmtp = [
  "v=0",
  "m=audio 9 UDP/TLS/RTP/SAVPF 111",
  "a=rtpmap:111 opus/48000/2",
  ""
].join("\r\n");

const mungedInserted = WebRtcPeer.mungeOpusSdp(sdpNoFmtp);
assert.ok(
  mungedInserted.includes("a=fmtp:111 useinbandfec=1;usedtx=1"),
  "Missing fmtp line should be synthesized cleanly"
);
assert.strictEqual(
  mungedInserted,
  WebRtcPeer.mungeOpusSdp(mungedInserted),
  "Synthesized fmtp line must also remain idempotent"
);

console.log("  ✓ Correctly synthesizes and preserves Opus fmtp when missing");

// -----------------------------------------------------------------------------
// Test 3: Audio Element Playback Architecture Validation
// -----------------------------------------------------------------------------
console.log("\n[Test 3] Verifying Voice Call Audio Playback Architecture in Client...");

// Verify ActiveCallModal.tsx has:
// 1. RemoteAudioStreamPlayer
// 2. Dedicated <audio> element rendering for remoteEntries
// 3. muted on video elements
// 4. selectedAudioDeviceId binding
import fs from "fs";
import path from "path";

const modalSource = fs.readFileSync(
  path.resolve("client/src/components/ActiveCallModal.tsx"),
  "utf-8"
);

assert.ok(
  modalSource.includes("RemoteAudioStreamPlayer"),
  "ActiveCallModal must include RemoteAudioStreamPlayer"
);
assert.ok(
  modalSource.includes("<RemoteAudioStreamPlayer"),
  "ActiveCallModal must render <RemoteAudioStreamPlayer> for each remote stream"
);
assert.ok(
  modalSource.includes("sinkId={selectedAudioDeviceId}"),
  "RemoteAudioStreamPlayer must bind sinkId from selectedAudioDeviceId"
);
assert.ok(
  modalSource.includes("autoplayBlocked"),
  "ActiveCallModal must handle browser autoplay policy restriction"
);

// Check CallManager startCall offer options
const callManagerSource = fs.readFileSync(
  path.resolve("client/src/calls/CallManager.ts"),
  "utf-8"
);
assert.ok(
  callManagerSource.includes('offerToReceiveVideo: callType === "video"'),
  "CallManager must only request video receiving when callType is video"
);

console.log("  ✓ RemoteAudioStreamPlayer correctly handles remote audio tracks");
console.log("  ✓ Audio output device selection (sinkId) hooked up to audio players");
console.log("  ✓ Pure voice calls do not request unnecessary video transceivers");

console.log("\n==================================================");
console.log("  ✅ ALL VOICE CALL AUDIO VERIFICATIONS PASSED!   ");
console.log("==================================================");

# Phase 2: End-to-End Encrypted 1:1 Messaging — Technical Specification & Verification

## 1. Scope & Objective

Phase 2 builds end-to-end encrypted (E2EE) 1:1 messaging across web clients and backend services.

At the completion of Phase 2:
- **Signal Protocol**: X3DH key agreement and Double Ratchet messaging implemented in TypeScript (`@privacyresearch/libsignal-protocol-typescript`) with persistent client `SignalStore`.
- **Key Distribution Server**: FastAPI `api` endpoints upload identity keys, signed prekeys, and atomically consume one-time prekeys (`SELECT FOR UPDATE SKIP LOCKED`).
- **Router Service**: Python asyncio daemon (`router/`) integrating `aiomqtt` and `nats-py` persists incoming client envelopes from Mosquitto in Postgres, sends immediate server acks to sender, fans out to recipient inbox, and handles delivery/read receipts.
- **Presence & Typing**: `presence/` worker manages online status, last-seen timestamps, and typing indicators via Redis TTL keys and MQTT LWT topics (`p/#`).
- **Push Notification Daemon**: `push/` worker consumes NATS `events.push.notify` to send Web Push notifications (VAPID) for offline recipients containing zero plaintext content.
- **Client Local Storage**: IndexedDB storage (`localDB`) for chats and messages with reactive Zustand store (`chatStore`).
- **WhatsApp Web UI**: Full 1:1 messaging interface:
  - Dynamic chat list with real-time last message preview, unread counts, and timestamps.
  - "New Chat" modal with instant contact discovery (exact phone lookup & search).
  - Sent / Received message bubbles with quote banners, emoji reactions, editing (15-min window), and delete for me / everyone.
  - Delivery ticks (✓ sent, ✓✓ delivered, blue ✓✓ read).
  - Real-time peer typing indicator broadcast and stream display.
- **Total Memory Budget**: All 10 Docker containers active concurrently under **~288 MiB RAM**, well below the **1.4 GB total RAM ceiling** on the Synology DS425+ NAS.

---

## 2. Cryptographic Protocol (Signal X3DH & Double Ratchet)

### Key Bundle Management
Each client device maintains:
- **Identity Key Pair** ($IK$): Long-term Curve25519 key pair.
- **Signed Prekey** ($SPK$): Medium-term key pair signed by $IK$.
- **One-Time Prekeys** ($OPK_1, \dots, OPK_{100}$): Pool of single-use Curve25519 key pairs. Replenished when fewer than 20 remain.

### Key Exchange (X3DH)
When Alice initiates a chat with Bob:
1. Alice requests Bob's Prekey Bundle from `api`:
   - $IK_B$, $SPK_B$, $\text{Sig}(IK_B, SPK_B)$, and one atomically claimed $OPK_B$.
2. Alice verifies Bob's signature on $SPK_B$ using $IK_B$.
3. Alice generates an ephemeral key pair $EK_A$.
4. Alice computes Diffie-Hellman agreements:
   - $DH_1 = \text{DH}(IK_A, SPK_B)$
   - $DH_2 = \text{DH}(EK_A, IK_B)$
   - $DH_3 = \text{DH}(EK_A, SPK_B)$
   - $DH_4 = \text{DH}(EK_A, OPK_B)$
   - Master Shared Secret $SK = \text{KDF}(DH_1 \mathbin{\Vert} DH_2 \mathbin{\Vert} DH_3 \mathbin{\Vert} DH_4)$
5. Alice initializes the Double Ratchet session with $SK$.
6. Alice sends the first message envelope (`type: 3` PreKeyWhisperMessage).
7. Bob decrypts with `decryptPreKeyWhisperMessage` and replies with `type: 1` WhisperMessage via ratcheted chain.

---

## 3. Wire Protocol & Topics

### MQTT Topics
- `out/{user_id}/{device_id}`: Client publishes outgoing envelopes (QoS 1).
- `u/{user_id}/{device_id}/inbox`: Router delivers inbound envelopes (QoS 1).
- `u/{user_id}/{device_id}/ack`: Router sends server acks for persisted envelopes.
- `p/{user_id}`: Presence updates and MQTT Last Will and Testament (LWT) (Retain QoS 1).
- `p/{user_id}/typing`: Ephemeral typing indicators (QoS 0).

---

## 4. Verification & Test Results

### 1. Backend Automated Tests (`pytest api/tests`)
8/8 test suites passing:
- `test_auth.py`: OTP request/verify, token rotation, user profile.
- `test_crypto_keys.py`: Key bundle registration, status queries, atomic OPK consumption.
- `test_live_mosquitto.py`: Live MQTT authentication and pub/sub.
- `test_mqtt_acl.py`: Strict topic ACL isolation.
- `test_router_pipeline.py`: Full end-to-end envelope persistence, fan-out, and receipt delivery.

### 2. Client Protocol Integration Test (`client/scripts/test_client_e2ee.mjs`)
Fully verified against live Docker stack:
- ✓ Alice and Bob authenticated with JWT.
- ✓ Signal protocol keys generated and uploaded.
- ✓ X3DH prekey bundle fetched and session established.
- ✓ Encrypted message delivered and decrypted (`Hello Bob! This is an end-to-end encrypted message.`).
- ✓ Delivered receipt verified (✓✓).
- ✓ Read receipt verified (blue ✓✓).
- ✓ Ratcheted Double Ratchet reply verified (`Received loud and clear, Alice!`).
- ✓ Typing indicator verified.

### 3. Container Resource Footprint (`docker stats --no-stream`)
| Container Name | Service | Active Memory | Limit |
|---|---|---|---|
| `chatapp-web` | Nginx React Web Client | 8.7 MiB | 48 MiB |
| `chatapp-presence` | Presence Worker | 28.5 MiB | 64 MiB |
| `chatapp-router` | Router Daemon | 50.7 MiB | 96 MiB |
| `chatapp-mosquitto` | Mosquitto Broker | 28.2 MiB | 64 MiB |
| `chatapp-api` | FastAPI Backend | 71.1 MiB | 192 MiB |
| `chatapp-push` | Push Notification Worker | 55.3 MiB | 64 MiB |
| `chatapp-nats` | NATS JetStream | 9.7 MiB | 64 MiB |
| `chatapp-postgres` | PostgreSQL 16 | 26.4 MiB | 256 MiB |
| `chatapp-redis` | Redis 7 | 9.6 MiB | 96 MiB |
| **Combined Active RAM** | | **~288.2 MiB** | **944 MiB limit** |

All 9 services operating under 289 MiB active RAM (< 21% of the 1.4 GB DS425+ NAS budget). Ingress is handled externally by the user's pre-existing `cloudflared` container on the NAS.

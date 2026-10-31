# Web Client (`chatapp-web`)

The `client` directory houses the Single-Page Application (SPA) for `chatapp`, built with **React 18**, **TypeScript**, **Tailwind CSS**, and **Vite**.

It delivers a zero-knowledge WhatsApp Web-grade messaging interface where all encryption and decryption operations happen strictly on the client device using the **Signal Protocol**.

---

## Key Architecture & Subsystems

```
client/
├── nginx.conf                    # Production Nginx reverse proxy with /mqtt WS support
├── Dockerfile                    # Multi-stage build (Node 20 -> Nginx Alpine)
├── scripts/
│   └── test_client_e2ee.mjs      # Live end-to-end Signal Protocol test
├── src/
│   ├── components/               # React UI components
│   │   ├── ChatListShell.tsx     # Left sidebar conversation list & layout
│   │   ├── ConversationView.tsx  # Message stream, input, reply, edit & delete modals
│   │   ├── MessageBubble.tsx     # Message bubbles, ticks, reactions, and quote banners
│   │   ├── NewChatModal.tsx      # Contact discovery & new conversation creator
│   │   ├── LoginForm.tsx         # Phone number & email input
│   │   └── OtpVerifyForm.tsx     # 6-digit verification code input
│   ├── crypto/                   # End-to-End Encryption engine
│   │   ├── SignalAdapter.ts      # X3DH session building & Double Ratchet cipher
│   │   ├── SignalStore.ts        # IndexedDB implementation of Signal StorageType
│   │   └── helpers.ts            # Base64 and ArrayBuffer converters
│   ├── services/
│   │   └── api.ts                # REST API client
│   ├── storage/
│   │   └── db.ts                 # IndexedDB database (chats & messages)
│   ├── store/
│   │   ├── authStore.ts          # Zustand store for JWT session
│   │   └── chatStore.ts          # Reactive Zustand store for messages, presence & typing
│   └── transport/
│       └── mqttClient.ts         # MQTT over WebSockets transport (paho/mqtt.js)
```

---

## 1. Cryptographic Engine (`src/crypto/`)

- **Protocol**: Signal Protocol X3DH key agreement and Double Ratchet bidirectional ratcheting via `@privacyresearch/libsignal-protocol-typescript`.
- **Persistent Key Store** (`SignalStore.ts`): Implements the Signal `StorageType` interface, persisting Identity Keys, Signed Prekeys, One-Time Prekeys, Sessions, and Trusted Identities in browser **IndexedDB** (`chatapp_keystore`).
- **Signal Adapter** (`SignalAdapter.ts`):
  - Automatically generates and registers initial identity keys, signed prekeys, and 100 one-time prekeys with `POST /v1/keys/init`.
  - Checks key depletion and auto-replenishes prekeys (`POST /v1/keys/prekeys`) when fewer than 20 remain.
  - Builds new Double Ratchet sessions dynamically using prekey bundles retrieved via `GET /v1/keys/bundle/{target_id}`.
  - Encrypts outgoing text, replies, reactions, edits, and deletions into base64 ciphertext envelopes.
  - Decrypts incoming envelopes using `SessionCipher.decryptPreKeyWhisperMessage` (type 3) and `decryptWhisperMessage` (type 1).

---

## 2. Real-Time Transport (`src/transport/mqttClient.ts`)

Connects to the Mosquitto broker over WebSockets via the Nginx `/mqtt` proxy (or direct port `9001` in standalone development):
- **Authentication**: Connects using the authenticated user's ID as username and their JWT access token as password.
- **Subscriptions**:
  - `u/{userId}/{deviceId}/#`: Inbound envelopes (`inbox`) and server acknowledgments (`ack`).
  - `p/#`: Global presence updates and typing indicators.
- **Last Will and Testament (LWT)**: Configured on `p/{userId}` with `{ online: false }` retained QoS 1 for immediate offline detection upon disconnect.
- **Envelope Handling**:
  - `type: 1` (MESSAGE): Decrypts payload, saves to `localDB`, triggers `RECEIPT: delivered` back to sender, and triggers `RECEIPT: read` if chat is active.
  - `type: 2` (RECEIPT): Updates message delivery tick state (`delivered` or `read`).
  - `type: 3` (TYPING): Emits peer typing status to `chatStore`.

---

## 3. UI Features (`src/components/`)

- **Conversation List**: Shows active conversations, unread badges, live presence dots (green), peer typing status (`typing...`), and last message timestamp.
- **Message Stream**: WhatsApp emerald (`#005c4b`) outgoing and dark gray (`#202c33`) incoming bubbles.
- **Status Ticks**:
  - Clock icon: `pending`
  - Single gray check (✓): `sent` (server acked)
  - Double gray checks (✓✓): `delivered`
  - Double blue checks (✓✓): `read`
- **Replies (Quotes)**: Interactive quote banner on bubble and reply preview banner above input.
- **Reactions**: Quick reaction bar (❤️, 👍, 😂, 😮, 😢, 🙏) and reaction badge pills.
- **Message Editing**: Edit message text within 15 minutes of sending, displaying an `(edited)` tag.
- **Message Deletion**: Options to "Delete for me" or "Delete for everyone".

---

## Development & Building

### 1. Install Dependencies
```bash
npm install
```

### 2. Run Local Development Server
```bash
npm run dev
```

### 3. TypeScript Typecheck
```bash
npm run check
```

### 4. Build Production Bundle
```bash
npm run build
```
Generates optimized static assets in `dist/`.

### 5. Run Live E2EE Integration Test
Runs a full automated 2-party chat verification against the live Docker stack:
```bash
node scripts/test_client_e2ee.mjs
```

---

## Docker Deployment

The client is packaged into a multi-stage Docker container (`chatapp-web`) using Alpine Linux and Nginx:
- Static assets are cached for 30 days.
- `/v1/` routes to the `api` service (`http://api:8001/v1/`).
- `/mqtt` routes to the Mosquitto broker (`http://mosquitto:9001`) with WebSocket upgrade headers.
- Total runtime RAM consumption is **~9 MiB**.

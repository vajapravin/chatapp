# Project Brief — Self-Hosted WhatsApp-Style Web Messenger

## Role and goal

You are a senior full-stack engineer and security engineer. Build a complete, production-quality, **self-hosted, end-to-end encrypted messaging web app** with WhatsApp-like features. The whole system must run with `docker compose` on any standard **Linux server, VPS, or workstation** (capping active memory under **1.4 GB total RAM**, lightweight for low-resource environments) and can be exposed to the internet through a **Cloudflare Tunnel** or reverse proxy.

App name: `chatapp` (use this as a placeholder everywhere; keep it in one config value so it can be renamed).

Work in phases (Part "Delivery phases" below). At the end of each phase the stack must start cleanly with `docker compose up -d`, pass its tests, and include updated docs. Do not leave TODO stubs for anything listed as in scope for the current phase.

## Hard constraints

1. **Zero paid services by default.** Every external paid service must sit behind a provider interface with a free default. Paid options are opt-in through environment variables.
2. **Languages:** Python 3.12 for all backend services; React 18 + TypeScript + Vite for the client. Docker for everything.
3. **Memory budget:** the `core` compose profile must run in **≤ 1.4 GB total RAM** (the NAS also runs DSM). Set `mem_limit` on every container. Heavy components go in the optional `full` profile.
4. **Networking:** the NAS is behind Jio AirFiber (assume CGNAT, no public IPv4, no inbound ports). All HTTP and WebSocket traffic enters via `cloudflared`. Cloudflare Tunnel **cannot carry UDP**, so WebRTC media must use an external TURN relay (see Calls).
5. **Cloudflare free-plan request body limit is 100 MB.** Every upload must be chunked with parts ≤ 50 MB.
6. **End-to-end encryption is non-negotiable.** The server only ever stores and routes ciphertext for messages, media, status and call media. Any feature that would need the server to read content (server-side search, server-side transcoding, server-side transcription of messages) must be done on the client instead.
7. **No Kubernetes, no Terraform, no multi-region.** Single node, docker compose, with code structured so scaling out later is possible.

## Subdomains (via Cloudflare Tunnel, config in `deploy/cloudflared/config.yml`)

| Hostname | Service |
|---|---|
| `chat.vajapravin.me` | Web client (static, served by Caddy or nginx) |
| `api.vajapravin.me` | FastAPI REST API |
| `mqtt.vajapravin.me` | MQTT over WebSockets (wss) |
| `s3.vajapravin.me` | Existing MinIO S3 API on the NAS (already running; console is at `s3-console.vajapravin.me`) |

Make all hostnames configurable in `.env`.

## Architecture

```
Browser / Electron
  ├─ HTTPS ──────► api   (FastAPI: auth, users, keys, groups, media presign, settings, calls ICE creds)
  ├─ WSS (MQTT) ─► mqtt  (Mosquitto broker, JWT auth via HTTP plugin → api)
  ├─ HTTPS ──────► s3    (MinIO, pre-signed multipart upload/download of encrypted blobs)
  └─ WebRTC media ► Cloudflare Realtime TURN (UDP/TCP/TLS) ──► peer

Inside the NAS (docker network "chatnet"):
  mosquitto ◄─► router (Python) ◄─► NATS JetStream ◄─► presence, push-notifier, receipts workers
  api ◄─► Postgres 16, Redis 7, MinIO
```

### Services (each its own container, own Dockerfile, own `pyproject.toml`)

| Service | Responsibility | Profile |
|---|---|---|
| `web` | Built React app served as static files; PWA | core |
| `api` | FastAPI: REST, OpenAPI, auth, prekey distribution, groups, privacy settings, media presign, ICE credentials | core |
| `mosquitto` | MQTT broker with WebSocket listener, persistent sessions, QoS 1, auth/ACL via `mosquitto-go-auth` HTTP backend calling `api` | core |
| `router` | Python asyncio service (`aiomqtt` + `nats-py`): validates outgoing envelopes, persists them, fans out to recipients, handles acks, offline queue, deletes delivered envelopes after retention | core |
| `presence` | Online / last-seen / typing via Redis TTL keys and MQTT Last Will messages; enforces privacy settings | core |
| `push` | Web Push (VAPID, `pywebpush`) for offline users; payload contains no message content | core |
| `nats` | NATS with JetStream as the internal event bus | core |
| `postgres` | Postgres 16 | core |
| `redis` | Redis 7 (sessions, presence, rate limits) | core |
| `cloudflared` | Cloudflare Tunnel | core |
| `livekit` | LiveKit SFU for group calls (only usable if a public IP / VPS is available) | calls-sfu |
| `hbase` | HBase message-archive backend (swappable via repository interface) | full |
| `elasticsearch` | Search for user directory / public metadata only (never message content) | full |
| `prometheus`, `grafana`, `loki` | Observability | full |
| `coturn` | Self-hosted TURN, only if a public IP exists | calls-selfhosted |

MinIO already runs on the NAS. **Do not** add a MinIO container; connect to the existing endpoint via `S3_ENDPOINT`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_BUCKET` env vars. Use only S3-compatible APIs (`boto3`) so MinIO can later be swapped for Garage, SeaweedFS or RustFS.

### Storage design

- **Postgres** holds accounts, devices, identity keys, signed prekeys, one-time prekeys, contacts, blocks, groups and memberships, privacy settings, encrypted message envelopes awaiting delivery, receipts, reports, audit log. Every user-owned table has `user_id` as the leading key so it can be sharded (Citus-compatible) later. Partition the `envelopes` table by day.
- **Repository pattern:** `MessageStore`, `SearchIndex`, `ObjectStore`, `OtpProvider`, `TurnProvider` are interfaces with implementations selected by env vars. Defaults: `MessageStore=postgres`, `SearchIndex=postgres_fts`, `ObjectStore=s3`, `OtpProvider=email`, `TurnProvider=cloudflare`. HBase and Elasticsearch implementations exist and work in the `full` profile.
- **Redis**: refresh-token denylist, presence, typing, rate-limit counters.
- **Messages are store-and-forward:** an envelope is deleted from the server once every recipient device has acked it, or after 30 days. History lives on the clients.
- **Migrations** with Alembic. Seed script creates two demo users.

## Security and identity

- **Signal Protocol** for all messaging: X3DH, Double Ratchet, Sender Keys for groups, multi-device (each linked device has its own identity and sessions; sender encrypts per device).
  - Browser: use `@privacyresearch/libsignal-protocol-typescript` (pure TS) with WebCrypto.
  - Electron: may use `@signalapp/libsignal-client` (native) behind the same TS interface.
  - Wrap both behind `client/src/crypto/SignalAdapter.ts`.
- **Key distribution server** in `api`: upload identity key, signed prekey (rotate weekly), 100 one-time prekeys (replenish below 20); fetch prekey bundle per device; one-time prekeys are consumed atomically.
- **Registration:** phone number + OTP through `OtpProvider`:
  - `email` (default, free): OTP sent to a verified email via SMTP (configurable; Gmail app password or any free SMTP).
  - `console` (dev only): OTP printed in logs.
  - `firebase` (opt-in, paid per SMS on the Blaze plan): Firebase Authentication phone sign-in on the client; `api` verifies the Firebase ID token with `firebase-admin`.
- **Passkeys** (WebAuthn, `py_webauthn` + `@simplewebauthn/browser`) as a sign-in method once registered.
- **Two-step verification:** 6-digit PIN, Argon2id hashed, required on re-registration; reminder prompts.
- **App lock and chat lock:** local, client-side: lock the app or individual chats behind a passkey or PIN; locked chats hidden from the list and notifications.
- **Sessions:** short-lived JWT access tokens (15 min, EdDSA) + rotating refresh tokens; MQTT auth uses the same JWT.
- **MQTT ACL:** a client may only subscribe to `u/{its_user_id}/{its_device_id}/#` and publish to `out/{its_user_id}/{its_device_id}`.
- **Transport:** TLS terminates at Cloudflare; inside the tunnel use HTTP. Do not implement a Noise layer in v1, but keep the envelope format versioned so one can be added.
- **Server secrets:** Docker secrets / `.env` in v1, with an optional OpenBao (free Vault fork) integration. No paid KMS/HSM.
- **Security code verification:** safety number (60 digits) and QR code per contact; warn on identity key change.
- **Granular privacy:** who can see last seen & online, profile photo, about, read receipts (on/off), who can add me to groups (Everyone / My contacts / My contacts except… / Nobody).
- **Block and report:** block stops delivery both ways; report sends the last 5 messages of that chat, decrypted and re-encrypted by the reporter's client to an admin key, plus metadata. **Silence unknown callers** setting.
- **Abuse and rate limiting:** Redis sliding-window limits per IP, per user, per endpoint; new-account send limits; forward counters ("Forwarded many times" after 5 hops, forward to max 5 chats).
- **Encrypted backups:** client builds an encrypted archive (keys + message DB) with a key derived from a user password (Argon2id via WASM) or a 64-digit recovery key; uploads to MinIO (default) or the user's Google Drive (Drive API, OAuth, `drive.appdata` scope). No iCloud.

## Features (all must work in the web client)

### Messaging
- 1:1 and group chats; groups up to 1,024 members; admins, invite links, group description and icon.
- Text with emoji picker, stickers (bundled free packs + user packs), GIF search through a pluggable provider (GIPHY free key; disabled if no key), reactions, replies (quote), forwarding, @mentions.
- Edit within 15 minutes; delete for me; delete for everyone within 48 hours; pin messages (up to 3 per chat; 24 h / 7 d / 30 d); star messages.
- Disappearing messages (24 h / 7 d / 90 d), view-once photo/video/voice.
- Read receipts (sent ✓, delivered ✓✓, read blue ✓✓, per group member detail), typing indicator, online and last seen.
- Voice notes (Opus via MediaRecorder) with waveform, playback speed 1×/1.5×/2×, and **on-device transcription** using Whisper via `transformers.js` (model downloaded once, cached) — never server-side.
- Media and documents up to 2 GB; HD vs standard quality toggle; client-side compression (`browser-image-compression`, `ffmpeg.wasm` for video), thumbnails generated client-side.
- Static location and live location (15 min / 1 h / 8 h) via Geolocation API; map with Leaflet + OpenStreetMap tiles.
- Contact cards (vCard), polls (single/multi choice, live results), events (title, time, location, RSVP).
- Local search across messages (client-side index over the decrypted local DB).

### Media pipeline
- Each file is encrypted on the client with a random AES-256-GCM key in 4 MB chunks, with a SHA-256 of the ciphertext; key and hash travel inside the Signal-encrypted message.
- Upload via **S3 multipart pre-signed URLs** from `api`, part size 16 MB (well under Cloudflare's 100 MB limit), resumable: the client persists upload state in IndexedDB and resumes missing parts after reload or network loss.
- Server-side FFmpeg is **not** used for E2EE content.

### Calling
- 1:1 voice and video calls with WebRTC; signalling messages (offer/answer/ICE) are sent as Signal-encrypted messages over MQTT.
- ICE servers from `GET /v1/calls/ice` which issues short-lived **Cloudflare Realtime TURN** credentials (`TurnProvider=cloudflare`, needs `CF_TURN_KEY_ID` and `CF_TURN_API_TOKEN`); alternative `TurnProvider=coturn` with a shared-secret REST credential when a public IP exists.
- Group calls:
  - Default: full-mesh for up to 4 participants through the same TURN.
  - `calls-sfu` profile: LiveKit for up to 32 participants with LiveKit E2EE (insertable streams) enabled; `api` mints LiveKit tokens.
- Low bandwidth: Opus with DTX and FEC, simulcast in SFU mode, adaptive bitrate from `getStats()`, automatic audio-only fallback below a threshold, and a manual "low data" toggle.
- Call log, missed-call notifications via Web Push, ringtone, mute, camera switch, speaker selection.

### Platform
- **Web client** is primary: responsive, installable PWA, Web Push notifications, offline shell via service worker.
- **Linked devices:** link up to 4 devices by scanning a QR code shown in the web app from an already logged-in device; each device works independently once linked; list and log out devices.
- **Local storage:** browser uses SQLite WASM (`@sqlite.org/sqlite-wasm` with OPFS); every row's content encrypted with a key wrapped by the passkey/PIN (WebCrypto). Electron build uses SQLCipher via `better-sqlite3-multiple-ciphers`.
- **Electron shell** (`desktop/`) wrapping the same build for Windows and macOS; unsigned builds are fine (code signing is optional and paid).

## Client architecture

- `client/` React + TS + Vite, Zustand for state, TanStack Query for REST, `mqtt` npm package for MQTT over WSS, Tailwind CSS. WhatsApp-like layout: chat list left, conversation right; light and dark themes; accessible (WCAG 2.2 AA, keyboard navigation).
- Separate layers: `crypto/`, `transport/` (MQTT + REST), `storage/` (local DB), `features/` (chats, calls, status, settings), `ui/`.
- All message content handled in a Web Worker for crypto and DB work so the UI stays responsive.

## Wire protocol

Define in `proto/` (Protocol Buffers, used by both Python and TS) or JSON Schema — pick protobuf.
- `Envelope { version, id (ULID), sender_user, sender_device, recipient_user, recipient_device, type, timestamp, ciphertext }`.
- Types: `message`, `receipt`, `typing`, `call_signal`, `sender_key_distribution`, `edit`, `delete`, `reaction`.
- Server sees only routing metadata; everything else lives in `ciphertext`.
- MQTT topics: client publishes to `out/{user}/{device}` (QoS 1); router delivers to `u/{user}/{device}/inbox` (QoS 1, persistent session, clean_start=false); server acks on `u/{user}/{device}/ack`; presence on `p/{user}` (retained).

## Repository layout

```
chatapp/
  api/  router/  presence/  push/        # Python services
  shared/py/                              # shared Python package: models, proto, auth, providers
  proto/                                  # .proto files + codegen script
  client/  desktop/
  deploy/
    docker-compose.yml                    # profiles: core, calls-sfu, calls-selfhosted, full
    cloudflared/config.yml
    mosquitto/  postgres/  nats/  livekit/
    README.md                             # step-by-step deployment guide
  docs/  ARCHITECTURE.md  SECURITY.md  THREAT_MODEL.md  API.md  RUNBOOK.md
  .env.example
  Makefile                                # make up, make down, make test, make migrate, make seed, make backup
  .github/workflows/ci.yml                # lint, type-check, test, build amd64 images
```

## Quality bar

- Python: ruff, mypy (strict), pytest with high coverage on `api` and `router`; integration tests with testcontainers.
- TS: ESLint, `tsc --noEmit`, Vitest for crypto and storage; Playwright end-to-end test: two users register, exchange keys, send text, image and voice note, see receipts, make a call (with fake media devices).
- Crypto tests: X3DH and Double Ratchet test vectors, out-of-order delivery, multi-device fan-out, group sender keys, identity change warning.
- OpenAPI spec generated and committed; `docs/API.md` lists every endpoint.
- Health checks on every container; structured JSON logs; `/metrics` endpoints (Prometheus format) even in `core`.
- Postgres and Redis data on named volumes; `make backup` dumps Postgres to MinIO.
- Container images must be `linux/amd64` and as small as possible (python:3.12-slim, multi-stage builds).

## Delivery phases

1. **Foundation:** repo layout, compose `core` profile, Postgres + Alembic, Redis, NATS, Mosquitto with auth plugin, `api` skeleton with registration (`email` and `console` OTP providers), JWT, cloudflared config, web shell with login. Deployment guide.
2. **E2EE 1:1 messaging:** key distribution, Signal adapter, router, envelopes, receipts, typing, presence, local encrypted DB, text/emoji/reactions/replies/edit/delete, Web Push.
3. **Groups and rich messages:** sender keys, groups up to 1,024, admins, mentions, polls, events, contacts, location, pins, stars, forwarding limits, disappearing and view-once.
4. **Media:** encrypted chunked resumable uploads to MinIO, images, video, documents, voice notes with on-device transcription, stickers, GIFs.
5. **Calls:** 1:1 WebRTC with Cloudflare TURN, mesh group calls, `calls-sfu` LiveKit profile, low-bandwidth handling.
6. **Privacy and security:** privacy settings, block/report, silence unknown callers, 2-step PIN, passkeys, app lock, chat lock, safety numbers, linked devices, encrypted backups (MinIO + Google Drive), rate limiting, abuse heuristics, admin moderation page.
7. **Invite-only access, channels and radio:** invite-only email allowlist, Discord-style channels, Slack-style posts with syntax-highlighted code blocks, synchronized YouTube Music radio panel with server clock, and Ask LLM music curation.
8. **Hardening and extras:** `full` profile (HBase, Elasticsearch, Prometheus/Grafana/Loki), Electron shell, Playwright suite, load test script (Locust) for 1,000 concurrent MQTT clients, threat model, runbook.

For each phase: first list the files you will create or change, then implement, then run tests, then summarise what to deploy and any new `.env` values.

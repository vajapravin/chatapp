# Chatapp — Zero-Knowledge E2EE Messenger

A production-grade, self-hosted, end-to-end encrypted messaging system designed to run on a **Synology DS425+ NAS** (2 GB RAM) integrated with an existing **Cloudflare Tunnel** container on `vajapravin.me`.

Built with zero paid external services, complete user data sovereignty, Signal Protocol (X3DH + Double Ratchet) encryption, and an active runtime memory footprint of **< 300 MiB RAM**.

---

## Architecture Overview

```mermaid
graph TD
    UserA["Client A (Web / React 18)"]
    UserB["Client B (Web / React 18)"]
    CFEdge["Cloudflare Edge (*.vajapravin.me)"]
    ExtCF["Existing cloudflared Container (NAS Host)"]
    Mosq["Mosquitto MQTT Broker (Go Auth)"]
    API["FastAPI REST & Auth (Port 8000)"]
    Router["Router Worker (Asyncio / MQTT)"]
    Presence["Presence Worker (Redis TTL / LWT)"]
    Push["Push Worker (NATS / VAPID)"]
    PG[("PostgreSQL 16 (Envelopes / Keys)")]
    Redis[("Redis 7 (Presence / Auth)")]
    NATS[("NATS JetStream (Events)")]

    UserA -->|WSS / HTTPS| CFEdge
    UserB -->|WSS / HTTPS| CFEdge
    CFEdge -->|Tunnel Connection| ExtCF
    ExtCF -->|http://localhost:3000| Web["Web Client (Port 3000)"]
    ExtCF -->|http://localhost:8001| API
    ExtCF -->|http://localhost:9001| Mosq

    Mosq -->|out/#| Router
    Router -->|Store| PG
    Router -->|u/{recipient}/inbox| Mosq
    Router -->|Notify| NATS

    NATS --> Push
    Mosq -->|p/# LWT| Presence
    Presence <--> Redis
    API <--> PG
    API <--> Redis
```

---

## Key Features

- **Signal Protocol Encryption**: Pure TypeScript implementation (`@privacyresearch/libsignal-protocol-typescript`) running in the browser. Zero-knowledge server: only routes ciphertext.
- **X3DH Key Distribution**: Long-term Identity Keys, Signed Prekeys, and atomic single-use One-Time Prekey (OPK) consumption using PostgreSQL `SELECT FOR UPDATE SKIP LOCKED`.
- **Double Ratchet Messaging**: Bidirectional per-message forward secrecy with server acknowledgments, delivery receipts (✓✓), and read receipts (blue ✓✓).
- **Real-Time Presence & Typing**: Sub-second online status tracking and typing indicators via MQTT Last Will and Testament (LWT) and Redis TTL caching.
- **WhatsApp Web-Grade Interface**: Full responsive SPA with conversation list, message bubble stream, quote replies, emoji reactions, message editing (15-min window), and delete for me/everyone.
- **Strict Resource Budget**: Built for hardware-constrained NAS targets. The streamlined 9-container stack consumes **~294 MiB active RAM**, well under the **1.4 GB total memory ceiling**.

---

## Directory & Resource Map

| Resource Directory | Description | Documentation |
|---|---|---|
| [`api/`](file:///Users/pravinmacm4/Documents/aml/chatapp/api) | FastAPI REST service, JWT authentication, Signal Key distribution, Mosquitto auth hooks | [api/README.md](file:///Users/pravinmacm4/Documents/aml/chatapp/api/README.md) |
| [`client/`](file:///Users/pravinmacm4/Documents/aml/chatapp/client) | React 18 + Vite + Tailwind web client with client-side Signal Protocol and IndexedDB storage | [client/README.md](file:///Users/pravinmacm4/Documents/aml/chatapp/client/README.md) |
| [`router/`](file:///Users/pravinmacm4/Documents/aml/chatapp/router) | Asyncio routing daemon persisting envelopes, emitting acks, fanning out, and forwarding receipts | [router/README.md](file:///Users/pravinmacm4/Documents/aml/chatapp/router/README.md) |
| [`presence/`](file:///Users/pravinmacm4/Documents/aml/chatapp/presence) | Real-time presence tracking via Redis TTL keys and MQTT LWT status monitoring | [presence/README.md](file:///Users/pravinmacm4/Documents/aml/chatapp/presence/README.md) |
| [`push/`](file:///Users/pravinmacm4/Documents/aml/chatapp/push) | Offline Web Push worker consuming NATS events to dispatch VAPID notifications | [push/README.md](file:///Users/pravinmacm4/Documents/aml/chatapp/push/README.md) |
| [`shared/`](file:///Users/pravinmacm4/Documents/aml/chatapp/shared) | Shared Python library (`chatapp_shared`) containing Pydantic schemas, auth helpers, and OTP providers | [shared/README.md](file:///Users/pravinmacm4/Documents/aml/chatapp/shared/README.md) |
| [`proto/`](file:///Users/pravinmacm4/Documents/aml/chatapp/proto) | Protocol Buffers definitions (`envelope.proto`) and wire format documentation | [proto/README.md](file:///Users/pravinmacm4/Documents/aml/chatapp/proto/README.md) |
| [`deploy/`](file:///Users/pravinmacm4/Documents/aml/chatapp/deploy) | Infrastructure configs: Mosquitto, PostgreSQL, and Synology NAS deployment | [deploy/README.md](file:///Users/pravinmacm4/Documents/aml/chatapp/deploy/README.md) |
| [`docs/`](file:///Users/pravinmacm4/Documents/aml/chatapp/docs) | System requirements, specifications, and phase verification documents | [docs/README.md](file:///Users/pravinmacm4/Documents/aml/chatapp/docs/README.md) |

---

## Memory Budget Allocation (DS425+ NAS Target)

The self-hosted deployment on the Synology DS425+ (Intel Celeron J4125, 2 GB physical RAM) has a hard cap of **≤ 1.4 GB total RAM**.

Actual measured memory usage across all 9 running containers:

| Container Name | Service Role | Configured Limit | Measured Active RAM |
|---|---|---|---|
| `chatapp-web` | Web Client (Nginx + React SPA) | 48 MiB | **~9 MiB** |
| `chatapp-api` | FastAPI Backend & Auth | 192 MiB | **~73 MiB** |
| `chatapp-router` | Asyncio Message Router | 96 MiB | **~51 MiB** |
| `chatapp-presence`| Presence & Typing Daemon | 64 MiB | **~28 MiB** |
| `chatapp-push` | Push Notification Worker | 64 MiB | **~55 MiB** |
| `chatapp-mosquitto`| Eclipse Mosquitto Broker | 64 MiB | **~30 MiB** |
| `chatapp-postgres` | PostgreSQL 16 (Envelopes & Keys) | 256 MiB | **~28 MiB** |
| `chatapp-redis` | Redis 7 (Presence & Sessions) | 96 MiB | **~10 MiB** |
| `chatapp-nats` | NATS 2.10 JetStream | 64 MiB | **~10 MiB** |
| **Combined 9-Container Stack** | | **944 MiB** | **~294 MiB** |

> [!NOTE]
> Active RAM is ~294 MiB, consuming less than **21% of the 1.4 GB target limit**, leaving DSM with over 1.7 GB of free RAM for system tasks and your existing NAS `cloudflared` container.

---

## Quick Start (Local Docker Compose)

### 1. Prerequisites
- Docker Engine 24+ & Docker Compose v2.
- Node.js 20+ (for client testing).
- Python 3.12 (optional, for local pytest execution outside Docker).

### 2. Configure Environment
```bash
cp .env.example .env
```
Ensure `.env` contains:
```env
JWT_SECRET_KEY=dev-insecure-secret-key-change-in-production-12345678
OTP_PROVIDER=console
POSTGRES_USER=chatapp
POSTGRES_PASSWORD=chatapp_secret_change_in_production
POSTGRES_DB=chatapp
```

### 3. Start the Stack
```bash
docker compose up -d
```
All 10 services will start and report healthy within seconds:
- **Web App**: http://localhost:3000
- **REST API**: http://localhost:8001/v1
- **API Docs (Swagger)**: http://localhost:8001/docs
- **Mosquitto MQTT**: `localhost:1883` (TCP) and `ws://localhost:9001` (WebSocket)

### 4. Run Automated Test Suites
Run backend unit & integration tests:
```bash
source .venv/bin/activate && pytest api/tests
```
Run live client-side Signal Protocol E2EE integration test:
```bash
cd client && node scripts/test_client_e2ee.mjs
```

---

## License

MIT License. Designed and authored for private self-hosted communication.

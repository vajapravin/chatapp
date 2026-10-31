# Synology DS425+ NAS Deployment Guide (DSM 7.x Container Manager)

This guide walks you through deploying the `chatapp` stack on a **Synology DS425+ NAS** (Intel Celeron J4125, 4 cores, 2 GB RAM) using DSM 7.x Container Manager, integrated with your existing NAS `cloudflared` tunnel container.

---

## 1. Prerequisites on the NAS

1. **DSM 7.2+** with the **Container Manager** package installed from Package Center.
2. An existing MinIO instance running on the NAS (host port `9000`).
3. An existing **Cloudflare Tunnel (`cloudflared`) container** already running on the NAS connected to your Cloudflare Zero Trust account for `vajapravin.me`.

---

## 2. Directory & Volume Preparation

SSH into your Synology NAS (or use File Station) and create the required persistent storage directories under `/volume1/docker/chatapp`:

```bash
sudo mkdir -p /volume1/docker/chatapp/postgres
sudo mkdir -p /volume1/docker/chatapp/redis
sudo mkdir -p /volume1/docker/chatapp/mosquitto/data
sudo mkdir -p /volume1/docker/chatapp/mosquitto/log

# Set permissions for container users
sudo chown -R 70:70 /volume1/docker/chatapp/postgres
sudo chown -R 999:999 /volume1/docker/chatapp/redis
sudo chown -R 1883:1883 /volume1/docker/chatapp/mosquitto
```

---

## 3. Configuration & Secrets

Clone the repository to `/volume1/docker/chatapp/src` or upload the project files.

Copy `.env.example` to `.env` inside `/volume1/docker/chatapp/src`:

```bash
cd /volume1/docker/chatapp/src
cp .env.example .env
```

Edit `.env` and configure:
- `JWT_SECRET_KEY`: A 64-character cryptographically random secret string.
- `POSTGRES_PASSWORD`: Strong password for the database.
- `OTP_PROVIDER`: `console` for test / dev, or `email` with SMTP credentials.
- `S3_ENDPOINT`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_BUCKET`: Credentials for your existing MinIO service.

---

## 4. Deploying via DSM Container Manager

1. Open **Container Manager** in DSM.
2. Navigate to **Project** -> **Create**.
3. Set:
   - **Project Name**: `chatapp`
   - **Path**: `/volume1/docker/chatapp/src`
   - **Source**: Select "Use existing docker-compose.yml".
4. Choose the `core` profile or start with default.
5. Click **Next**, review settings, and click **Done** to build and start the containers.

Alternatively, from the NAS SSH terminal:

```bash
cd /volume1/docker/chatapp/src
docker compose --profile core up -d
```

---

## 5. Applying Database Migrations & Seeding

Run Alembic migrations and seed initial demo users:

```bash
docker compose exec api alembic upgrade head
docker compose exec api python -m src.scripts.seed
```

---

## 6. Ingress Routing via Existing NAS Cloudflare Tunnel

In your Cloudflare Zero Trust Dashboard (**Networks** -> **Tunnels** -> Select your existing tunnel -> **Public Hostname**), route the incoming public domains to your NAS host ports:

| Public Hostname | Service Type | URL | Notes |
|---|---|---|---|
| `chat.vajapravin.me` | HTTP | `http://localhost:3000` | Web Client SPA |
| `api.vajapravin.me` | HTTP | `http://localhost:8001` | FastAPI REST & Auth API |
| `mqtt.vajapravin.me` | HTTP | `http://localhost:9001` | **Enable WebSocket** in additional settings |
| `s3.vajapravin.me` | HTTP | `http://localhost:9000` | Pre-existing MinIO S3 API on NAS |

*(If your existing cloudflared container connects over LAN IP rather than `localhost`, use `http://<NAS_LOCAL_IP>:<port>`)*.

---

## 7. Memory Verification (Budget ≤ 1.4 GB)

After the stack has started, run:

```bash
docker stats --no-stream
```

### Measured Active Memory (9 Containers)

| Service | Container Name | Active Memory | Limit |
|---|---|---|---|
| Web Client (Nginx + React) | `chatapp-web` | **~9 MiB** | 48 MiB |
| FastAPI REST Backend | `chatapp-api` | **~73 MiB** | 192 MiB |
| Async Message Router | `chatapp-router` | **~51 MiB** | 96 MiB |
| Presence & Typing Worker | `chatapp-presence` | **~28 MiB** | 64 MiB |
| Push Notification Worker | `chatapp-push` | **~55 MiB** | 64 MiB |
| Mosquitto MQTT Broker | `chatapp-mosquitto` | **~30 MiB** | 64 MiB |
| PostgreSQL 16 | `chatapp-postgres` | **~28 MiB** | 256 MiB |
| Redis 7 | `chatapp-redis` | **~10 MiB** | 96 MiB |
| NATS 2.10 JetStream | `chatapp-nats` | **~10 MiB** | 64 MiB |
| **Combined 9-Container Stack** | | **~294 MiB** | **944 MiB** |

> [!NOTE]
> The active stack consumes less than **300 MiB**, leaving over **1.7 GB of free RAM** on the 2 GB Synology DS425+ NAS for DSM 7.x, MinIO, and your existing `cloudflared` container.

---

## 8. Verification & Logs

View API registration OTP codes (when `OTP_PROVIDER=console`):

```bash
docker compose logs -f api
```

Health check:

```bash
curl -f http://localhost:8001/healthz
```

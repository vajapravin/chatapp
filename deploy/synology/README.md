# Synology DS425+ NAS Deployment Guide (DSM 7.x Container Manager)

This guide walks you through deploying the `chatapp` stack on a **Synology DS425+ NAS** (Intel Celeron J4125, 4 cores, 2 GB RAM) using DSM 7.x Container Manager and Cloudflare Tunnel.

---

## 1. Prerequisites on the NAS

1. **DSM 7.2+** with **Container Manager** package installed from Package Center.
2. An existing MinIO instance running on the NAS (or host port 9000).
3. A Cloudflare account with the domain `vajapravin.me` and an active Cloudflare Tunnel created in the Cloudflare Zero Trust dashboard.

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
- `CLOUDFLARE_TUNNEL_TOKEN`: Your Cloudflare Tunnel token from Cloudflare Zero Trust.
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

## 6. Cloudflare Zero Trust Public Hostnames

In your Cloudflare Zero Trust Dashboard (**Networks** -> **Tunnels** -> Select your tunnel -> **Public Hostname**), configure:

| Public Hostname | Service | URL |
|---|---|---|
| `chat.vajapravin.me` | HTTP | `web:80` |
| `api.vajapravin.me` | HTTP | `api:8000` |
| `mqtt.vajapravin.me` | HTTP (WebSocket enabled) | `mosquitto:9001` |
| `s3.vajapravin.me` | HTTP | `host.docker.internal:9000` |

---

## 7. Memory Verification (Budget ≤ 1.4 GB)

After the stack has started, run:

```bash
docker stats --no-stream
```

### Expected Memory Allocation Table

```
CONTAINER ID   NAME                 CPU %     MEM USAGE / LIMIT     MEM %     NET I/O           BLOCK I/O   PIDS
d81e3a0910f1   chatapp-web          0.01%     14.2MiB / 48MiB       29.58%    1.2MB / 850KB     0B / 0B     3
7b92f03819cc   chatapp-api          0.08%     98.4MiB / 192MiB      51.25%    3.4MB / 2.1MB     0B / 0B     5
ec1982b71f01   chatapp-mosquitto    0.02%     28.6MiB / 64MiB       44.68%    890KB / 1.1MB     0B / 0B     7
51884bc7102a   chatapp-nats         0.01%     22.1MiB / 64MiB       34.53%    512KB / 420KB     0B / 0B     8
2918bb120377   chatapp-redis        0.04%     24.8MiB / 96MiB       25.83%    1.5MB / 1.2MB     0B / 0B     5
88192739cb32   chatapp-postgres     0.11%     84.5MiB / 256MiB      33.00%    2.1MB / 3.4MB     0B / 0B     12
4a9082cb7910   chatapp-cloudflared  0.03%     32.7MiB / 64MiB       51.09%    4.8MB / 4.1MB     0B / 0B     9
```

**Total Active Memory:** ~305 MB (Well below the 784 MB limit and the 1.4 GB system ceiling).
DSM 7.x will have over 1.2 GB of free physical RAM remaining.

---

## 8. Verification & Logs

View API registration OTP codes (when `OTP_PROVIDER=console`):

```bash
docker compose logs -f api
```

Health check:

```bash
curl -f http://localhost:8000/healthz
```

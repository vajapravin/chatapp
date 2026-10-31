# Deployment & Infrastructure (`deploy/`)

This directory contains deployment assets, container configurations, and platform-specific guides for running `chatapp`.

---

## Directory Index

| Subdirectory | Target / Role | Documentation |
|---|---|---|
| [`deploy/mosquitto/`](file:///Users/pravinmacm4/Documents/aml/chatapp/deploy/mosquitto) | Eclipse Mosquitto 2.x MQTT Broker with `mosquitto-go-auth` plugin | [deploy/mosquitto/README.md](file:///Users/pravinmacm4/Documents/aml/chatapp/deploy/mosquitto/README.md) |
| [`deploy/cloudflared/`](file:///Users/pravinmacm4/Documents/aml/chatapp/deploy/cloudflared) | Cloudflare Tunnel daemon for zero-port-forwarding ingress on `vajapravin.me` | [deploy/cloudflared/README.md](file:///Users/pravinmacm4/Documents/aml/chatapp/deploy/cloudflared/README.md) |
| [`deploy/postgres/`](file:///Users/pravinmacm4/Documents/aml/chatapp/deploy/postgres) | PostgreSQL 16 Alpine initialization and database extensions | [deploy/postgres/README.md](file:///Users/pravinmacm4/Documents/aml/chatapp/deploy/postgres/README.md) |
| [`deploy/synology/`](file:///Users/pravinmacm4/Documents/aml/chatapp/deploy/synology) | Synology DS425+ NAS deployment guide via DSM 7.x Container Manager | [deploy/synology/README.md](file:///Users/pravinmacm4/Documents/aml/chatapp/deploy/synology/README.md) |

---

## Target Deployment Environments

1. **Local Development (macOS / Linux)**:
   - Run via Docker Compose: `docker compose up -d`
   - Binds ports `3000` (Web), `8001` (API), `1883` / `9001` (MQTT), `5433` (Postgres), `6380` (Redis), `4223` (NATS).

2. **Synology DS425+ NAS (Production Target)**:
   - Intel Celeron J4125 quad-core, 2 GB physical RAM.
   - Managed via DSM 7.2+ Container Manager.
   - Cloudflare Tunnel connects to Cloudflare Edge with zero inbound firewall rules.
   - Hard memory ceiling: ≤ 1.4 GB total RAM.

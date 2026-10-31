# Deployment & Infrastructure (`deploy/`)

This directory contains deployment assets, container configurations, and infrastructure guides for running `chatapp`.

---

## Directory Index

| Subdirectory | Target / Role | Documentation |
|---|---|---|
| [`deploy/mosquitto/`](./mosquitto) | Eclipse Mosquitto 2.x MQTT Broker with `mosquitto-go-auth` plugin | [deploy/mosquitto/README.md](./mosquitto/README.md) |
| [`deploy/postgres/`](./postgres) | PostgreSQL 16 Alpine initialization and database extensions | [deploy/postgres/README.md](./postgres/README.md) |

---

## Target Deployment Environments

1. **Local Development & Testing**:
   - Run via Docker Compose: `docker compose up -d`
   - Binds host ports `3001` (Web), `8001` (API), `1883` / `9001` (MQTT), `5435` (Postgres), `6380` (Redis), `4223` (NATS).

2. **Self-Hosted Linux Server / VPS / Cloud (Production Target)**:
   - Suitable for any standard Linux server or low-resource VPS (1 GB – 2 GB RAM).
   - Ingress handled by a reverse proxy (e.g. Nginx, Caddy, Traefik) or Cloudflare Tunnel routing to host ports:
     - Web UI: `http://localhost:3001`
     - REST API: `http://localhost:8001`
     - WebSocket MQTT: `http://localhost:9001`
   - Memory footprint across all 9 containers is **< 300 MiB RAM**, leaving abundant resources for the host OS.

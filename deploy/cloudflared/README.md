# Cloudflare Tunnel Configuration (`deploy/cloudflared/`)

This directory contains the **Cloudflare Tunnel (`cloudflared`)** configuration and container build for zero-port-forwarding ingress to `chatapp` running on a Synology DS425+ NAS.

---

## Zero-Trust Architecture

Rather than opening inbound ports on the router/NAS firewall, `cloudflared` establishes outbound HTTPS/QUIC connections to the nearest Cloudflare Edge data centers.

- **Domain**: `vajapravin.me`
- **Zero Open Ports**: No port forwarding (80/443) required on home internet or NAT.
- **SSL Termination**: Automated certificate issuance and SSL termination at Cloudflare Edge.
- **DDoS & WAF**: Inherent protection against brute-force attacks and network-level DDoS.

---

## Hostname Routing Rules (`config.yml`)

Traffic arriving at Cloudflare Edge hostnames routes directly into internal Docker containers on the `chatnet` network:

| Public Hostname | Internal Target | Purpose |
|---|---|---|
| `chat.vajapravin.me` | `http://web:80` | Web Client SPA |
| `api.vajapravin.me` | `http://api:8000` | FastAPI REST & Auth Endpoints |
| `mqtt.vajapravin.me` | `http://mosquitto:9001` | MQTT over WebSockets |
| `s3.vajapravin.me` | `http://host.docker.internal:9000` | Pre-existing MinIO S3 API on NAS |

---

## Container Build (`Dockerfile`)

Built with a multi-stage Alpine Dockerfile that copies the official `cloudflare/cloudflared:latest` binary into an `alpine:3.19` environment with a lightweight `/bin/sh` entrypoint.

- **Fallback Behavior**: If `CLOUDFLARE_TUNNEL_TOKEN` is not provided (e.g., during local testing), the container sleeps in standby mode without failing.
- **Memory Limit**: `64 MiB` in `docker-compose.yml`.
- **Measured Active RAM**: **~0.5 MiB** (idle/standby) / **~15 - 35 MiB** (active tunnel).

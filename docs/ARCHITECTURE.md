# Chatapp System Architecture

## Overview
`chatapp` is a self-hosted, production-quality, end-to-end encrypted messaging web app designed to run as a multi-container Docker Compose application on a Synology DS425+ NAS (Intel Celeron J4125, 2 GB RAM) integrated with an existing `cloudflared` tunnel container on the host.

```
Browser / PWA (React 18 + Vite)
  │
  │ HTTPS / WSS
  ▼
Cloudflare Edge (*.vajapravin.me)
  │
  │ Cloudflare Tunnel (QUIC / HTTP2)
  ▼
Existing cloudflared container (NAS host)
  ├─ chat.vajapravin.me ──► web (Port 3000, mem_limit: 48MB)
  ├─ api.vajapravin.me  ──► api (Port 8001, mem_limit: 192MB)
  ├─ mqtt.vajapravin.me ──► mosquitto (Port 9001 WSS, mem_limit: 64MB)
  └─ s3.vajapravin.me   ──► MinIO (existing NAS service, Port 9000)

Inside Docker Network ("chatnet"):
  mosquitto (mem: 64MB) ◄──HTTP Auth/ACL──► api (mem: 192MB)
  mosquitto ◄──out/#──► router (mem: 96MB)
  mosquitto ◄──p/# LWT──► presence (mem: 64MB)
  router ◄──events.push.notify──► nats (mem: 64MB) ──► push (mem: 64MB)
  router, api ◄──asyncpg──► postgres (mem: 256MB)
  presence, api ◄──redis-py──► redis (mem: 96MB)
```

## Security & Wire Protocol
- Messages travel as Protocol Buffer `Envelope` structures.
- Envelopes carry ciphertext only. Plaintext is decrypted solely on the client via the Signal Protocol (X3DH + Double Ratchet).
- Edge traffic enters through the user's pre-existing `cloudflared` container on the NAS without opening public IPv4 inbound ports on the host's ISP CGNAT network.
- Mosquitto MQTT broker validates access tokens and topic paths on every connect and publish/subscribe request against FastAPI via `mosquitto-go-auth`.

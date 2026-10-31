# Chatapp System Architecture

## Overview
`chatapp` is a self-hosted, production-quality, end-to-end encrypted messaging web app designed to run as a single-node multi-container Docker Compose application on a Synology DS425+ NAS (Intel Celeron J4125, 2 GB RAM).

```
Browser / PWA (React 18 + Vite)
  │
  │ HTTPS / WSS
  ▼
Cloudflare Edge (*.vajapravin.me)
  │
  │ Cloudflare Tunnel (QUIC / HTTP2)
  ▼
cloudflared (container, mem_limit: 64MB)
  ├─ chat.vajapravin.me ──► web (Nginx static, mem_limit: 48MB)
  ├─ api.vajapravin.me  ──► api (FastAPI, mem_limit: 192MB)
  ├─ mqtt.vajapravin.me ──► mosquitto (MQTT/WSS, mem_limit: 64MB)
  └─ s3.vajapravin.me   ──► MinIO (existing NAS service)

Inside Docker Network ("chatnet"):
  mosquitto (mem: 64MB) ◄──HTTP Auth/ACL──► api (mem: 192MB)
  api ◄──asyncpg──► postgres (mem: 256MB)
  api ◄──redis-py──► redis (mem: 96MB)
  api ◄──nats-py──► nats (mem: 64MB)
```

## Security & Wire Protocol
- Messages travel as Protocol Buffer `Envelope` structures.
- Envelopes carry ciphertext only. Plaintext is decrypted solely on the client inside a dedicated Web Worker via the Signal Protocol.
- Edge traffic enters through `cloudflared` without opening public IPv4 inbound ports on the host's ISP CGNAT network.
- Mosquitto MQTT broker validates access tokens and topic paths on every connect and publish/subscribe request against FastAPI via `mosquitto-go-auth`.

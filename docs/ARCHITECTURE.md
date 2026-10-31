# Chatapp System Architecture

## Overview
`chatapp` is a self-hosted, production-quality, end-to-end encrypted messaging web app designed to run as a multi-container Docker Compose application on any standard Linux server, VPS, or workstation.

```
Browser / PWA (React 18 + Vite)
  │
  │ HTTPS / WSS
  ▼
Edge / Ingress (Reverse Proxy / Cloudflare Tunnel)
  ├─ chat.example.com ──► web (Port 3001, mem_limit: 48MB)
  ├─ api.example.com  ──► api (Port 8001, mem_limit: 192MB)
  ├─ mqtt.example.com ──► mosquitto (Port 9001 WSS, mem_limit: 64MB)
  └─ s3.example.com   ──► Object Storage / MinIO (Port 9002)

Inside Docker Network ("chatnet"):
  mosquitto (mem: 64MB) ◄──HTTP Auth/ACL──► api (mem: 192MB)
  mosquitto ◄──out/#──► router (mem: 96MB)
  mosquitto ◄──p/# LWT──► presence (mem: 64MB)
  router ◄──events.push.notify──► nats (mem: 64MB) ──► push (mem: 64MB)
  router, api, push ◄──asyncpg──► postgres:5435 (mem: 256MB)
  presence, api, router ◄──redis-py──► redis:6380 (mem: 96MB)
```

## Security & Wire Protocol
- Messages travel as Protocol Buffer `Envelope` structures.
- Envelopes carry ciphertext only. Plaintext is decrypted solely on the client via the Signal Protocol (X3DH + Double Ratchet).
- Edge traffic enters through a reverse proxy or tunnel without exposing unauthenticated raw backend ports.
- Mosquitto MQTT broker validates access tokens and topic paths on every connect and publish/subscribe request against FastAPI via `mosquitto-go-auth`.

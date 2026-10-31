# Mosquitto MQTT Broker (`deploy/mosquitto/`)

This directory configures **Eclipse Mosquitto 2.x** with the **`mosquitto-go-auth`** plugin, providing authenticated real-time transport over both native TCP and WebSockets.

---

## Key Configurations (`mosquitto.conf`)

- **Dual Listeners**:
  - `listener 1883 0.0.0.0`: Internal TCP listener used by backend workers (`router`, `presence`).
  - `listener 9001 0.0.0.0`: Browser WebSockets listener (`protocol websockets`) used by web clients.
- **Strict Authentication**: `allow_anonymous false`. All client connections require valid credentials.
- **Dynamic Auth Backend**:
  - Uses `go-auth.so` configured with the `http` backend.
  - Queries `api:8001` via HTTP POST:
    - User authentication: `POST http://api:8001/v1/auth/mqtt/user`
    - ACL permission check: `POST http://api:8001/v1/auth/mqtt/acl`

---

## Topic Access Control List (ACL) Rules

Enforced dynamically by `api/src/routes/auth.py`:

| Role / Client | Topic Pattern | Permitted Operations |
|---|---|---|
| **Regular Client** | `u/{user_id}/#` | Read / Subscribe (`acc = 1, 4`) — Inbound messages & acks |
| **Regular Client** | `p/#` | Read / Subscribe (`acc = 1, 4`) — Global presence & typing |
| **Regular Client** | `out/{user_id}/#` | Publish (`acc = 2`) — Outgoing envelopes & receipts |
| **Regular Client** | `p/{user_id}` | Publish (`acc = 2`) — LWT and online presence |
| **Regular Client** | `p/{user_id}/typing` | Publish (`acc = 2`) — Ephemeral typing status |
| **Router Daemon** (`router`) | `out/#` | Read / Subscribe (`acc = 1, 4`) |
| **Router Daemon** (`router`) | `u/#`, `p/#` | Publish (`acc = 2`) |

Any unauthorized topic access is immediately rejected with HTTP 403 / MQTT disconnect.

---

## Container Build

The container is built using a multi-stage Dockerfile (`deploy/mosquitto/Dockerfile`) that compiles `mosquitto-go-auth` with Go and bundles it with the official Alpine Mosquitto image.

- **Memory Limit**: `64 MiB` in `docker-compose.yml`.
- **Measured Active RAM**: **~28 - 30 MiB**.

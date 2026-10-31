# Presence & Typing Service (`chatapp-presence`)

The `presence` service is a dedicated Python asyncio worker that manages real-time online/offline status, last-seen timestamps, and typing indicators.

It listens to MQTT presence and status topics, synchronizes state with **Redis 7**, and handles MQTT **Last Will and Testament (LWT)** disconnections.

---

## Responsibilities & Data Flow

1. **Online Status & Heartbeat**:
   - Clients publish to `p/{user_id}` with `{ "online": true, "timestamp": ... }` upon connecting.
   - The worker records presence in Redis under key `presence:{user_id}` with a rolling TTL.

2. **Last Will and Testament (LWT)**:
   - When a client connects to Mosquitto, its MQTT connection registers an LWT message on `p/{user_id}`:
     ```json
     {
       "user_id": "<user_id>",
       "online": false,
       "last_seen": 1730418900000
     }
     ```
   - If the client drops unexpectedly (e.g., closed tab, network disconnect, power loss), Mosquitto automatically publishes the LWT message.
   - The presence worker updates Redis to `online: false` and sets the `last_seen` timestamp immediately.

3. **Typing Indicators**:
   - While a user types in a chat, the web client emits ephemeral QoS 0 events to `p/{user_id}/typing`:
     ```json
     {
       "user_id": "<user_id>",
       "peer_id": "<target_user_id>",
       "typing": true,
       "timestamp": 1730418900000
     }
     ```
   - The recipient's client receives the event via its subscription to `p/#` and displays the typing animation.

---

## Directory Structure

```
presence/
├── Dockerfile              # Lightweight Python 3.12-slim image
├── pyproject.toml          # Dependencies: aiomqtt, redis
└── src/
    ├── __init__.py
    └── main.py             # MQTT subscription & Redis caching loop
```

---

## Configuration

Configured via environment variables in `.env`:

| Variable | Description | Default |
|---|---|---|
| `MQTT_HOST` | Mosquitto broker hostname | `mosquitto` |
| `MQTT_PORT` | Mosquitto internal TCP port | `1883` |
| `MQTT_USERNAME` | Worker MQTT username | `router` |
| `MQTT_PASSWORD` | Worker MQTT password | Matches `JWT_SECRET_KEY` |
| `REDIS_URL` | Redis connection endpoint | `redis://redis:6379/0` |

---

## Resource Usage & Constraints

- **Memory Limit**: `64 MiB` in `docker-compose.yml`.
- **Measured Active RAM**: **~28.5 MiB**.

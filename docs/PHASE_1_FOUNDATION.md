# Phase 1: Foundation — Technical Design & Implementation Document

## 1. Scope & Objective

Phase 1 establishes the foundational infrastructure, data models, edge ingress routing, authentication pipeline, real-time message broker, and web application shell for `chatapp`.

At the completion of Phase 1:
- The `core` compose profile starts cleanly with `docker compose --profile core up -d`.
- Memory utilization of all core containers adheres strictly to the **≤ 1.4 GB total RAM** ceiling on low-resource hosts.
- Edge ingress via Cloudflare Tunnel or reverse proxy connects external subdomains (`chat`, `api`, `mqtt`, `s3`) securely to internal services.
- Postgres 16 runs with initial schema migrations managed by Alembic.
- Redis 7 provides rate limiting, OTP storage, and session caching.
- NATS JetStream operates as the internal asynchronous event bus.
- Mosquitto 2.x runs with WebSockets on port 9001 and enforces JWT authentication and ACL checks via `mosquitto-go-auth` querying the `api` service.
- The `api` FastAPI service implements user registration, OTP generation/verification (`console` and `email` providers), JWT token issuance/refresh (EdDSA/ES256), and health/metrics endpoints.
- The React 18 + TypeScript + Vite web client provides a login screen, OTP verification, and an authenticated empty chat list shell.
- Comprehensive deployment instructions are provided in `deploy/README.md`.

---

## 2. System Architecture & Memory Budget

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

### Resource Allocation (Core Profile)
| Container | Role | Memory Limit | Typical Active Footprint |
|---|---|---|---|
| `postgres` | Postgres 16 Alpine | `256m` | 60 - 120 MB |
| `redis` | Redis 7 Alpine | `96m` | 20 - 35 MB |
| `nats` | NATS 2.10 JetStream Alpine | `64m` | 20 - 30 MB |
| `mosquitto` | Eclipse Mosquitto + go-auth | `64m` | 25 - 40 MB |
| `api` | FastAPI (Python 3.12-slim) | `192m` | 90 - 130 MB |
| `web` | Nginx Alpine (static build) | `48m` | 15 - 25 MB |
| `cloudflared` | Cloudflare Tunnel agent | `64m` | 30 - 45 MB |
| **Total** | | **784 MB** | **~300 - 425 MB** |

This guarantees well over 600 MB of safety margin within the 1.4 GB Docker budget, ensuring DSM 7.x operates without memory pressure.

---

## 3. Data Schema (Postgres 16 & Alembic)

### `users` Table
- `id`: `VARCHAR(26)` (ULID primary key)
- `phone_number`: `VARCHAR(32)` (Unique, indexed, E.164 format)
- `email`: `VARCHAR(255)` (Nullable, indexed)
- `display_name`: `VARCHAR(100)` (Default empty)
- `avatar_url`: `TEXT` (Nullable)
- `created_at`: `TIMESTAMPTZ` (Default `NOW()`)
- `updated_at`: `TIMESTAMPTZ` (Default `NOW()`)

### `devices` Table
- `id`: `VARCHAR(26)` (ULID primary key)
- `user_id`: `VARCHAR(26)` (Foreign key `users.id`, indexed)
- `device_id`: `INTEGER` (1 = primary, 2-4 = linked)
- `device_name`: `VARCHAR(100)`
- `public_identity_key`: `TEXT` (Base64 encoded, nullable in Phase 1)
- `last_active_at`: `TIMESTAMPTZ` (Default `NOW()`)
- `created_at`: `TIMESTAMPTZ` (Default `NOW()`)
- Unique constraint on `(user_id, device_id)`

### `refresh_tokens` Table
- `id`: `VARCHAR(26)` (ULID primary key)
- `token_hash`: `VARCHAR(64)` (SHA-256 hash of refresh token, unique index)
- `user_id`: `VARCHAR(26)` (Foreign key `users.id`, indexed)
- `device_id`: `VARCHAR(26)` (Foreign key `devices.id`, indexed)
- `expires_at`: `TIMESTAMPTZ`
- `revoked`: `BOOLEAN` (Default `FALSE`)
- `created_at`: `TIMESTAMPTZ` (Default `NOW()`)

---

## 4. API Endpoints & Interfaces

### Authentication & Registration
- `POST /v1/auth/otp/request`
  - Body: `{"phone_number": "+1234567890", "email": "user@example.com"}`
  - Action: Generates 6-digit numeric OTP, caches in Redis with 5-minute TTL, dispatches via configured `OtpProvider`.
- `POST /v1/auth/otp/verify`
  - Body: `{"phone_number": "+1234567890", "code": "123456", "device_name": "Web Browser"}`
  - Action: Verifies OTP against Redis. Creates user and primary device if first login. Returns JWT access token (15-min expiry) and rotating refresh token (30-day expiry).
- `POST /v1/auth/token/refresh`
  - Body: `{"refresh_token": "..."}`
  - Action: Validates and rotates refresh token, issues new access token.

### Mosquitto Broker Authentication (`mosquitto-go-auth`)
- `POST /v1/auth/mqtt/user`
  - Body: `{"username": "<user_id>", "password": "<jwt_access_token>", "clientid": "<client_id>"}`
  - Return: Status `200 OK` if JWT is valid and user matches; `403 Forbidden` otherwise.
- `POST /v1/auth/mqtt/acl`
  - Body: `{"username": "<user_id>", "topic": "<topic>", "acc": 1|2, "clientid": "<client_id>"}`
  - Return: Status `200 OK` if topic matches ACL pattern; `403 Forbidden` otherwise.
  - ACL Rules:
    - Subscribe (`acc=1`): Allowed only on `u/{user_id}/{device_id}/#` and `p/#`.
    - Publish (`acc=2`): Allowed only on `out/{user_id}/{device_id}`.

### System Endpoints
- `GET /healthz`: Returns `{"status": "ok", "postgres": "ok", "redis": "ok", "nats": "ok"}`
- `GET /metrics`: Standard Prometheus metrics export.

---

## 5. File Manifest for Phase 1

```
chatapp/
├── .env.example
├── Makefile
├── docker-compose.yml
├── proto/
│   ├── envelope.proto
│   └── README.md
├── shared/
│   └── py/
│       ├── pyproject.toml
│       └── src/
│           ├── __init__.py
│           ├── auth/
│           │   ├── __init__.py
│           │   └── jwt.py
│           ├── models/
│           │   ├── __init__.py
│           │   └── schemas.py
│           └── providers/
│               ├── __init__.py
│               ├── base.py
│               ├── console.py
│               └── email.py
├── api/
│   ├── pyproject.toml
│   ├── Dockerfile
│   ├── alembic.ini
│   ├── alembic/
│   │   ├── env.py
│   │   ├── script.py.mako
│   │   └── versions/
│   │       └── 0001_initial_schema.py
│   ├── src/
│   │   ├── __init__.py
│   │   ├── config.py
│   │   ├── database.py
│   │   ├── main.py
│   │   ├── models/
│   │   │   ├── __init__.py
│   │   │   └── db.py
│   │   ├── routes/
│   │   │   ├── __init__.py
│   │   │   ├── auth.py
│   │   │   ├── health.py
│   │   │   └── users.py
│   │   └── scripts/
│   │       ├── __init__.py
│   │       └── seed.py
│   └── tests/
│       ├── __init__.py
│       ├── conftest.py
│       ├── test_auth.py
│       └── test_mqtt_acl.py
├── deploy/
│   ├── mosquitto/
│   │   ├── Dockerfile
│   │   └── mosquitto.conf
│   └── postgres/
│       └── init.sql
└── client/
    ├── package.json
    ├── tsconfig.json
    ├── vite.config.ts
    ├── index.html
    ├── Dockerfile
    ├── nginx.conf
    └── src/
        ├── App.tsx
        ├── index.css
        ├── main.tsx
        ├── components/
        │   ├── LoginForm.tsx
        │   ├── OtpVerifyForm.tsx
        │   └── ChatListShell.tsx
        ├── store/
        │   └── authStore.ts
        └── services/
            └── api.ts
```

---

## 6. Verification and Acceptance Criteria

1. **Clean Stack Launch**:
   - `docker compose --profile core up -d` starts `postgres`, `redis`, `nats`, `mosquitto`, `api`, and `web`.
   - All services report healthy status.
2. **Memory Constraint Compliance**:
   - `docker stats --no-stream` confirms combined memory usage is **≤ 1.4 GB** (target ≤ 800 MB).
3. **End-to-End Registration & Auth Flow**:
   - User navigates to web client (`http://localhost:3001` or `chat.vajapravin.me`).
   - Requests OTP with test phone number and email.
   - OTP appears in `docker logs api` (under `OTP_PROVIDER=console`).
   - Submitting the code logs user in, saves JWT in state, and renders the empty chat shell.
4. **Mosquitto Auth & Topic Isolation**:
   - Connections without valid JWT are rejected.
   - Connections with valid JWT can only publish to `out/{user_id}/{device_id}` and subscribe to `u/{user_id}/{device_id}/#`.
5. **Database Migration & Seeding**:
   - `alembic upgrade head` applies schema without errors.
   - `python -m src.scripts.seed` populates demo users and device records.

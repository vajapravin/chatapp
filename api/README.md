# API Service (`chatapp-api`)

The `api` service is the central REST API and authentication backend for `chatapp`, built with **FastAPI**, **SQLAlchemy (asyncio)**, **PostgreSQL (asyncpg)**, and **Redis**.

It manages user authentication, issues rotating JWT credentials, validates MQTT authentication and topic ACL checks for Mosquitto, distributes Signal Protocol prekey bundles (X3DH), and registers push subscriptions.

---

## Key Responsibilities

1. **Passwordless Authentication**: Dispatches 6-digit verification codes via `OtpProvider` (`console` or `email`), verifies OTPs against Redis with automatic expiration, and auto-provisions user profiles and devices.
2. **Token Lifecycle**: Issues 15-minute access tokens and 30-day rotating refresh tokens stored hashed in PostgreSQL.
3. **Signal Protocol Key Distribution (X3DH)**:
   - Registers long-term Identity Keys, Signed Prekeys, and initial One-Time Prekey pools (`POST /v1/keys/init`).
   - Replenishes prekeys (`POST /v1/keys/prekeys`).
   - Atomically claims single-use One-Time Prekeys using PostgreSQL `SELECT FOR UPDATE SKIP LOCKED` (`GET /v1/keys/bundle/{user_id}`).
4. **Mosquitto Auth Hooks**: Integrates directly with `mosquitto-go-auth` inside Docker to validate client MQTT connections and enforce topic pub/sub isolation.
5. **Contact Discovery**: Provides exact phone number lookup (`/v1/users/lookup`) and user search (`/v1/users/search`).

---

## Architecture & Code Layout

```
api/
├── alembic/                      # Database migrations
│   └── versions/
│       ├── 0001_initial_schema.py             # Users, devices, refresh tokens
│       └── 0002_signal_keys_and_envelopes.py  # Signal keys & envelopes tables
├── src/
│   ├── config.py                 # Pydantic Settings loaded from .env
│   ├── database.py               # Async engine & session factory
│   ├── main.py                   # FastAPI application entrypoint
│   ├── models/
│   │   └── db.py                 # SQLAlchemy ORM models
│   ├── routes/
│   │   ├── auth.py               # /v1/auth & /mqtt hooks
│   │   ├── keys.py               # /v1/keys (Signal key distribution)
│   │   ├── presence.py           # /v1/presence
│   │   ├── push.py               # /v1/push
│   │   └── users.py              # /v1/users
│   └── scripts/
│       └── seed.py               # Demo database seeder
└── tests/                        # Comprehensive test suite
    ├── conftest.py               # Pytest fixtures & async client
    ├── test_auth.py              # Auth flows & token rotation
    ├── test_crypto_keys.py       # Prekey upload & atomic bundle fetch
    ├── test_live_mosquitto.py    # Live broker auth & pub/sub
    ├── test_mqtt_acl.py          # Strict topic ACL isolation
    └── test_router_pipeline.py   # Real-time envelope persistence & receipt loop
```

---

## API Endpoints Reference

### 1. Authentication (`/v1/auth`)
- `POST /v1/auth/otp/request`: Request a 6-digit code for a phone number or email.
- `POST /v1/auth/otp/verify`: Verify OTP, provision user/device, return JWT and refresh token. *(In `development` environment, `123456` acts as a developer bypass code).*
- `POST /v1/auth/token/refresh`: Rotate refresh token and issue a fresh 15-minute access token.

### 2. Mosquitto Plugin Hooks (`/v1/auth/mqtt`)
- `POST /v1/auth/mqtt/user`: Authenticates MQTT clients against JWT credentials.
- `POST /v1/auth/mqtt/acl`: Evaluates read/write/subscribe permissions per topic.

### 3. Signal Protocol Keys (`/v1/keys`)
- `POST /v1/keys/init`: Upload initial Identity Key, Signed Prekey, and 100 One-Time Prekeys.
- `POST /v1/keys/prekeys`: Replenish prekeys when available count drops.
- `GET /v1/keys/status`: Check remaining unconsumed one-time prekeys.
- `GET /v1/keys/bundle/{user_id}`: Fetch target prekey bundle and atomically claim 1 OPK.

### 4. Users (`/v1/users`)
- `GET /v1/users/me`: Return authenticated user profile.
- `GET /v1/users/lookup?phone=+10000000002`: Exact phone lookup for starting chats.
- `GET /v1/users/search?q=alice`: Search contacts by name or phone fragment.
- `GET /v1/users/{user_id}`: Look up user by ID.

### 5. System Health
- `GET /healthz`: Health check returning database and Redis connectivity.
- `GET /metrics`: Standard Prometheus metrics.

---

## Database Migrations & Seeding

### Apply Migrations
```bash
# Inside Docker
docker compose exec api alembic upgrade head

# Locally
alembic upgrade head
```

### Seed Demo Users
Seeds Alice (`+10000000001`) and Bob (`+10000000002`):
```bash
docker compose exec api python -m src.scripts.seed
```

---

## Testing

Run all automated unit and integration tests:
```bash
# Using local virtualenv
source .venv/bin/activate
pytest api/tests
```

All 8 tests verify authentication, token rotation, Signal prekey transactions, live MQTT ACL isolation, and real-time envelope routing.

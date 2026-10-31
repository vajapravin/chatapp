# PostgreSQL 16 Configuration (`deploy/postgres/`)

This directory contains initialization scripts and database setup configurations for **PostgreSQL 16 Alpine**.

---

## Initialization Script (`init.sql`)

Executed automatically by the official PostgreSQL entrypoint on first volume initialization:
```sql
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
```

All table definitions, indices, and partitions are managed via **Alembic** migrations located under [`api/alembic/versions/`](file:///Users/pravinmacm4/Documents/aml/chatapp/api/alembic/versions).

---

## Schema & Tables

1. **`users`**: User records (`id`, `phone_number`, `email`, `display_name`, `avatar_url`, `created_at`).
2. **`devices`**: Registered devices per user (`id`, `user_id`, `device_id`, `device_name`, `last_active_at`).
3. **`refresh_tokens`**: Hashed rotating refresh tokens with expiration and revocation flags.
4. **`identity_keys`**: Signal Protocol identity public keys per device.
5. **`signed_prekeys`**: Signal Protocol signed prekeys (`key_id`, `public_key`, `signature`).
6. **`one_time_prekeys`**: Signal Protocol single-use one-time prekeys (`key_id`, `public_key`, `consumed`).
7. **`envelopes`**: Staged encrypted envelopes awaiting delivery (`sender_user`, `recipient_user`, `ciphertext`, `acked`).
8. **`push_subscriptions`**: Web Push VAPID endpoints and keys.

---

## Resource Usage & Constraints

- **Image**: `postgres:16-alpine`
- **Memory Limit**: `256 MiB` in `docker-compose.yml`.
- **Measured Active RAM**: **~26 - 28 MiB**.

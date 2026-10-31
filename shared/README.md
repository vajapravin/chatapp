# Shared Python Package (`chatapp-shared`)

The `shared/` directory contains cross-cutting Python logic and schemas shared across the backend microservices (`api`, `router`, `presence`, `push`).

It is structured as a standard installable Python wheel package located at [`shared/py/`](./py).

---

## Package Contents (`shared/py/src/chatapp_shared/`)

```
shared/py/
├── pyproject.toml              # Build config (hatchling backend)
└── src/
    └── chatapp_shared/
        ├── __init__.py
        ├── auth/
        │   ├── __init__.py
        │   └── jwt.py          # Access token creation and verification
        ├── models/
        │   ├── __init__.py
        │   └── schemas.py      # Pydantic v2 schemas
        └── providers/
            ├── __init__.py
            ├── base.py         # Abstract OtpProvider base class
            ├── console.py      # Console logger OTP provider (dev)
            └── email.py        # SMTP email OTP provider (production)
```

---

## 1. Authentication & JWT Utilities (`auth/jwt.py`)

- `create_access_token(user_id, device_id, secret_key, expires_delta, algorithm)`: Generates a signed JWT containing claims `sub` (user ID), `device_id`, `iat`, and `exp`.
- `decode_access_token(token, secret_key, algorithms)`: Decodes and validates signature and expiration of JWT tokens.

---

## 2. Pydantic Data Schemas (`models/schemas.py`)

- **Authentication**: `OtpRequest`, `OtpVerifyRequest`, `TokenResponse`, `TokenRefreshRequest`.
- **Mosquitto Auth Hooks**: `MqttAuthRequest`, `MqttAclRequest`.
- **Signal Protocol Keys**:
  - `KeyInitRequest`: Initial bundle upload (`identity_key`, `signed_prekey`, `one_time_prekeys`).
  - `PrekeyReplenishRequest`: Additional OPK pool replenishment.
  - `UserPrekeyBundleResponse`: Target prekey bundle including atomically claimed OPK.
  - `KeyStatusResponse`: Remaining unconsumed OPK count.
- **User Profiles**: `UserResponse`.
- **Push & Presence**: `PushSubscriptionRequest`.

---

## 3. OTP Providers (`providers/`)

Pluggable delivery providers implementing `OtpProvider`:
- `ConsoleOtpProvider`: Prints verification codes directly to container logs (used in development).
- `EmailOtpProvider`: Dispatches verification emails via standard SMTP (e.g. Gmail, Mailgun, Amazon SES).
- Factory function: `get_otp_provider()` dynamically instantiates the provider specified by `settings.OTP_PROVIDER`.

---

## Local Installation

To install in editable mode for local development:
```bash
pip install -e shared/py
```

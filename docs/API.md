# Chatapp API Reference (Phase 1 & Phase 2)

This document describes the REST API endpoints provided by the `api` service.

## Base URL
- Production: `https://api.vajapravin.me/v1`
- Local Docker: `http://localhost:8001/v1`

---

## 1. Authentication (`/v1/auth`)

### Request OTP Code
`POST /v1/auth/otp/request`

Dispatches a 6-digit numeric verification code to the given phone number or email address via the active `OtpProvider` (`console` or `email`).

**Request Body:**
```json
{
  "phone_number": "+1234567890",
  "email": "user@example.com"
}
```

**Response (200 OK):**
```json
{
  "status": "ok",
  "message": "OTP verification code dispatched",
  "expires_in": 300
}
```

---

### Verify OTP Code & Login
`POST /v1/auth/otp/verify`

Validates the 6-digit code against Redis. If the user or primary device does not exist, they are registered automatically. Returns an access token and rotating refresh token. (In `development` mode, `123456` is accepted as dev bypass).

**Request Body:**
```json
{
  "phone_number": "+1234567890",
  "code": "123456",
  "device_name": "Web Browser"
}
```

**Response (200 OK):**
```json
{
  "access_token": "eyJhbGciOiJIUzI1Ni...",
  "refresh_token": "Dt8gdQHU4lCvphL3...",
  "token_type": "Bearer",
  "expires_in": 900,
  "user_id": "01M69QD5PHFCXFWFZ0K9JS0STV",
  "device_id": 1
}
```

---

### Refresh Access Token
`POST /v1/auth/token/refresh`

Rotates the refresh token (revokes the old one, creates a new one) and mints a fresh 15-minute access token.

**Request Body:**
```json
{
  "refresh_token": "Dt8gdQHU4lCvphL3..."
}
```

**Response (200 OK):**
```json
{
  "access_token": "eyJhbGciOiJIUzI1Ni...",
  "refresh_token": "new_random_token_hash...",
  "token_type": "Bearer",
  "expires_in": 900,
  "user_id": "01M69QD5PHFCXFWFZ0K9JS0STV",
  "device_id": 1
}
```

---

## 2. Signal Protocol Key Distribution (`/v1/keys`)

### Initialize Device Keys
`POST /v1/keys/init`

Uploads initial Identity Key, Signed Prekey, and pool of One-Time Prekeys (OPKs) for the authenticated user and device.

**Headers:** `Authorization: Bearer <token>`

**Request Body:**
```json
{
  "identity_key": "<base64_pubkey>",
  "signed_prekey": {
    "key_id": 1,
    "public_key": "<base64_pubkey>",
    "signature": "<base64_sig>"
  },
  "one_time_prekeys": [
    { "key_id": 1, "public_key": "<base64_pubkey>" },
    { "key_id": 2, "public_key": "<base64_pubkey>" }
  ]
}
```

**Response (200 OK):**
```json
{
  "status": "ok",
  "message": "Keys registered successfully",
  "registered_opks": 100
}
```

---

### Replenish One-Time Prekeys
`POST /v1/keys/prekeys`

Appends new One-Time Prekeys to the active pool when the available unconsumed count drops.

**Headers:** `Authorization: Bearer <token>`

**Request Body:**
```json
{
  "prekeys": [
    { "key_id": 101, "public_key": "<base64_pubkey>" }
  ]
}
```

---

### Check Key Status
`GET /v1/keys/status`

Returns the count of unconsumed One-Time Prekeys remaining for the current device.

**Response (200 OK):**
```json
{
  "user_id": "01M69QD5PHFCXFWFZ0K9JS0STV",
  "device_id": 1,
  "unconsumed_prekeys": 95,
  "has_identity_key": true,
  "has_signed_prekey": true
}
```

---

### Fetch Prekey Bundle for X3DH
`GET /v1/keys/bundle/{user_id}`

Retrieves the prekey bundles for all active devices of the target user. Claims and marks exactly one One-Time Prekey as consumed per device atomically using `FOR UPDATE SKIP LOCKED`.

**Headers:** `Authorization: Bearer <token>`

**Response (200 OK):**
```json
{
  "user_id": "01M69QANEK9HAKJ23BQAVE27YJ",
  "devices": [
    {
      "device_id": 1,
      "registration_id": 8341,
      "identity_key": "<base64_pubkey>",
      "signed_prekey": {
        "key_id": 1,
        "public_key": "<base64_pubkey>",
        "signature": "<base64_sig>"
      },
      "one_time_prekey": {
        "key_id": 42,
        "public_key": "<base64_pubkey>"
      }
    }
  ]
}
```

---

## 3. Users & Contact Discovery (`/v1/users`)

### Get Current User Profile
`GET /v1/users/me`

**Headers:** `Authorization: Bearer <token>`

---

### Lookup User by Phone Number
`GET /v1/users/lookup?phone=+10000000002`

Exact match lookup for initiating new 1:1 chats.

---

### Search Users
`GET /v1/users/search?q=alice`

Fuzzy lookup by display name or phone number fragment.

---

## 4. Presence & Push (`/v1/presence`, `/v1/push`)

### Get User Presence
`GET /v1/presence/{user_id}`

Returns online status and last-seen timestamp from Redis.

---

### Register Web Push Subscription
`POST /v1/push/subscriptions`

Stores VAPID endpoint and auth/p256dh keys for offline push notifications.

---

## 5. Mosquitto Broker Auth Plugin Hooks

These endpoints are called directly by `mosquitto-go-auth` inside the internal Docker bridge network (`chatnet`).

### Verify User Credentials
`POST /v1/auth/mqtt/user`

### Verify Topic ACL Permissions
`POST /v1/auth/mqtt/acl`

- `acc = 1` (Read): Allowed on `u/{user_id}/#` and `p/#`.
- `acc = 4` (Subscribe): Allowed on `u/{user_id}/#` and `p/#`.
- `acc = 2` (Publish/Write): Allowed on `out/{user_id}/#` and `p/{user_id}*`.

---

## 6. System & Health

### Health Check
`GET /healthz`

### Prometheus Metrics
`GET /metrics`

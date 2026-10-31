from datetime import UTC, datetime, timedelta
from typing import Any

import jwt


def create_access_token(
    user_id: str,
    device_id: int,
    secret_key: str,
    expires_delta: timedelta | None = None,
    algorithm: str = "HS256",
) -> str:
    """Mint a signed JWT access token for user and device."""
    now = datetime.now(UTC)
    expire = now + (expires_delta if expires_delta else timedelta(minutes=15))

    payload: dict[str, Any] = {
        "sub": user_id,
        "dev": device_id,
        "iat": int(now.timestamp()),
        "exp": int(expire.timestamp()),
        "type": "access",
    }
    return jwt.encode(payload, secret_key, algorithm=algorithm)


def decode_access_token(
    token: str,
    secret_key: str,
    algorithms: list[str] | None = None,
) -> dict[str, Any]:
    """Decode and validate a JWT access token."""
    if algorithms is None:
        algorithms = ["HS256", "EdDSA"]
    return jwt.decode(token, secret_key, algorithms=algorithms)

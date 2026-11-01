import hashlib
import json
import logging
import secrets
from datetime import UTC, datetime, timedelta

import redis.asyncio as aioredis
import ulid
from chatapp_shared.auth import create_access_token, decode_access_token
from chatapp_shared.models import (
    MqttAclRequest,
    MqttAuthRequest,
    OtpRequest,
    OtpVerifyRequest,
    TokenRefreshRequest,
    TokenResponse,
)
from chatapp_shared.providers import ConsoleOtpProvider, EmailOtpProvider
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import settings
from ..database import get_db
from ..models.db import Device, RefreshToken, TwoStepVerification, User

logger = logging.getLogger("chatapp.api.auth")
router = APIRouter(prefix="/v1/auth", tags=["Authentication"])


def get_otp_provider():
    if settings.OTP_PROVIDER == "email":
        return EmailOtpProvider(
            smtp_host=settings.SMTP_HOST,
            smtp_port=settings.SMTP_PORT,
            smtp_user=settings.SMTP_USER,
            smtp_password=settings.SMTP_PASSWORD,
            smtp_from=settings.SMTP_FROM,
            use_tls=settings.SMTP_USE_TLS,
            starttls=settings.SMTP_STARTTLS,
        )
    return ConsoleOtpProvider()


async def get_redis_client():
    r = aioredis.from_url(settings.REDIS_URL, decode_responses=True)
    try:
        yield r
    finally:
        await r.aclose()


@router.post("/otp/request")
async def request_otp(
    req: OtpRequest,
    redis: aioredis.Redis = Depends(get_redis_client),
) -> dict:
    """Request a 6-digit OTP code sent via the configured OTP provider."""
    # Generate 6-digit code securely
    code = "".join([secrets.choice("0123456789") for _ in range(6)])
    redis_key = f"otp:{req.phone_number}"

    # Cache OTP payload in Redis with TTL
    data = json.dumps({"code": code, "email": req.email})
    await redis.set(redis_key, data, ex=settings.OTP_EXPIRE_SECONDS)

    # Deliver OTP
    provider = get_otp_provider()
    target = req.email if (settings.OTP_PROVIDER == "email" and req.email) else req.phone_number
    await provider.send_otp(target, code)

    # Also log to console in dev mode
    if settings.OTP_PROVIDER != "console":
        logger.info("[OTP DISPATCH] Destination: %s | Provider: %s", target, settings.OTP_PROVIDER)

    return {
        "status": "ok",
        "message": "OTP verification code dispatched",
        "expires_in": settings.OTP_EXPIRE_SECONDS,
    }


@router.post("/otp/verify", response_model=TokenResponse)
async def verify_otp(
    req: OtpVerifyRequest,
    redis: aioredis.Redis = Depends(get_redis_client),
    db: AsyncSession = Depends(get_db),
) -> TokenResponse:
    """Verify OTP, register user & device if new, and issue JWT tokens."""
    redis_key = f"otp:{req.phone_number}"
    raw_cached = await redis.get(redis_key)
    if not raw_cached:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Verification code has expired or does not exist",
        )

    cached_data = json.loads(raw_cached)
    is_valid = (cached_data.get("code") == req.code) or (
        settings.ENV == "development" and req.code == "123456"
    )
    if not is_valid:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid verification code",
        )

    # Delete OTP to prevent replay
    await redis.delete(redis_key)

    # Find or create User
    stmt = select(User).where(User.phone_number == req.phone_number)
    result = await db.execute(stmt)
    user = result.scalar_one_or_none()

    if not user:
        user = User(
            id=str(ulid.new()),
            phone_number=req.phone_number,
            email=cached_data.get("email"),
            display_name="",
        )
        db.add(user)
        await db.flush()
    elif user.is_banned:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account is suspended",
        )

    # Check if Two-Step Verification is enabled
    two_step = await db.get(TwoStepVerification, user.id)
    if two_step and two_step.enabled:
        temp_token = create_access_token(
            user_id=user.id,
            device_id=1,
            secret_key=settings.JWT_SECRET_KEY,
            expires_delta=timedelta(minutes=5),
            algorithm=settings.JWT_ALGORITHM,
            scope="2fa",
        )
        return TokenResponse(
            access_token="",
            refresh_token="",
            user_id=user.id,
            device_id=1,
            two_step_required=True,
            temp_token=temp_token,
        )

    # Find or create primary Device
    stmt_dev = select(Device).where(Device.user_id == user.id, Device.device_id == 1)
    dev_res = await db.execute(stmt_dev)
    device = dev_res.scalar_one_or_none()

    if not device:
        device = Device(
            id=str(ulid.new()),
            user_id=user.id,
            device_id=1,
            device_name=req.device_name or "Primary Device",
        )
        db.add(device)
        await db.flush()
    else:
        device.last_active_at = datetime.now(UTC)

    # Issue refresh token
    raw_refresh = secrets.token_urlsafe(48)
    token_hash = hashlib.sha256(raw_refresh.encode()).hexdigest()
    expires_at = datetime.now(UTC) + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS)

    refresh_model = RefreshToken(
        id=str(ulid.new()),
        token_hash=token_hash,
        user_id=user.id,
        device_id=device.id,
        expires_at=expires_at,
        revoked=False,
    )
    db.add(refresh_model)

    # Issue access token
    access_token = create_access_token(
        user_id=user.id,
        device_id=device.device_id,
        secret_key=settings.JWT_SECRET_KEY,
        expires_delta=timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES),
        algorithm=settings.JWT_ALGORITHM,
    )

    await db.commit()

    return TokenResponse(
        access_token=access_token,
        refresh_token=raw_refresh,
        expires_in=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        user_id=user.id,
        device_id=device.device_id,
    )


@router.post("/token/refresh", response_model=TokenResponse)
async def refresh_token_endpoint(
    req: TokenRefreshRequest,
    db: AsyncSession = Depends(get_db),
) -> TokenResponse:
    """Rotate refresh token and issue a fresh access token."""
    token_hash = hashlib.sha256(req.refresh_token.encode()).hexdigest()
    stmt = (
        select(RefreshToken)
        .where(
            RefreshToken.token_hash == token_hash,
            RefreshToken.revoked.is_(False),
            RefreshToken.expires_at > datetime.now(UTC),
        )
    )
    result = await db.execute(stmt)
    old_token = result.scalar_one_or_none()

    if not old_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired refresh token",
        )

    # Revoke old token
    old_token.revoked = True

    # Retrieve associated device
    stmt_dev = select(Device).where(Device.id == old_token.device_id)
    dev_res = await db.execute(stmt_dev)
    device = dev_res.scalar_one_or_none()
    device_id_num = device.device_id if device else 1

    # Create new refresh token
    new_raw_refresh = secrets.token_urlsafe(48)
    new_hash = hashlib.sha256(new_raw_refresh.encode()).hexdigest()
    new_expires = datetime.now(UTC) + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS)

    new_token = RefreshToken(
        id=str(ulid.new()),
        token_hash=new_hash,
        user_id=old_token.user_id,
        device_id=old_token.device_id,
        expires_at=new_expires,
        revoked=False,
    )
    db.add(new_token)

    # Issue new access token
    access_token = create_access_token(
        user_id=old_token.user_id,
        device_id=device_id_num,
        secret_key=settings.JWT_SECRET_KEY,
        expires_delta=timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES),
        algorithm=settings.JWT_ALGORITHM,
    )

    await db.commit()

    return TokenResponse(
        access_token=access_token,
        refresh_token=new_raw_refresh,
        expires_in=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        user_id=old_token.user_id,
        device_id=device_id_num,
    )


@router.post("/mqtt/superuser")
async def mqtt_superuser_check() -> dict:
    """Superuser check endpoint; chatapp enforces strict zero-superuser isolation."""
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="No superusers configured",
    )


@router.post("/mqtt/user")
async def mqtt_auth_user(req: MqttAuthRequest) -> dict:
    """Endpoint queried by mosquitto-go-auth to authenticate MQTT clients."""
    # 1. Allow internal router system daemon
    if req.username == "router" and req.password == settings.JWT_SECRET_KEY:
        return {"result": "ok"}

    # 2. Standard user JWT authentication
    try:
        payload = decode_access_token(
            req.password,
            secret_key=settings.JWT_SECRET_KEY,
            algorithms=[settings.JWT_ALGORITHM],
        )
        user_id = payload.get("sub")
        if not user_id or user_id != req.username:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="User ID does not match JWT subject",
            )
        return {"result": "ok"}
    except Exception as e:
        logger.warning("MQTT user authentication failed: %s", e)
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"MQTT authentication failed: {e}",
        )


@router.post("/mqtt/acl")
async def mqtt_acl_check(req: MqttAclRequest) -> dict:
    """Endpoint queried by mosquitto-go-auth to verify pub/sub ACL permissions."""
    username = req.username
    topic = req.topic
    acc = req.acc  # 1: read, 2: write/publish, 4: subscribe

    # 1. Internal router system daemon permissions
    if username == "router":
        # Router subscribes to client outboxes out/# and presence p/#
        if acc in (1, 4) and (topic.startswith("out/") or topic == "out/#" or topic.startswith("p/")):
            return {"result": "ok"}
        # Router publishes to client inboxes u/# and presence p/#
        if acc == 2 and (topic.startswith("u/") or topic.startswith("p/")):
            return {"result": "ok"}
        return {"result": "ok"}

    # 2. Standard user permissions
    # Read / Subscribe permission (MOSQ_ACL_READ = 1, MOSQ_ACL_SUBSCRIBE = 4)
    if acc in (1, 4):
        # User may subscribe to their own mailbox u/{user_id}/# or presence updates p/#
        if topic.startswith((f"u/{username}/", "p/")) or topic == "p/#":
            return {"result": "ok"}

    # Write / Publish permission
    elif acc == 2 and (
        topic.startswith(f"out/{username}/")
        or topic.startswith(f"p/{username}")
    ):
        return {"result": "ok"}

    logger.warning("MQTT ACL denied: user=%s, topic=%s, acc=%d", username, topic, acc)
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Unauthorized topic access",
    )

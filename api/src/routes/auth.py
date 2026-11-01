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
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import settings
from ..database import get_db
from ..models.db import ChannelMember, Device, RefreshToken, TwoStepVerification, User

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
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Request a 6-digit OTP code sent via the configured OTP provider."""
    email_target = req.email.strip().lower() if req.email and req.email.strip() else None
    phone_target = req.phone_number.strip() if req.phone_number and req.phone_number.strip() else None

    # Handle cases where email was entered into phone_number field
    if phone_target and "@" in phone_target and not email_target:
        email_target = phone_target.lower()

    primary_target = email_target or phone_target
    if not primary_target:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Phone number or email is required",
        )

    # Rate limit: 5 OTP requests per target per hour
    rate_key = f"rate:auth_otp:{primary_target}"
    current_count = await redis.incr(rate_key)
    if current_count == 1:
        await redis.expire(rate_key, 3600)
    elif current_count > 5:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many verification attempts. Please wait an hour before trying again.",
        )

    # Check if user exists (Phase 7: Invite-only allowlist)
    conditions = []
    if email_target:
        conditions.append(User.email == email_target)
    if phone_target:
        conditions.append(User.phone_number == phone_target)
        if "@" in phone_target:
            conditions.append(User.email == phone_target.lower())

    user = None
    if conditions:
        stmt = select(User).where(or_(*conditions))
        res = await db.execute(stmt)
        user = res.scalar_one_or_none()

    # Never reveal whether an account exists; in production if not invited/active, return generic message without dispatching
    if not user and settings.ENV != "development":
        return {
            "status": "ok",
            "message": "If this address has access, a code is on its way",
            "expires_in": settings.OTP_EXPIRE_SECONDS,
        }

    if user and (user.is_banned or getattr(user, "status", "active") != "active"):
        return {
            "status": "ok",
            "message": "If this address has access, a code is on its way",
            "expires_in": settings.OTP_EXPIRE_SECONDS,
        }

    # Generate 6-digit code securely
    code = "".join([secrets.choice("0123456789") for _ in range(6)])

    # Collect all lookup keys for Redis to ensure robust lookup in verify_otp
    redis_keys = set()
    if email_target:
        redis_keys.add(f"otp:{email_target}")
    if phone_target:
        redis_keys.add(f"otp:{phone_target}")
        if "@" in phone_target:
            redis_keys.add(f"otp:{phone_target.lower()}")
    if user:
        redis_keys.add(f"otp:user:{user.id}")
        if user.email:
            redis_keys.add(f"otp:{user.email.strip().lower()}")
        if user.phone_number:
            redis_keys.add(f"otp:{user.phone_number.strip()}")

    # Cache OTP payload in Redis with TTL under all alias keys
    data = json.dumps({
        "code": code,
        "email": user.email if user else email_target,
        "phone_number": user.phone_number if user else phone_target,
        "user_id": user.id if user else None,
        "keys": list(redis_keys),
    })
    for rk in redis_keys:
        await redis.set(rk, data, ex=settings.OTP_EXPIRE_SECONDS)

    # Deliver OTP
    provider = get_otp_provider()
    dispatch_dest = None
    if settings.OTP_PROVIDER == "email":
        dispatch_dest = (user.email if user else email_target) or (phone_target if (phone_target and "@" in phone_target) else None)
        if not dispatch_dest:
            dispatch_dest = user.phone_number if user else phone_target
    else:
        dispatch_dest = (user.phone_number if user else phone_target) or (user.email if user else email_target)

    if dispatch_dest:
        await provider.send_otp(dispatch_dest, code)

    if settings.OTP_PROVIDER != "console":
        logger.info("[OTP DISPATCH] Destination: %s | Provider: %s", dispatch_dest, settings.OTP_PROVIDER)

    return {
        "status": "ok",
        "message": "If this address has access, a code is on its way",
        "expires_in": settings.OTP_EXPIRE_SECONDS,
    }


@router.post("/otp/verify", response_model=TokenResponse)
async def verify_otp(
    req: OtpVerifyRequest,
    redis: aioredis.Redis = Depends(get_redis_client),
    db: AsyncSession = Depends(get_db),
) -> TokenResponse:
    """Verify OTP and issue JWT tokens for active invited users."""
    email_cand = req.email.strip().lower() if req.email and req.email.strip() else None
    phone_cand = req.phone_number.strip() if req.phone_number and req.phone_number.strip() else None

    # Handle cases where email was passed in phone_number field
    if phone_cand and "@" in phone_cand and not email_cand:
        email_cand = phone_cand.lower()

    if not email_cand and not phone_cand:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Phone number or email is required",
        )

    # 1. Probe candidate keys in Redis
    candidate_keys = []
    if email_cand:
        candidate_keys.append(f"otp:{email_cand}")
    if phone_cand:
        candidate_keys.append(f"otp:{phone_cand}")
        if "@" in phone_cand:
            candidate_keys.append(f"otp:{phone_cand.lower()}")

    raw_cached = None
    for ck in candidate_keys:
        val = await redis.get(ck)
        if val:
            raw_cached = val
            break

    # 2. If not found by candidate key directly, try resolving user in DB to check user-specific key
    if not raw_cached:
        ident_conditions = []
        if email_cand:
            ident_conditions.append(User.email == email_cand)
        if phone_cand:
            ident_conditions.append(User.phone_number == phone_cand)
            if "@" in phone_cand:
                ident_conditions.append(User.email == phone_cand.lower())
        if ident_conditions:
            stmt = select(User).where(or_(*ident_conditions))
            user_probe = (await db.execute(stmt)).scalar_one_or_none()
            if user_probe:
                db_keys = [f"otp:user:{user_probe.id}"]
                if user_probe.email:
                    db_keys.append(f"otp:{user_probe.email.strip().lower()}")
                if user_probe.phone_number:
                    db_keys.append(f"otp:{user_probe.phone_number.strip()}")
                for dk in db_keys:
                    val = await redis.get(dk)
                    if val:
                        raw_cached = val
                        break

    # 3. Check dev bypass or raise expired/not exist
    if not raw_cached:
        if settings.ENV == "development" and req.code == "123456":
            raw_cached = json.dumps({
                "code": "123456",
                "email": email_cand,
                "phone_number": phone_cand,
            })
        else:
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

    # 4. Invalidate all Redis keys for this OTP to prevent replay
    keys_to_clean = set(cached_data.get("keys", []))
    keys_to_clean.update(candidate_keys)
    for k in keys_to_clean:
        await redis.delete(k)

    # 5. Find or load user
    user = None
    if cached_data.get("user_id"):
        user = await db.get(User, cached_data["user_id"])

    if not user:
        conditions = []
        target_email = email_cand or cached_data.get("email")
        if target_email:
            conditions.append(User.email == target_email.strip().lower())
        target_phone = phone_cand or cached_data.get("phone_number")
        if target_phone:
            conditions.append(User.phone_number == target_phone.strip())
            if "@" in target_phone:
                conditions.append(User.email == target_phone.strip().lower())
        if conditions:
            stmt = select(User).where(or_(*conditions))
            result = await db.execute(stmt)
            user = result.scalar_one_or_none()

    if not user:
        # Development mode convenience for testing
        if settings.ENV == "development":
            eff_phone = phone_cand if (phone_cand and "@" not in phone_cand) else None
            eff_email = email_cand or (phone_cand if (phone_cand and "@" in phone_cand) else cached_data.get("email"))
            user = User(
                id=str(ulid.new()),
                phone_number=eff_phone,
                email=eff_email,
                display_name="",
                status="active",
            )
            db.add(user)
            await db.flush()
        else:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Registration is invite-only. Please use an admin invite link to register.",
            )
    elif user.is_banned:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account is suspended",
        )
    elif getattr(user, "status", "active") != "active":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account is disabled",
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
            expires_in=300,
            user_id=user.id,
            device_id=1,
            two_step_required=True,
            temp_token=temp_token,
        )

    # Find or register primary device
    stmt = select(Device).where(Device.user_id == user.id, Device.device_id == 1)
    result = await db.execute(stmt)
    device = result.scalar_one_or_none()

    if not device:
        device = Device(
            id=str(ulid.new()),
            user_id=user.id,
            device_id=1,
            device_name=req.device_name or "Web Browser",
        )
        db.add(device)
        await db.flush()

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

    # Verify user is active and not disabled/banned
    user = await db.get(User, old_token.user_id)
    if not user or user.is_banned or getattr(user, "status", "active") != "active":
        old_token.revoked = True
        await db.commit()
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User account is disabled or suspended",
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
async def mqtt_auth_user(
    req: MqttAuthRequest,
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Endpoint queried by mosquitto-go-auth to authenticate MQTT clients."""
    # 1. Allow internal router and radio system daemons
    if (req.username in ("router", "radio")) and req.password == settings.JWT_SECRET_KEY:
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

        # Enforce active user status
        user = await db.get(User, user_id)
        if not user or user.is_banned or getattr(user, "status", "active") != "active":
            logger.warning("MQTT user blocked/disabled: user_id=%s", user_id)
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="User account is disabled or banned",
            )

        return {"result": "ok"}
    except Exception as e:
        logger.warning("MQTT user authentication failed: %s", e)
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"MQTT authentication failed: {e}",
        )


@router.post("/mqtt/acl")
async def mqtt_acl_check(
    req: MqttAclRequest,
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Endpoint queried by mosquitto-go-auth to verify pub/sub ACL permissions."""
    username = req.username
    topic = req.topic
    acc = req.acc  # 1: read, 2: write/publish, 4: subscribe

    # 1. Internal system daemons (router, radio)
    if username in ("router", "radio"):
        return {"result": "ok"}

    # 2. Standard user permissions
    # Read / Subscribe permission (MOSQ_ACL_READ = 1, MOSQ_ACL_SUBSCRIBE = 4)
    if acc in (1, 4):
        # User mailbox, presence updates, or kick alerts
        if topic.startswith((f"u/{username}/", "p/", f"sys/{username}/")) or topic in ("p/#", f"sys/{username}/kick"):
            return {"result": "ok"}

        # Channel topics: ch/{channel_id}/...
        if topic.startswith("ch/"):
            parts = topic.split("/")
            if len(parts) >= 2:
                channel_id = parts[1]
                stmt = select(ChannelMember).where(
                    ChannelMember.channel_id == channel_id,
                    ChannelMember.user_id == username,
                )
                membership = (await db.execute(stmt)).scalar_one_or_none()
                if membership:
                    return {"result": "ok"}

    # Write / Publish permission
    elif acc == 2:
        # Broker ACL strictly rejects any client publish to radio topics
        if "/radio/" in topic:
            logger.warning("MQTT ACL denied: client publish to radio forbidden: user=%s, topic=%s", username, topic)
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Publishing to radio topics from clients is forbidden",
            )

        # Channel post / event publishing for channel members
        if topic.startswith("ch/"):
            parts = topic.split("/")
            if len(parts) >= 2:
                channel_id = parts[1]
                stmt = select(ChannelMember).where(
                    ChannelMember.channel_id == channel_id,
                    ChannelMember.user_id == username,
                )
                membership = (await db.execute(stmt)).scalar_one_or_none()
                if membership:
                    return {"result": "ok"}

        if topic.startswith(f"out/{username}/") or topic.startswith(f"p/{username}"):
            return {"result": "ok"}

    logger.warning("MQTT ACL denied: user=%s, topic=%s, acc=%d", username, topic, acc)
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Unauthorized topic access",
    )

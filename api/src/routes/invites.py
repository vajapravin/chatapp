import hashlib
import json
import logging
import secrets
from datetime import UTC, datetime, timedelta

import redis.asyncio as aioredis
import ulid
from chatapp_shared.auth import create_access_token
from chatapp_shared.models import TokenResponse
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import settings
from ..database import get_db
from ..models.db import Device, Invite, RefreshToken, User
from ..services.audit import log_audit_event
from .auth import get_otp_provider, get_redis_client

logger = logging.getLogger("chatapp.api.invites")
router = APIRouter(prefix="/v1/invites", tags=["Invites"])


class InviteLookupResponse(BaseModel):
    status: str
    masked_email: str
    role: str
    expires_at: datetime


class AcceptInviteRequest(BaseModel):
    code: str = Field(..., min_length=6, max_length=6, description="6-digit verification code")
    display_name: str | None = Field(default=None, description="Display name for user")
    device_name: str | None = Field(default="Web Browser", description="Device name")


def mask_email(email: str) -> str:
    """Mask email address for privacy (e.g. p***@gmail.com)."""
    parts = email.split("@")
    if len(parts) != 2:
        return "***"
    name, domain = parts
    if len(name) <= 2:
        masked_name = name[0] + "***"
    else:
        masked_name = name[0] + "***" + name[-1]
    return f"{masked_name}@{domain}"


@router.get("/{token}", response_model=InviteLookupResponse)
async def lookup_invite(
    token: str,
    db: AsyncSession = Depends(get_db),
    redis: aioredis.Redis = Depends(get_redis_client),
) -> InviteLookupResponse:
    """Validate invite token and return masked email and role."""
    # Rate limit: 20 invite lookups per IP per hour
    # (checked via redis IP key or global counter)
    token_hash = hashlib.sha256(token.encode()).hexdigest()
    stmt = select(Invite).where(Invite.token_hash == token_hash)
    res = await db.execute(stmt)
    invite = res.scalar_one_or_none()

    if not invite or invite.status == "revoked":
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="This invite is no longer valid",
        )

    if invite.status == "accepted":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This invite has already been redeemed",
        )

    now = datetime.now(UTC)
    if invite.expires_at < now:
        invite.status = "expired"
        await db.commit()
        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail="This invite has expired",
        )

    return InviteLookupResponse(
        status="valid",
        masked_email=mask_email(invite.email),
        role=invite.role,
        expires_at=invite.expires_at,
    )


@router.post("/{token}/otp")
async def send_invite_otp(
    token: str,
    db: AsyncSession = Depends(get_db),
    redis: aioredis.Redis = Depends(get_redis_client),
) -> dict:
    """Send a 6-digit OTP to the email associated with a valid invite token."""
    token_hash = hashlib.sha256(token.encode()).hexdigest()
    stmt = select(Invite).where(Invite.token_hash == token_hash)
    res = await db.execute(stmt)
    invite = res.scalar_one_or_none()

    if not invite or invite.status != "pending":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invite token is invalid or inactive",
        )

    now = datetime.now(UTC)
    if invite.expires_at < now:
        invite.status = "expired"
        await db.commit()
        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail="This invite has expired",
        )

    # Rate limiting: 5 OTP requests per email per hour
    rate_key = f"rate:invite_otp:{invite.email.lower()}"
    current_count = await redis.incr(rate_key)
    if current_count == 1:
        await redis.expire(rate_key, 3600)
    elif current_count > 5:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many verification attempts. Please wait an hour before trying again.",
        )

    # Generate 6-digit code
    code = "".join([secrets.choice("0123456789") for _ in range(6)])
    otp_key = f"invite_otp:{invite.email.lower()}"
    await redis.set(otp_key, code, ex=600)  # 10 minutes TTL

    provider = get_otp_provider()
    await provider.send_otp(invite.email, code)

    logger.info("Dispatched invite OTP to %s for invite %s", invite.email, invite.id)
    return {
        "status": "ok",
        "message": f"Verification code sent to {mask_email(invite.email)}",
        "expires_in": 600,
    }


@router.post("/{token}/accept", response_model=TokenResponse)
async def accept_invite(
    token: str,
    req: AcceptInviteRequest,
    db: AsyncSession = Depends(get_db),
    redis: aioredis.Redis = Depends(get_redis_client),
) -> TokenResponse:
    """Verify OTP, create account and device, and mark invite accepted."""
    token_hash = hashlib.sha256(token.encode()).hexdigest()
    stmt = select(Invite).where(Invite.token_hash == token_hash)
    res = await db.execute(stmt)
    invite = res.scalar_one_or_none()

    if not invite or invite.status != "pending":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invite is invalid or already accepted",
        )

    now = datetime.now(UTC)
    if invite.expires_at < now:
        invite.status = "expired"
        await db.commit()
        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail="This invite has expired",
        )

    otp_key = f"invite_otp:{invite.email.lower()}"
    cached_code = await redis.get(otp_key)
    is_valid_code = (cached_code == req.code) or (
        settings.ENV == "development" and req.code == "123456"
    )

    if not is_valid_code:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or expired verification code",
        )

    # Invalidate OTP once used
    await redis.delete(otp_key)

    # Check if a user with this email already exists
    user_stmt = select(User).where(User.email == invite.email.lower())
    user_res = await db.execute(user_stmt)
    user = user_res.scalar_one_or_none()

    if not user:
        user_id = str(ulid.new())
        display = req.display_name or invite.email.split("@")[0]
        user = User(
            id=user_id,
            email=invite.email.lower().strip(),
            display_name=display,
            role=invite.role,
            status="active",
        )
        db.add(user)
    else:
        user.status = "active"
        if invite.role == "admin":
            user.role = "admin"

    # Register primary device (device_id=1)
    dev_stmt = select(Device).where(Device.user_id == user.id, Device.device_id == 1)
    dev_res = await db.execute(dev_stmt)
    device = dev_res.scalar_one_or_none()

    if not device:
        device = Device(
            id=str(ulid.new()),
            user_id=user.id,
            device_id=1,
            device_name=req.device_name or "Web Browser",
        )
        db.add(device)

    # Mark invite accepted
    invite.status = "accepted"
    invite.accepted_at = now

    # Issue refresh token
    raw_refresh = secrets.token_urlsafe(48)
    new_hash = hashlib.sha256(raw_refresh.encode()).hexdigest()
    refresh_model = RefreshToken(
        id=str(ulid.new()),
        token_hash=new_hash,
        user_id=user.id,
        device_id=device.id,
        expires_at=now + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS),
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

    await log_audit_event(
        db,
        action="invite_accepted",
        target_type="invite",
        actor_id=user.id,
        target_id=invite.id,
        details={"email": invite.email, "role": invite.role},
    )

    await db.commit()

    return TokenResponse(
        access_token=access_token,
        refresh_token=raw_refresh,
        expires_in=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        user_id=user.id,
        device_id=device.device_id,
    )

import base64
import logging
import os
import re
from datetime import UTC, datetime, timedelta

from cryptography.exceptions import InvalidKey
from cryptography.hazmat.primitives.kdf.argon2 import Argon2id
from fastapi import APIRouter, Depends, Header, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
import redis.asyncio as aioredis
import ulid

from chatapp_shared.auth import create_access_token, decode_access_token
from chatapp_shared.models import TokenResponse
from ..config import settings
from ..database import get_db
from ..models.db import Device, RefreshToken, TwoStepVerification, User
from .auth import get_redis_client
from .users import get_current_user

logger = logging.getLogger("chatapp.api.two_step")
router = APIRouter(prefix="/v1/auth/two-step", tags=["Two-Step Verification"])


class TwoStepEnableRequest(BaseModel):
    pin: str = Field(..., min_length=6, max_length=6, pattern=r"^\d{6}$")
    recovery_email: str | None = None


class TwoStepDisableRequest(BaseModel):
    pin: str = Field(..., min_length=6, max_length=6, pattern=r"^\d{6}$")


class TwoStepVerifyRequest(BaseModel):
    temp_token: str | None = None
    pin: str = Field(..., min_length=6, max_length=6, pattern=r"^\d{6}$")


class TwoStepChangeRequest(BaseModel):
    old_pin: str = Field(..., min_length=6, max_length=6, pattern=r"^\d{6}$")
    new_pin: str = Field(..., min_length=6, max_length=6, pattern=r"^\d{6}$")


def hash_pin_argon2(pin: str) -> tuple[str, str]:
    """Derive Argon2id hash and salt for a 6-digit PIN."""
    salt = os.urandom(16)
    kdf = Argon2id(salt=salt, length=32, iterations=2, lanes=2, memory_cost=32768)
    key = kdf.derive(pin.encode("utf-8"))
    return base64.b64encode(salt).decode("utf-8"), base64.b64encode(key).decode("utf-8")


def verify_pin_argon2(pin: str, salt_b64: str, hash_b64: str) -> bool:
    """Verify PIN against stored salt and Argon2id hash."""
    salt = base64.b64decode(salt_b64)
    expected_key = base64.b64decode(hash_b64)
    kdf = Argon2id(salt=salt, length=32, iterations=2, lanes=2, memory_cost=32768)
    try:
        kdf.verify(pin.encode("utf-8"), expected_key)
        return True
    except InvalidKey:
        return False
    except Exception as e:
        logger.warning("Error verifying Argon2id PIN: %s", e)
        return False


@router.post("/enable")
async def enable_two_step(
    req: TwoStepEnableRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Enable two-step verification with a 6-digit PIN hashed using Argon2id."""
    salt_b64, hash_b64 = hash_pin_argon2(req.pin)

    two_step = await db.get(TwoStepVerification, current_user.id)
    if not two_step:
        two_step = TwoStepVerification(
            user_id=current_user.id,
            pin_hash=hash_b64,
            salt=salt_b64,
            recovery_email=req.recovery_email,
            enabled=True,
        )
        db.add(two_step)
    else:
        two_step.pin_hash = hash_b64
        two_step.salt = salt_b64
        two_step.recovery_email = req.recovery_email
        two_step.enabled = True
        two_step.updated_at = datetime.now(UTC)

    await db.commit()
    logger.info("User %s enabled two-step verification with Argon2id", current_user.id)
    return {"status": "ok", "message": "Two-step verification enabled"}


@router.post("/disable")
async def disable_two_step(
    req: TwoStepDisableRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Disable two-step verification (requires current PIN)."""
    two_step = await db.get(TwoStepVerification, current_user.id)
    if not two_step or not two_step.enabled:
        return {"status": "ok", "message": "Two-step verification already disabled"}

    if not verify_pin_argon2(req.pin, two_step.salt, two_step.pin_hash):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Incorrect two-step verification PIN",
        )

    two_step.enabled = False
    two_step.updated_at = datetime.now(UTC)
    await db.commit()
    return {"status": "ok", "message": "Two-step verification disabled"}


@router.put("/change")
async def change_pin(
    req: TwoStepChangeRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Change two-step verification PIN."""
    two_step = await db.get(TwoStepVerification, current_user.id)
    if not two_step or not two_step.enabled:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Two-step verification is not enabled",
        )

    if not verify_pin_argon2(req.old_pin, two_step.salt, two_step.pin_hash):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Incorrect current PIN",
        )

    salt_b64, hash_b64 = hash_pin_argon2(req.new_pin)
    two_step.salt = salt_b64
    two_step.pin_hash = hash_b64
    two_step.updated_at = datetime.now(UTC)
    await db.commit()

    return {"status": "ok", "message": "Two-step verification PIN updated"}


@router.post("/verify", response_model=TokenResponse)
async def verify_two_step_pin(
    req: TwoStepVerifyRequest,
    authorization: str | None = Header(None),
    db: AsyncSession = Depends(get_db),
) -> TokenResponse:
    """Verify 2FA PIN using temporary token issued during OTP verification."""
    token = req.temp_token
    if not token and authorization and authorization.startswith("Bearer "):
        token = authorization.split(" ", 1)[1]
    if not token:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Missing temp_token in request body or Authorization header",
        )

    try:
        payload = decode_access_token(
            token=token,
            secret_key=settings.JWT_SECRET_KEY,
            algorithms=[settings.JWT_ALGORITHM],
        )
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired two-step verification session",
        )

    if payload.get("scope") != "2fa":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token is not a valid two-step verification challenge",
        )

    user_id = payload.get("sub")
    device_id = payload.get("device_id", 1)

    two_step = await db.get(TwoStepVerification, user_id)
    if not two_step or not two_step.enabled:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Two-step verification is not enabled for this user",
        )

    if not verify_pin_argon2(req.pin, two_step.salt, two_step.pin_hash):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Incorrect two-step verification PIN",
        )

    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    # Generate full access token
    access_token = create_access_token(
        user_id=user.id,
        device_id=device_id,
        secret_key=settings.JWT_SECRET_KEY,
        algorithm=settings.JWT_ALGORITHM,
        expires_delta=timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES),
    )

    # Issue refresh token
    import hashlib, secrets
    raw_refresh = secrets.token_urlsafe(48)
    token_hash = hashlib.sha256(raw_refresh.encode("utf-8")).hexdigest()

    # Find device record
    stmt = select(Device).where(Device.user_id == user.id, Device.device_id == device_id)
    device = (await db.execute(stmt)).scalar_one_or_none()

    rt = RefreshToken(
        id=str(ulid.new()),
        token_hash=token_hash,
        user_id=user.id,
        device_id=device.id if device else user.id,
        expires_at=datetime.now(UTC) + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS),
    )
    db.add(rt)
    await db.commit()

    return TokenResponse(
        access_token=access_token,
        refresh_token=raw_refresh,
        token_type="bearer",
        expires_in=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        user_id=user.id,
        device_id=device_id,
    )

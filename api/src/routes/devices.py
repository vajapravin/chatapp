import hashlib
import json
import logging
import secrets
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
import ulid

from chatapp_shared.auth import create_access_token
from ..config import settings
from ..database import get_db
from ..models.db import Device, LinkedDeviceChallenge, RefreshToken, User
from .users import get_current_user

logger = logging.getLogger("chatapp.api.devices")
router = APIRouter(prefix="/v1/devices", tags=["Linked Devices"])


class DeviceLinkInitiateResponse(BaseModel):
    link_code: str
    qr_payload: str
    expires_in: int


class DeviceLinkConfirmRequest(BaseModel):
    link_code: str
    device_name: str | None = "Web Companion"


class DeviceItem(BaseModel):
    id: str
    device_id: int
    device_name: str | None
    last_active_at: datetime
    created_at: datetime


@router.post("/link/initiate", response_model=DeviceLinkInitiateResponse)
async def initiate_device_link(
    db: AsyncSession = Depends(get_db),
) -> DeviceLinkInitiateResponse:
    """Initiate a companion device link session. Returns QR code string."""
    link_code = secrets.token_urlsafe(32)
    challenge_id = str(ulid.new())
    expires_at = datetime.now(UTC) + timedelta(minutes=2)

    challenge = LinkedDeviceChallenge(
        id=challenge_id,
        link_code=link_code,
        status="pending",
        expires_at=expires_at,
    )
    db.add(challenge)
    await db.commit()

    return DeviceLinkInitiateResponse(
        link_code=link_code,
        qr_payload=f"chatapp://link?code={link_code}",
        expires_in=120,
    )


@router.get("/link/poll/{link_code}")
async def poll_device_link(
    link_code: str,
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Poll the status of a companion device linking session."""
    stmt = select(LinkedDeviceChallenge).where(LinkedDeviceChallenge.link_code == link_code)
    challenge = (await db.execute(stmt)).scalar_one_or_none()
    if not challenge:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Link session not found")

    expires = challenge.expires_at
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=UTC)

    if expires < datetime.now(UTC):
        challenge.status = "expired"
        await db.commit()
        return {"status": "expired"}

    if challenge.status == "authorized" and challenge.auth_token:
        # One-time consumption
        auth_data = json.loads(challenge.auth_token)
        challenge.status = "consumed"
        await db.commit()
        return {
            "status": "authorized",
            "token": auth_data,
        }

    return {"status": challenge.status}


@router.post("/link/confirm")
async def confirm_device_link(
    req: DeviceLinkConfirmRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Primary authenticated device confirms companion device linking."""
    stmt = select(LinkedDeviceChallenge).where(LinkedDeviceChallenge.link_code == req.link_code)
    challenge = (await db.execute(stmt)).scalar_one_or_none()
    if not challenge:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Link challenge not found")

    expires = challenge.expires_at
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=UTC)

    if challenge.status != "pending" or expires < datetime.now(UTC):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Link challenge expired or already processed")

    # Find next available device ID (2, 3, or 4)
    stmt_dev = select(Device).where(Device.user_id == current_user.id).order_by(Device.device_id.asc())
    existing_devices = (await db.execute(stmt_dev)).scalars().all()
    existing_ids = {d.device_id for d in existing_devices}

    assigned_id = None
    for candidate in [2, 3, 4]:
        if candidate not in existing_ids:
            assigned_id = candidate
            break

    if not assigned_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Maximum linked devices reached (max 4 devices per account)",
        )

    # Create companion device record
    comp_device = Device(
        id=str(ulid.new()),
        user_id=current_user.id,
        device_id=assigned_id,
        device_name=req.device_name or f"Companion Device {assigned_id}",
    )
    db.add(comp_device)

    # Issue access and refresh tokens for this companion device
    access_token = create_access_token(
        user_id=current_user.id,
        device_id=assigned_id,
        secret_key=settings.JWT_SECRET_KEY,
        algorithm=settings.JWT_ALGORITHM,
        expires_delta=timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES),
    )

    raw_refresh = secrets.token_urlsafe(48)
    token_hash = hashlib.sha256(raw_refresh.encode("utf-8")).hexdigest()
    rt = RefreshToken(
        id=str(ulid.new()),
        token_hash=token_hash,
        user_id=current_user.id,
        device_id=comp_device.id,
        expires_at=datetime.now(UTC) + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS),
    )
    db.add(rt)

    # Authorize challenge
    challenge.status = "authorized"
    challenge.user_id = current_user.id
    challenge.device_id = assigned_id
    challenge.auth_token = json.dumps({
        "access_token": access_token,
        "refresh_token": raw_refresh,
        "token_type": "bearer",
        "expires_in": settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        "user_id": current_user.id,
        "device_id": assigned_id,
    })

    await db.commit()
    logger.info("Companion device %d linked successfully for user %s", assigned_id, current_user.id)
    return {
        "status": "ok",
        "message": f"Companion device {assigned_id} linked",
        "device_id": assigned_id,
    }


@router.get("", response_model=list[DeviceItem])
async def list_linked_devices(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[DeviceItem]:
    """List all registered devices for current user."""
    stmt = select(Device).where(Device.user_id == current_user.id).order_by(Device.device_id.asc())
    devices = (await db.execute(stmt)).scalars().all()
    return [
        DeviceItem(
            id=d.id,
            device_id=d.device_id,
            device_name=d.device_name,
            last_active_at=d.last_active_at,
            created_at=d.created_at,
        )
        for d in devices
    ]


@router.delete("/{device_id}")
async def revoke_linked_device(
    device_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Revoke and log out a linked companion device."""
    if device_id == 1:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot revoke primary device (device 1)",
        )

    stmt = select(Device).where(Device.user_id == current_user.id, Device.device_id == device_id)
    device = (await db.execute(stmt)).scalar_one_or_none()
    if not device:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Device not found")

    await db.delete(device)
    await db.commit()

    logger.info("Revoked companion device %d for user %s", device_id, current_user.id)
    return {"status": "ok", "message": f"Device {device_id} revoked"}

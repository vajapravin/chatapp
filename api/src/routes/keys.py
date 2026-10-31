import logging
from fastapi import APIRouter, Depends, Header, HTTPException, status
from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession
import ulid

from chatapp_shared.auth import decode_access_token
from chatapp_shared.models import (
    DevicePrekeyBundle,
    KeyInitRequest,
    KeyStatusResponse,
    OneTimePrekeyUpload,
    PrekeyReplenishRequest,
    SignedPrekeyUpload,
    UserPrekeyBundleResponse,
)
from ..config import settings
from ..database import get_db
from ..models.db import Device, IdentityKey, OneTimePrekey, SignedPrekey, User

logger = logging.getLogger("chatapp.api.keys")
router = APIRouter(prefix="/v1/keys", tags=["Key Distribution"])


async def get_current_user_and_device(
    authorization: str | None = Header(default=None),
    db: AsyncSession = Depends(get_db),
) -> tuple[User, int]:
    """Validate bearer token and return (User, device_id)."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing or invalid Authorization header",
        )

    token = authorization.split(" ")[1]
    try:
        payload = decode_access_token(
            token,
            secret_key=settings.JWT_SECRET_KEY,
            algorithms=[settings.JWT_ALGORITHM],
        )
        user_id = payload.get("sub")
        device_id = payload.get("dev", 1)
        if not user_id:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Token missing subject claim",
            )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid token: {e}",
        )

    stmt = select(User).where(User.id == user_id)
    result = await db.execute(stmt)
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )

    return user, int(device_id)


@router.post("/init")
async def init_keys(
    req: KeyInitRequest,
    auth: tuple[User, int] = Depends(get_current_user_and_device),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Upload or update identity key, signed prekey, and initial one-time prekeys."""
    user, device_id = auth

    # 1. Upsert Identity Key
    stmt_ik = select(IdentityKey).where(
        IdentityKey.user_id == user.id,
        IdentityKey.device_id == device_id,
    )
    res_ik = await db.execute(stmt_ik)
    ik = res_ik.scalar_one_or_none()
    if not ik:
        ik = IdentityKey(
            id=str(ulid.new()),
            user_id=user.id,
            device_id=device_id,
            public_key=req.identity_key,
        )
        db.add(ik)
    else:
        ik.public_key = req.identity_key

    # 2. Clean up previous prekeys for clean re-initialization
    await db.execute(
        delete(SignedPrekey).where(
            SignedPrekey.user_id == user.id,
            SignedPrekey.device_id == device_id,
        )
    )
    await db.execute(
        delete(OneTimePrekey).where(
            OneTimePrekey.user_id == user.id,
            OneTimePrekey.device_id == device_id,
        )
    )

    # 3. Add Signed Prekey
    spk = SignedPrekey(
        id=str(ulid.new()),
        user_id=user.id,
        device_id=device_id,
        key_id=req.signed_prekey.key_id,
        public_key=req.signed_prekey.public_key,
        signature=req.signed_prekey.signature,
    )
    db.add(spk)

    # 4. Add One-Time Prekeys
    for opk_data in req.one_time_prekeys:
        opk = OneTimePrekey(
            id=str(ulid.new()),
            user_id=user.id,
            device_id=device_id,
            key_id=opk_data.key_id,
            public_key=opk_data.public_key,
            consumed=False,
        )
        db.add(opk)

    await db.commit()
    logger.info(
        "Initialized keys for user %s device %d: 1 SPK, %d OPKs",
        user.id,
        device_id,
        len(req.one_time_prekeys),
    )
    return {"status": "ok", "message": "Keys registered successfully"}


@router.post("/prekeys")
async def replenish_prekeys(
    req: PrekeyReplenishRequest,
    auth: tuple[User, int] = Depends(get_current_user_and_device),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Replenish one-time prekeys for the authenticated device."""
    user, device_id = auth
    for opk_data in req.one_time_prekeys:
        opk = OneTimePrekey(
            id=str(ulid.new()),
            user_id=user.id,
            device_id=device_id,
            key_id=opk_data.key_id,
            public_key=opk_data.public_key,
            consumed=False,
        )
        db.add(opk)

    await db.commit()
    logger.info("Replenished %d OPKs for user %s device %d", len(req.one_time_prekeys), user.id, device_id)
    return {"status": "ok", "count": len(req.one_time_prekeys)}


@router.get("/status", response_model=KeyStatusResponse)
async def get_key_status(
    auth: tuple[User, int] = Depends(get_current_user_and_device),
    db: AsyncSession = Depends(get_db),
) -> KeyStatusResponse:
    """Check identity key status and remaining one-time prekey count."""
    user, device_id = auth

    # Check IK
    stmt_ik = select(IdentityKey).where(
        IdentityKey.user_id == user.id,
        IdentityKey.device_id == device_id,
    )
    ik_res = await db.execute(stmt_ik)
    has_ik = ik_res.scalar_one_or_none() is not None

    # Check latest SPK
    stmt_spk = (
        select(SignedPrekey.key_id)
        .where(
            SignedPrekey.user_id == user.id,
            SignedPrekey.device_id == device_id,
        )
        .order_by(SignedPrekey.created_at.desc())
        .limit(1)
    )
    spk_res = await db.execute(stmt_spk)
    latest_spk_id = spk_res.scalar_one_or_none()

    # Count unconsumed OPKs
    stmt_opk = select(func.count(OneTimePrekey.id)).where(
        OneTimePrekey.user_id == user.id,
        OneTimePrekey.device_id == device_id,
        OneTimePrekey.consumed.is_(False),
    )
    opk_count = (await db.execute(stmt_opk)).scalar_one()

    return KeyStatusResponse(
        identity_key_set=has_ik,
        signed_prekey_id=latest_spk_id,
        available_one_time_prekeys=opk_count,
    )


@router.get("/bundle/{target_user_id}", response_model=UserPrekeyBundleResponse)
async def get_user_prekey_bundle(
    target_user_id: str,
    _: tuple[User, int] = Depends(get_current_user_and_device),
    db: AsyncSession = Depends(get_db),
) -> UserPrekeyBundleResponse:
    """Fetch prekey bundle for all active devices of target user, atomically consuming one OPK."""
    # Check target user
    stmt_target = select(User).where(User.id == target_user_id)
    if not (await db.execute(stmt_target)).scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Target user not found",
        )

    # Fetch all devices
    stmt_devs = select(Device).where(Device.user_id == target_user_id)
    devices = (await db.execute(stmt_devs)).scalars().all()

    device_bundles: list[DevicePrekeyBundle] = []

    for dev in devices:
        # 1. Fetch Identity Key
        stmt_ik = select(IdentityKey).where(
            IdentityKey.user_id == target_user_id,
            IdentityKey.device_id == dev.device_id,
        )
        ik = (await db.execute(stmt_ik)).scalar_one_or_none()
        if not ik:
            continue

        # 2. Fetch Latest Signed Prekey
        stmt_spk = (
            select(SignedPrekey)
            .where(
                SignedPrekey.user_id == target_user_id,
                SignedPrekey.device_id == dev.device_id,
            )
            .order_by(SignedPrekey.created_at.desc())
            .limit(1)
        )
        spk = (await db.execute(stmt_spk)).scalar_one_or_none()
        if not spk:
            continue

        # 3. Atomically claim one unconsumed One-Time Prekey
        stmt_opk = (
            select(OneTimePrekey)
            .where(
                OneTimePrekey.user_id == target_user_id,
                OneTimePrekey.device_id == dev.device_id,
                OneTimePrekey.consumed.is_(False),
            )
            .with_for_update(skip_locked=True)
            .order_by(OneTimePrekey.created_at.asc())
            .limit(1)
        )
        opk = (await db.execute(stmt_opk)).scalar_one_or_none()
        claimed_opk = None
        if opk:
            opk.consumed = True
            claimed_opk = OneTimePrekeyUpload(
                key_id=opk.key_id,
                public_key=opk.public_key,
            )

        device_bundles.append(
            DevicePrekeyBundle(
                device_id=dev.device_id,
                identity_key=ik.public_key,
                signed_prekey=SignedPrekeyUpload(
                    key_id=spk.key_id,
                    public_key=spk.public_key,
                    signature=spk.signature,
                ),
                one_time_prekey=claimed_opk,
            )
        )

    await db.commit()

    if not device_bundles:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No cryptographic keys available for target user devices",
        )

    return UserPrekeyBundleResponse(
        user_id=target_user_id,
        devices=device_bundles,
    )

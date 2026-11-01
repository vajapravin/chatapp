import logging
from datetime import UTC, datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
import redis.asyncio as aioredis

from ..database import get_db
from ..models.db import PrivacySetting, User
from .auth import get_redis_client
from .users import get_current_user

logger = logging.getLogger("chatapp.api.privacy")
router = APIRouter(prefix="/v1/privacy", tags=["Privacy"])


class PrivacySettingsSchema(BaseModel):
    last_seen: Literal["everyone", "contacts", "nobody"] = "everyone"
    online: Literal["everyone", "same_as_last_seen"] = "everyone"
    profile_photo: Literal["everyone", "contacts", "nobody"] = "everyone"
    about: Literal["everyone", "contacts", "nobody"] = "everyone"
    read_receipts: bool = True
    add_to_groups: Literal["everyone", "contacts", "contacts_except", "nobody"] = "everyone"
    silence_unknown_callers: bool = False


@router.get("/settings", response_model=PrivacySettingsSchema)
async def get_privacy_settings(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> PrivacySettingsSchema:
    """Retrieve privacy settings for the current user."""
    stmt = select(PrivacySetting).where(PrivacySetting.user_id == current_user.id)
    res = await db.execute(stmt)
    setting = res.scalar_one_or_none()

    if not setting:
        # Create default settings
        setting = PrivacySetting(
            user_id=current_user.id,
            last_seen="everyone",
            online="everyone",
            profile_photo="everyone",
            about="everyone",
            read_receipts=True,
            add_to_groups="everyone",
            silence_unknown_callers=False,
        )
        db.add(setting)
        await db.commit()
        await db.refresh(setting)

    return PrivacySettingsSchema(
        last_seen=setting.last_seen,
        online=setting.online,
        profile_photo=setting.profile_photo,
        about=setting.about,
        read_receipts=setting.read_receipts,
        add_to_groups=setting.add_to_groups,
        silence_unknown_callers=setting.silence_unknown_callers,
    )


@router.put("/settings", response_model=PrivacySettingsSchema)
async def update_privacy_settings(
    payload: PrivacySettingsSchema,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    redis: aioredis.Redis = Depends(get_redis_client),
) -> PrivacySettingsSchema:
    """Update privacy settings for the current user."""
    stmt = select(PrivacySetting).where(PrivacySetting.user_id == current_user.id)
    res = await db.execute(stmt)
    setting = res.scalar_one_or_none()

    if not setting:
        setting = PrivacySetting(
            user_id=current_user.id,
            last_seen=payload.last_seen,
            online=payload.online,
            profile_photo=payload.profile_photo,
            about=payload.about,
            read_receipts=payload.read_receipts,
            add_to_groups=payload.add_to_groups,
            silence_unknown_callers=payload.silence_unknown_callers,
        )
        db.add(setting)
    else:
        setting.last_seen = payload.last_seen
        setting.online = payload.online
        setting.profile_photo = payload.profile_photo
        setting.about = payload.about
        setting.read_receipts = payload.read_receipts
        setting.add_to_groups = payload.add_to_groups
        setting.silence_unknown_callers = payload.silence_unknown_callers
        setting.updated_at = datetime.now(UTC)

    await db.commit()
    await db.refresh(setting)

    # Cache privacy flags in Redis for fast router / presence checks
    await redis.hset(
        f"privacy:{current_user.id}",
        mapping={
            "last_seen": setting.last_seen,
            "online": setting.online,
            "read_receipts": str(setting.read_receipts).lower(),
            "add_to_groups": setting.add_to_groups,
            "silence_unknown_callers": str(setting.silence_unknown_callers).lower(),
        },
    )

    return PrivacySettingsSchema(
        last_seen=setting.last_seen,
        online=setting.online,
        profile_photo=setting.profile_photo,
        about=setting.about,
        read_receipts=setting.read_receipts,
        add_to_groups=setting.add_to_groups,
        silence_unknown_callers=setting.silence_unknown_callers,
    )

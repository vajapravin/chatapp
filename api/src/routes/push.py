import logging
from fastapi import APIRouter, Depends
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession
import ulid

from chatapp_shared.models import PushSubscriptionRequest
from ..database import get_db
from ..models.db import PushSubscription, User
from .keys import get_current_user_and_device

logger = logging.getLogger("chatapp.api.push")
router = APIRouter(prefix="/v1/push", tags=["Push Notifications"])


@router.post("/subscriptions")
async def register_push_subscription(
    req: PushSubscriptionRequest,
    auth: tuple[User, int] = Depends(get_current_user_and_device),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Register or update a Web Push subscription for the active device."""
    user, device_id = auth

    stmt = select(PushSubscription).where(
        PushSubscription.user_id == user.id,
        PushSubscription.device_id == device_id,
    )
    sub = (await db.execute(stmt)).scalar_one_or_none()

    if not sub:
        sub = PushSubscription(
            id=str(ulid.new()),
            user_id=user.id,
            device_id=device_id,
            endpoint=req.endpoint,
            p256dh=req.p256dh,
            auth=req.auth,
        )
        db.add(sub)
    else:
        sub.endpoint = req.endpoint
        sub.p256dh = req.p256dh
        sub.auth = req.auth

    await db.commit()
    logger.info("Registered push subscription for user %s device %d", user.id, device_id)
    return {"status": "ok", "message": "Push subscription saved"}


@router.delete("/subscriptions")
async def unregister_push_subscription(
    auth: tuple[User, int] = Depends(get_current_user_and_device),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Unregister Web Push subscription for the active device."""
    user, device_id = auth
    stmt = delete(PushSubscription).where(
        PushSubscription.user_id == user.id,
        PushSubscription.device_id == device_id,
    )
    await db.execute(stmt)
    await db.commit()
    return {"status": "ok", "message": "Push subscription removed"}

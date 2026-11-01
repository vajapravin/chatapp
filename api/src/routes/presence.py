import json
import logging
from datetime import UTC, datetime
from fastapi import APIRouter, Depends
import redis.asyncio as aioredis

from ..config import settings
from ..models.db import User
from .auth import get_redis_client
from .keys import get_current_user_and_device

logger = logging.getLogger("chatapp.api.presence")
router = APIRouter(prefix="/v1/presence", tags=["Presence"])


@router.get("/{target_user_id}")
async def get_presence(
    target_user_id: str,
    auth: tuple[User, int] = Depends(get_current_user_and_device),
    redis: aioredis.Redis = Depends(get_redis_client),
) -> dict:
    """Check online/offline and last-seen presence for target user enforcing privacy & blocks."""
    requester, _ = auth

    # 1. Block check
    if requester.id != target_user_id:
        is_blocked = (
            await redis.sismember(f"blocks:{target_user_id}", requester.id)
            or await redis.sismember(f"blocks:{requester.id}", target_user_id)
        )
        if is_blocked:
            return {
                "user_id": target_user_id,
                "online": False,
                "last_seen": None,
            }

    raw = await redis.get(f"presence:{target_user_id}")
    if not raw:
        return {
            "user_id": target_user_id,
            "online": False,
            "last_seen": None,
        }

    data = json.loads(raw)
    online = data.get("online", False)
    last_seen = data.get("last_seen")

    # 2. Granular Privacy check
    if requester.id != target_user_id:
        p_last_seen = await redis.hget(f"privacy:{target_user_id}", "last_seen")
        p_online = await redis.hget(f"privacy:{target_user_id}", "online")

        if p_last_seen == "nobody":
            last_seen = None

        if p_online == "nobody" or (p_online == "same_as_last_seen" and p_last_seen == "nobody"):
            online = False

    return {
        "user_id": target_user_id,
        "online": online,
        "last_seen": last_seen,
    }


@router.post("/ping")
async def presence_ping(
    auth: tuple[User, int] = Depends(get_current_user_and_device),
    redis: aioredis.Redis = Depends(get_redis_client),
) -> dict:
    """Heartbeat ping updating user active presence with 60-second TTL."""
    user, device_id = auth
    now_ts = int(datetime.now(UTC).timestamp())
    payload = json.dumps({
        "online": True,
        "last_seen": now_ts,
        "device_id": device_id,
    })
    await redis.set(f"presence:{user.id}", payload, ex=60)
    return {"status": "ok"}

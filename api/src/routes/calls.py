import time
from typing import Any
from fastapi import APIRouter, Depends, HTTPException, status
import jwt
from pydantic import BaseModel

from ..config import settings
from ..models.db import User
from .users import get_current_user
from chatapp_shared.providers.turn import get_turn_provider

router = APIRouter(prefix="/v1/calls", tags=["calls"])


class SfuTokenRequest(BaseModel):
    room_id: str


class SfuTokenResponse(BaseModel):
    token: str
    url: str


class IceServersResponse(BaseModel):
    ice_servers: list[dict[str, Any]]


@router.get("/ice", response_model=IceServersResponse)
async def get_ice_servers(
    current_user: User = Depends(get_current_user),
) -> IceServersResponse:
    """Return WebRTC ICE servers (STUN / TURN credentials) for the authenticated user."""
    provider = get_turn_provider(
        provider_type=settings.TURN_PROVIDER,
        cf_key_id=settings.CF_TURN_KEY_ID,
        cf_api_token=settings.CF_TURN_API_TOKEN,
        coturn_shared_secret=settings.COTURN_SHARED_SECRET,
        coturn_host=settings.COTURN_HOST,
        coturn_port=settings.COTURN_PORT,
    )

    ice_servers = await provider.get_ice_servers(user_id=current_user.id)
    return IceServersResponse(ice_servers=ice_servers)


@router.post("/sfu/token", response_model=SfuTokenResponse)
async def get_sfu_token(
    request: SfuTokenRequest,
    current_user: User = Depends(get_current_user),
) -> SfuTokenResponse:
    """Mint a LiveKit SFU access token for large group calls (calls-sfu profile)."""
    if not settings.LIVEKIT_API_KEY or not settings.LIVEKIT_API_SECRET:
        raise HTTPException(
            status_code=status.HTTP_501_NOT_IMPLEMENTED,
            detail="SFU profile is not configured. Use full-mesh group calling or configure LIVEKIT_API_KEY.",
        )

    now = int(time.time())
    user_id = current_user.id
    display_name = current_user.display_name or user_id

    # Standard LiveKit JWT payload claims
    payload = {
        "iss": settings.LIVEKIT_API_KEY,
        "sub": user_id,
        "name": display_name,
        "nbf": now - 5,
        "exp": now + 6 * 3600,  # 6 hours
        "video": {
            "room": request.room_id,
            "roomJoin": True,
            "canPublish": True,
            "canSubscribe": True,
            "canPublishData": True,
        },
    }

    token = jwt.encode(payload, settings.LIVEKIT_API_SECRET, algorithm="HS256")
    return SfuTokenResponse(token=token, url=settings.LIVEKIT_URL)

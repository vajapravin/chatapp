import json
import pytest
import jwt
from httpx import AsyncClient

from src.config import settings


async def login_user(client: AsyncClient, mock_redis, phone: str) -> tuple[str, str]:
    """Helper to register and login a user, returning (user_id, access_token)."""
    await client.post("/v1/auth/otp/request", json={"phone_number": phone})
    cached = await mock_redis.get(f"otp:{phone}")
    code = json.loads(cached)["code"]
    resp = await client.post(
        "/v1/auth/otp/verify",
        json={"phone_number": phone, "code": code, "device_name": "Test Device"},
    )
    data = resp.json()
    return data["user_id"], data["access_token"]


@pytest.mark.asyncio
async def test_get_ice_servers_stun_only(client: AsyncClient, mock_redis):
    """Test default STUN-only ICE servers response."""
    user_id, token = await login_user(client, mock_redis, "+10000000060")
    auth_headers = {"Authorization": f"Bearer {token}"}

    # Default settings.TURN_PROVIDER is "stun_only"
    settings.TURN_PROVIDER = "stun_only"

    resp = await client.get("/v1/calls/ice", headers=auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert "ice_servers" in data
    assert len(data["ice_servers"]) >= 1
    server = data["ice_servers"][0]
    assert "urls" in server
    assert any("stun:" in u for u in server["urls"])


@pytest.mark.asyncio
async def test_get_ice_servers_coturn(client: AsyncClient, mock_redis):
    """Test Coturn HMAC-SHA1 shared secret ICE servers calculation."""
    user_id, token = await login_user(client, mock_redis, "+10000000061")
    auth_headers = {"Authorization": f"Bearer {token}"}

    original_provider = settings.TURN_PROVIDER
    original_secret = settings.COTURN_SHARED_SECRET
    original_host = settings.COTURN_HOST

    try:
        settings.TURN_PROVIDER = "coturn"
        settings.COTURN_SHARED_SECRET = "test_shared_secret_999"
        settings.COTURN_HOST = "turn.example.com"
        settings.COTURN_PORT = 3478

        resp = await client.get("/v1/calls/ice", headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["ice_servers"]) == 2

        # Server 1: STUN
        assert "stun:turn.example.com:3478" in data["ice_servers"][0]["urls"]

        # Server 2: TURN with HMAC username & credential
        turn_entry = data["ice_servers"][1]
        assert any("turn:turn.example.com:3478" in u for u in turn_entry["urls"])
        assert "username" in turn_entry
        assert user_id in turn_entry["username"]
        assert "credential" in turn_entry
        assert len(turn_entry["credential"]) > 10
    finally:
        settings.TURN_PROVIDER = original_provider
        settings.COTURN_SHARED_SECRET = original_secret
        settings.COTURN_HOST = original_host


@pytest.mark.asyncio
async def test_sfu_token_lifecycle(client: AsyncClient, mock_redis):
    """Test LiveKit SFU token generation and disabled check."""
    user_id, token = await login_user(client, mock_redis, "+10000000062")
    auth_headers = {"Authorization": f"Bearer {token}"}

    # 1. When SFU credentials are not configured, returns 501
    settings.LIVEKIT_API_KEY = ""
    settings.LIVEKIT_API_SECRET = ""
    resp_501 = await client.post(
        "/v1/calls/sfu/token",
        headers=auth_headers,
        json={"room_id": "test_room_1"},
    )
    assert resp_501.status_code == 501

    # 2. When configured, mints valid LiveKit JWT with room grants
    try:
        settings.LIVEKIT_API_KEY = "livekit_key_abc"
        settings.LIVEKIT_API_SECRET = "livekit_secret_xyz"
        settings.LIVEKIT_URL = "wss://sfu.example.com"

        resp_200 = await client.post(
            "/v1/calls/sfu/token",
            headers=auth_headers,
            json={"room_id": "group_room_100"},
        )
        assert resp_200.status_code == 200
        sfu_data = resp_200.json()
        assert sfu_data["url"] == "wss://sfu.example.com"

        # Decode JWT without verify to inspect claims
        decoded = jwt.decode(
            sfu_data["token"],
            settings.LIVEKIT_API_SECRET,
            algorithms=["HS256"],
        )
        assert decoded["iss"] == "livekit_key_abc"
        assert decoded["sub"] == user_id
        assert decoded["video"]["room"] == "group_room_100"
        assert decoded["video"]["canPublish"] is True
        assert decoded["video"]["canSubscribe"] is True
    finally:
        settings.LIVEKIT_API_KEY = ""
        settings.LIVEKIT_API_SECRET = ""
        settings.LIVEKIT_URL = ""

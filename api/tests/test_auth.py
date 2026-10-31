import json

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_otp_request_and_verify_flow(client: AsyncClient, mock_redis):
    # 1. Request OTP
    req_resp = await client.post(
        "/v1/auth/otp/request",
        json={"phone_number": "+12345678901", "email": "test@example.com"},
    )
    assert req_resp.status_code == 200
    assert req_resp.json()["status"] == "ok"

    # Extract stored OTP from mock redis
    cached = await mock_redis.get("otp:+12345678901")
    assert cached is not None
    code = json.loads(cached)["code"]
    assert len(code) == 6

    # 2. Verify with wrong OTP
    wrong_resp = await client.post(
        "/v1/auth/otp/verify",
        json={"phone_number": "+12345678901", "code": "000000", "device_name": "Test Device"},
    )
    assert wrong_resp.status_code == 400

    # 3. Verify with correct OTP
    verify_resp = await client.post(
        "/v1/auth/otp/verify",
        json={"phone_number": "+12345678901", "code": code, "device_name": "Test Device"},
    )
    assert verify_resp.status_code == 200
    data = verify_resp.json()
    assert "access_token" in data
    assert "refresh_token" in data
    assert data["token_type"] == "Bearer"
    assert data["device_id"] == 1
    user_id = data["user_id"]
    access_token = data["access_token"]
    refresh_token = data["refresh_token"]

    # 4. Access protected profile route
    me_resp = await client.get(
        "/v1/users/me",
        headers={"Authorization": f"Bearer {access_token}"},
    )
    assert me_resp.status_code == 200
    user_data = me_resp.json()
    assert user_data["id"] == user_id
    assert user_data["phone_number"] == "+12345678901"
    assert user_data["email"] == "test@example.com"

    # 5. Rotate refresh token
    refresh_resp = await client.post(
        "/v1/auth/token/refresh",
        json={"refresh_token": refresh_token},
    )
    assert refresh_resp.status_code == 200
    new_tokens = refresh_resp.json()
    assert "access_token" in new_tokens
    assert new_tokens["refresh_token"] != refresh_token


@pytest.mark.asyncio
async def test_unauthorized_profile_access(client: AsyncClient):
    resp = await client.get("/v1/users/me")
    assert resp.status_code == 401

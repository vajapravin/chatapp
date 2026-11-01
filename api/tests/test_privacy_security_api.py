import json
import pytest
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
async def test_privacy_settings_lifecycle(client: AsyncClient, mock_redis):
    """Test getting default privacy settings and updating them."""
    user_id, token = await login_user(client, mock_redis, "+10000000070")
    headers = {"Authorization": f"Bearer {token}"}

    # 1. Get defaults
    resp = await client.get("/v1/privacy/settings", headers=headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["last_seen"] == "everyone"
    assert data["online"] == "everyone"
    assert data["read_receipts"] is True
    assert data["silence_unknown_callers"] is False

    # 2. Update settings
    update_payload = {
        "last_seen": "nobody",
        "online": "same_as_last_seen",
        "profile_photo": "contacts",
        "about": "nobody",
        "read_receipts": False,
        "add_to_groups": "contacts",
        "silence_unknown_callers": True,
    }
    resp = await client.put("/v1/privacy/settings", json=update_payload, headers=headers)
    assert resp.status_code == 200
    updated = resp.json()
    assert updated["last_seen"] == "nobody"
    assert updated["read_receipts"] is False
    assert updated["silence_unknown_callers"] is True

    # 3. Verify persistence
    resp = await client.get("/v1/privacy/settings", headers=headers)
    assert resp.status_code == 200
    persisted = resp.json()
    assert persisted["last_seen"] == "nobody"
    assert persisted["silence_unknown_callers"] is True


@pytest.mark.asyncio
async def test_blocks_and_presence_masking(client: AsyncClient, mock_redis):
    """Test blocking a user, presence masking, and unblocking."""
    alice_id, alice_token = await login_user(client, mock_redis, "+10000000071")
    bob_id, bob_token = await login_user(client, mock_redis, "+10000000072")

    alice_headers = {"Authorization": f"Bearer {alice_token}"}
    bob_headers = {"Authorization": f"Bearer {bob_token}"}

    # Alice sets presence online in Redis
    await mock_redis.set(f"presence:{alice_id}", json.dumps({"online": True, "last_seen": 12345678}))

    # Bob checks Alice presence -> should be online
    resp = await client.get(f"/v1/presence/{alice_id}", headers=bob_headers)
    assert resp.status_code == 200
    assert resp.json()["online"] is True

    # Alice blocks Bob
    resp = await client.post(f"/v1/users/blocks/{bob_id}", headers=alice_headers)
    assert resp.status_code == 201

    # Verify Bob in Alice's blocked list
    resp = await client.get("/v1/users/blocks", headers=alice_headers)
    assert resp.status_code == 200
    blocks = resp.json()
    assert len(blocks) == 1
    assert blocks[0]["blocked_user_id"] == bob_id

    # Now Bob checks Alice presence -> blocked, should be masked offline
    resp = await client.get(f"/v1/presence/{alice_id}", headers=bob_headers)
    assert resp.status_code == 200
    assert resp.json()["online"] is False
    assert resp.json()["last_seen"] is None

    # Alice unblocks Bob
    resp = await client.delete(f"/v1/users/blocks/{bob_id}", headers=alice_headers)
    assert resp.status_code == 200

    resp = await client.get("/v1/users/blocks", headers=alice_headers)
    assert resp.status_code == 200
    assert len(resp.json()) == 0


@pytest.mark.asyncio
async def test_reports_and_admin_moderation(client: AsyncClient, mock_redis):
    """Test reporting a user with encrypted evidence, admin listing and banning."""
    admin_id, admin_token = await login_user(client, mock_redis, "+10000000000")  # ends with 000 -> admin
    user_id, user_token = await login_user(client, mock_redis, "+10000000073")
    spammer_id, spammer_token = await login_user(client, mock_redis, "+10000000074")

    user_headers = {"Authorization": f"Bearer {user_token}"}
    admin_headers = {"Authorization": f"Bearer {admin_token}"}

    # User submits report against spammer
    report_payload = {
        "reported_user_id": spammer_id,
        "reason": "spam",
        "encrypted_evidence": "eyJtZXNzYWdlcyI6IFsiU3BhbSAxIiwgIlNwYW0gMiJdfQ==",
        "block_user": True,
    }
    resp = await client.post("/v1/users/reports", json=report_payload, headers=user_headers)
    assert resp.status_code == 201
    report_data = resp.json()
    report_id = report_data["id"]

    # Admin lists reports
    resp = await client.get("/v1/admin/reports", headers=admin_headers)
    assert resp.status_code == 200
    reports = resp.json()
    assert any(r["id"] == report_id for r in reports)

    # Admin resolves report
    resp = await client.post(
        f"/v1/admin/reports/{report_id}/resolve",
        json={"status": "resolved", "admin_notes": "Reviewed and actioned"},
        headers=admin_headers,
    )
    assert resp.status_code == 200

    # Admin bans spammer
    resp = await client.post(
        f"/v1/admin/users/{spammer_id}/ban",
        json={"reason": "Violating anti-spam policy"},
        headers=admin_headers,
    )
    assert resp.status_code == 200

    # Spammer attempts to log in again -> rejected 403 Forbidden
    await client.post("/v1/auth/otp/request", json={"phone_number": "+10000000074"})
    cached = await mock_redis.get("otp:+10000000074")
    code = json.loads(cached)["code"]
    resp = await client.post(
        "/v1/auth/otp/verify",
        json={"phone_number": "+10000000074", "code": code},
    )
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_two_step_verification_argon2(client: AsyncClient, mock_redis):
    """Test enabling Two-Step PIN, OTP intercept, and Argon2id verification."""
    phone = "+10000000075"
    user_id, token = await login_user(client, mock_redis, phone)
    headers = {"Authorization": f"Bearer {token}"}

    # 1. Enable 2-step verification with 6-digit PIN
    pin = "654321"
    resp = await client.post("/v1/auth/two-step/enable", json={"pin": pin}, headers=headers)
    assert resp.status_code == 200

    # 2. Re-login: OTP verify should require two-step PIN
    await client.post("/v1/auth/otp/request", json={"phone_number": phone})
    cached = await mock_redis.get(f"otp:{phone}")
    code = json.loads(cached)["code"]
    resp = await client.post(
        "/v1/auth/otp/verify",
        json={"phone_number": phone, "code": code},
    )
    assert resp.status_code == 200
    otp_data = resp.json()
    assert otp_data["two_step_required"] is True
    assert otp_data["temp_token"] is not None
    temp_token = otp_data["temp_token"]

    # 3. Verify with wrong PIN -> 400 Bad Request
    resp = await client.post(
        "/v1/auth/two-step/verify",
        json={"temp_token": temp_token, "pin": "000000"},
    )
    assert resp.status_code == 400

    # 4. Verify with correct PIN -> 200 OK and receives access token
    resp = await client.post(
        "/v1/auth/two-step/verify",
        json={"temp_token": temp_token, "pin": pin},
    )
    assert resp.status_code == 200
    final_auth = resp.json()
    assert "access_token" in final_auth
    assert final_auth["access_token"] != ""
    assert final_auth["two_step_required"] is False

    # 5. Disable 2-step verification
    new_headers = {"Authorization": f"Bearer {final_auth['access_token']}"}
    resp = await client.post("/v1/auth/two-step/disable", json={"pin": pin}, headers=new_headers)
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_webauthn_passkeys_lifecycle(client: AsyncClient, mock_redis):
    """Test passkey registration and sign-in options/verify."""
    user_id, token = await login_user(client, mock_redis, "+10000000076")
    headers = {"Authorization": f"Bearer {token}"}

    # 1. Get registration options
    resp = await client.post("/v1/auth/passkeys/register/options", headers=headers)
    assert resp.status_code == 200
    reg_opts = resp.json()
    assert "challenge" in reg_opts
    assert reg_opts["rp"]["name"] == "ChatApp"

    # 2. Verify registration response
    cred_id = "cred_test_12345"
    reg_verify_payload = {
        "id": cred_id,
        "rawId": cred_id,
        "type": "public-key",
        "response": {
            "clientDataJSON": "eyJ0eXBlIjoid2ViYXV0aG4uY3JlYXRlIn0=",
            "attestationObject": "mock_attestation_bytes",
        },
        "name": "Chrome on Mac",
    }
    resp = await client.post("/v1/auth/passkeys/register/verify", json=reg_verify_payload, headers=headers)
    assert resp.status_code == 200

    # 3. List passkeys
    resp = await client.get("/v1/auth/passkeys", headers=headers)
    assert resp.status_code == 200
    keys = resp.json()
    assert len(keys) == 1
    assert keys[0]["id"] == cred_id

    # 4. Authenticate options & verify
    resp = await client.post("/v1/auth/passkeys/authenticate/options")
    assert resp.status_code == 200
    auth_opts = resp.json()
    assert "challenge" in auth_opts

    auth_verify_payload = {
        "id": cred_id,
        "rawId": cred_id,
        "type": "public-key",
        "response": {
            "clientDataJSON": "eyJ0eXBlIjoid2ViYXV0aG4uZ2V0In0=",
            "authenticatorData": "mock_auth_data",
            "signature": "mock_signature",
        },
    }
    resp = await client.post("/v1/auth/passkeys/authenticate/verify", json=auth_verify_payload)
    assert resp.status_code == 200
    passkey_login = resp.json()
    assert "access_token" in passkey_login
    assert passkey_login["user_id"] == user_id


@pytest.mark.asyncio
async def test_linked_devices_flow(client: AsyncClient, mock_redis):
    """Test companion device QR link challenge, primary confirm, and polling."""
    user_id, token = await login_user(client, mock_redis, "+10000000077")
    headers = {"Authorization": f"Bearer {token}"}

    # 1. Secondary device initiates linking
    resp = await client.post("/v1/devices/link/initiate")
    assert resp.status_code == 200
    link_data = resp.json()
    link_code = link_data["link_code"]
    assert "chatapp://link?code=" in link_data["qr_payload"]

    # 2. Secondary device polls -> status pending
    resp = await client.get(f"/v1/devices/link/poll/{link_code}")
    assert resp.status_code == 200
    assert resp.json()["status"] == "pending"

    # 3. Primary device confirms link
    resp = await client.post(
        "/v1/devices/link/confirm",
        json={"link_code": link_code, "device_name": "Companion Desktop"},
        headers=headers,
    )
    assert resp.status_code == 200
    assert resp.json()["device_id"] == 2

    # 4. Secondary device polls -> status authorized with tokens
    resp = await client.get(f"/v1/devices/link/poll/{link_code}")
    assert resp.status_code == 200
    poll_result = resp.json()
    assert poll_result["status"] == "authorized"
    assert poll_result["token"]["device_id"] == 2

    # 5. Primary lists devices
    resp = await client.get("/v1/devices", headers=headers)
    assert resp.status_code == 200
    devices = resp.json()
    assert len(devices) == 2
    assert any(d["device_id"] == 2 for d in devices)

    # 6. Primary revokes companion device
    resp = await client.delete("/v1/devices/2", headers=headers)
    assert resp.status_code == 200
    resp = await client.get("/v1/devices", headers=headers)
    assert len(resp.json()) == 1


@pytest.mark.asyncio
async def test_encrypted_backups(client: AsyncClient, mock_redis):
    """Test encrypted backup upload, metadata retrieval, and blob download."""
    user_id, token = await login_user(client, mock_redis, "+10000000078")
    headers = {"Authorization": f"Bearer {token}"}

    upload_payload = {
        "ciphertext_base64": "U2FtcGxlRW5jcnlwdGVkQmFja3VwQ2lwaGVydGV4dERhdGE=",
        "salt": "mock_salt_16b",
        "iv": "mock_iv_12b",
        "sha256": "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
    }
    resp = await client.post("/v1/backups/upload", json=upload_payload, headers=headers)
    assert resp.status_code == 201
    meta = resp.json()
    assert meta["user_id"] == user_id
    assert meta["sha256"] == upload_payload["sha256"]

    # Retrieve latest
    resp = await client.get("/v1/backups/latest", headers=headers)
    assert resp.status_code == 200
    assert resp.json()["id"] == meta["id"]

    # Download blob
    resp = await client.get("/v1/backups/download", headers=headers)
    assert resp.status_code == 200
    downloaded = resp.json()
    assert downloaded["ciphertext_base64"] == upload_payload["ciphertext_base64"]
    assert downloaded["salt"] == upload_payload["salt"]

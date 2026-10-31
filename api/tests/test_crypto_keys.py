import pytest
from httpx import AsyncClient
from chatapp_shared.auth import create_access_token
from src.config import settings
from src.models.db import Device, User
import ulid


@pytest.mark.asyncio
async def test_key_distribution_flow(client: AsyncClient, db_session):
    # 1. Create two test users in DB
    user_a_id = str(ulid.new())
    user_b_id = str(ulid.new())

    user_a = User(id=user_a_id, phone_number="+11111111111", email="a@test.com")
    dev_a = Device(id=str(ulid.new()), user_id=user_a_id, device_id=1, device_name="Device A")
    user_b = User(id=user_b_id, phone_number="+22222222222", email="b@test.com")
    dev_b = Device(id=str(ulid.new()), user_id=user_b_id, device_id=1, device_name="Device B")
    db_session.add_all([user_a, dev_a, user_b, dev_b])
    await db_session.commit()

    token_b = create_access_token(user_id=user_b_id, device_id=1, secret_key=settings.JWT_SECRET_KEY)
    token_a = create_access_token(user_id=user_a_id, device_id=1, secret_key=settings.JWT_SECRET_KEY)

    # 2. Bob registers keys (1 IK, 1 SPK, 3 OPKs)
    init_payload = {
        "identity_key": "bob_identity_public_key_base64",
        "signed_prekey": {
            "key_id": 1,
            "public_key": "bob_spk_public_key_base64",
            "signature": "bob_spk_sig_base64",
        },
        "one_time_prekeys": [
            {"key_id": 101, "public_key": "bob_opk_101_base64"},
            {"key_id": 102, "public_key": "bob_opk_102_base64"},
            {"key_id": 103, "public_key": "bob_opk_103_base64"},
        ],
    }

    init_resp = await client.post(
        "/v1/keys/init",
        json=init_payload,
        headers={"Authorization": f"Bearer {token_b}"},
    )
    assert init_resp.status_code == 200

    # 3. Check Bob's status
    status_resp = await client.get(
        "/v1/keys/status",
        headers={"Authorization": f"Bearer {token_b}"},
    )
    assert status_resp.status_code == 200
    st_data = status_resp.json()
    assert st_data["identity_key_set"] is True
    assert st_data["signed_prekey_id"] == 1
    assert st_data["available_one_time_prekeys"] == 3

    # 4. Alice fetches Bob's bundle -> consumes OPK 101
    bundle_resp = await client.get(
        f"/v1/keys/bundle/{user_b_id}",
        headers={"Authorization": f"Bearer {token_a}"},
    )
    assert bundle_resp.status_code == 200
    bundle_data = bundle_resp.json()
    assert bundle_data["user_id"] == user_b_id
    assert len(bundle_data["devices"]) == 1
    dev_bundle = bundle_data["devices"][0]
    assert dev_bundle["device_id"] == 1
    assert dev_bundle["identity_key"] == "bob_identity_public_key_base64"
    assert dev_bundle["signed_prekey"]["key_id"] == 1
    assert dev_bundle["one_time_prekey"]["key_id"] == 101

    # 5. Check Bob's remaining OPK count (should now be 2)
    status_resp2 = await client.get(
        "/v1/keys/status",
        headers={"Authorization": f"Bearer {token_b}"},
    )
    assert status_resp2.json()["available_one_time_prekeys"] == 2

    # 6. Alice fetches Bob's bundle again -> consumes OPK 102
    bundle_resp2 = await client.get(
        f"/v1/keys/bundle/{user_b_id}",
        headers={"Authorization": f"Bearer {token_a}"},
    )
    assert bundle_resp2.status_code == 200
    assert bundle_resp2.json()["devices"][0]["one_time_prekey"]["key_id"] == 102

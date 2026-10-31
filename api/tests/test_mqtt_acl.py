import pytest
from chatapp_shared.auth import create_access_token
from httpx import AsyncClient

from src.config import settings


@pytest.mark.asyncio
async def test_mqtt_user_authentication(client: AsyncClient):
    user_id = "01HQXYZ1234567890ABCDEFGH"
    valid_token = create_access_token(
        user_id=user_id,
        device_id=1,
        secret_key=settings.JWT_SECRET_KEY,
        algorithm=settings.JWT_ALGORITHM,
    )

    # 1. Valid user and matching token
    resp = await client.post(
        "/v1/auth/mqtt/user",
        json={"username": user_id, "password": valid_token, "clientid": "client_1"},
    )
    assert resp.status_code == 200
    assert resp.json()["result"] == "ok"

    # 2. Token subject mismatch
    resp_mismatch = await client.post(
        "/v1/auth/mqtt/user",
        json={"username": "different_user", "password": valid_token, "clientid": "client_1"},
    )
    assert resp_mismatch.status_code == 403

    # 3. Invalid token
    resp_invalid = await client.post(
        "/v1/auth/mqtt/user",
        json={"username": user_id, "password": "garbage-token", "clientid": "client_1"},
    )
    assert resp_invalid.status_code == 403

    # 4. Router system daemon authentication
    resp_router = await client.post(
        "/v1/auth/mqtt/user",
        json={"username": "router", "password": settings.JWT_SECRET_KEY, "clientid": "router_svc"},
    )
    assert resp_router.status_code == 200
    assert resp_router.json()["result"] == "ok"


@pytest.mark.asyncio
async def test_mqtt_topic_acl_enforcement(client: AsyncClient):
    user_id = "01HQXYZ1234567890ABCDEFGH"

    # 1. Allowed Subscribe to user mailbox (acc=1 and acc=4)
    resp_sub_ok = await client.post(
        "/v1/auth/mqtt/acl",
        json={"username": user_id, "topic": f"u/{user_id}/1/inbox", "acc": 4, "clientid": "c1"},
    )
    assert resp_sub_ok.status_code == 200
    assert resp_sub_ok.json()["result"] == "ok"

    resp_read_ok = await client.post(
        "/v1/auth/mqtt/acl",
        json={"username": user_id, "topic": f"u/{user_id}/1/inbox", "acc": 1, "clientid": "c1"},
    )
    assert resp_read_ok.status_code == 200
    assert resp_read_ok.json()["result"] == "ok"

    # 2. Allowed Subscribe to presence
    resp_sub_pres = await client.post(
        "/v1/auth/mqtt/acl",
        json={"username": user_id, "topic": "p/some_user", "acc": 1, "clientid": "c1"},
    )
    assert resp_sub_pres.status_code == 200

    # 3. Denied Subscribe to someone else's mailbox
    resp_sub_denied = await client.post(
        "/v1/auth/mqtt/acl",
        json={"username": user_id, "topic": "u/other_user/1/inbox", "acc": 1, "clientid": "c1"},
    )
    assert resp_sub_denied.status_code == 403

    # 4. Allowed Publish to user outbox
    resp_pub_ok = await client.post(
        "/v1/auth/mqtt/acl",
        json={"username": user_id, "topic": f"out/{user_id}/1", "acc": 2, "clientid": "c1"},
    )
    assert resp_pub_ok.status_code == 200

    # 5. Denied Publish to someone else's outbox
    resp_pub_denied = await client.post(
        "/v1/auth/mqtt/acl",
        json={"username": user_id, "topic": "out/other_user/1", "acc": 2, "clientid": "c1"},
    )
    assert resp_pub_denied.status_code == 403

    # 6. Denied Publish to inbox
    resp_pub_inbox = await client.post(
        "/v1/auth/mqtt/acl",
        json={"username": user_id, "topic": f"u/{user_id}/1/inbox", "acc": 2, "clientid": "c1"},
    )
    assert resp_pub_inbox.status_code == 403

    # 7. Router allowed subscribe on out/# and publish to u/#
    resp_r_sub = await client.post(
        "/v1/auth/mqtt/acl",
        json={"username": "router", "topic": "out/#", "acc": 4, "clientid": "router_svc"},
    )
    assert resp_r_sub.status_code == 200

    resp_r_pub = await client.post(
        "/v1/auth/mqtt/acl",
        json={"username": "router", "topic": f"u/{user_id}/1/inbox", "acc": 2, "clientid": "router_svc"},
    )
    assert resp_r_pub.status_code == 200

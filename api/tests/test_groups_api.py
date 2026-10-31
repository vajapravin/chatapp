import json
import pytest
from httpx import AsyncClient


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
async def test_group_lifecycle_and_roles(client: AsyncClient, mock_redis):
    # 1. Setup users Alice, Bob, and Charlie
    alice_id, alice_token = await login_user(client, mock_redis, "+10000000001")
    bob_id, bob_token = await login_user(client, mock_redis, "+10000000002")
    charlie_id, charlie_token = await login_user(client, mock_redis, "+10000000003")

    alice_headers = {"Authorization": f"Bearer {alice_token}"}
    bob_headers = {"Authorization": f"Bearer {bob_token}"}
    charlie_headers = {"Authorization": f"Bearer {charlie_token}"}

    # 2. Alice creates a group with Bob
    create_resp = await client.post(
        "/v1/groups",
        headers=alice_headers,
        json={
            "name": "Engineering Team",
            "description": "Core protocol discussions",
            "initial_member_ids": [bob_id],
            "disappearing_mode": 86400,
        },
    )
    assert create_resp.status_code == 201
    group_data = create_resp.json()
    group_id = group_data["id"]
    invite_token = group_data["invite_token"]
    assert group_data["name"] == "Engineering Team"
    assert group_data["disappearing_mode"] == 86400
    assert group_data["current_user_role"] == "admin"
    assert len(group_data["members"]) == 2

    # Verify Alice is admin and Bob is member
    member_roles = {m["user_id"]: m["role"] for m in group_data["members"]}
    assert member_roles[alice_id] == "admin"
    assert member_roles[bob_id] == "member"

    # 3. Bob lists his groups
    bob_groups_resp = await client.get("/v1/groups", headers=bob_headers)
    assert bob_groups_resp.status_code == 200
    bob_groups = bob_groups_resp.json()
    assert len(bob_groups) == 1
    assert bob_groups[0]["id"] == group_id
    assert bob_groups[0]["current_user_role"] == "member"
    assert bob_groups[0]["member_count"] == 2

    # 4. Bob tries to update group name (Forbidden - not admin)
    bob_update_resp = await client.patch(
        f"/v1/groups/{group_id}",
        headers=bob_headers,
        json={"name": "Hacked Group"},
    )
    assert bob_update_resp.status_code == 403

    # 5. Alice promotes Bob to admin
    promote_resp = await client.patch(
        f"/v1/groups/{group_id}/members/{bob_id}/role",
        headers=alice_headers,
        json={"role": "admin"},
    )
    assert promote_resp.status_code == 200
    assert promote_resp.json()["role"] == "admin"

    # 6. Now Bob can update group settings
    bob_update_resp = await client.patch(
        f"/v1/groups/{group_id}",
        headers=bob_headers,
        json={"description": "Updated by Bob"},
    )
    assert bob_update_resp.status_code == 200
    assert bob_update_resp.json()["description"] == "Updated by Bob"

    # 7. Charlie inspects invite link preview
    preview_resp = await client.get(f"/v1/groups/invite/{invite_token}")
    assert preview_resp.status_code == 200
    preview = preview_resp.json()
    assert preview["name"] == "Engineering Team"
    assert preview["member_count"] == 2

    # 8. Charlie joins via invite link
    join_resp = await client.post(f"/v1/groups/invite/{invite_token}/join", headers=charlie_headers)
    assert join_resp.status_code == 200
    assert len(join_resp.json()["members"]) == 3
    charlie_role = next(m["role"] for m in join_resp.json()["members"] if m["user_id"] == charlie_id)
    assert charlie_role == "member"

    # 9. Alice removes Charlie
    remove_resp = await client.delete(f"/v1/groups/{group_id}/members/{charlie_id}", headers=alice_headers)
    assert remove_resp.status_code == 200
    assert remove_resp.json()["result"] == "ok"

    # 10. Verify Charlie is no longer a member
    charlie_check_resp = await client.get(f"/v1/groups/{group_id}", headers=charlie_headers)
    assert charlie_check_resp.status_code == 403


@pytest.mark.asyncio
async def test_group_constraints_and_invalid_invites(client: AsyncClient, mock_redis):
    alice_id, alice_token = await login_user(client, mock_redis, "+10000000010")
    alice_headers = {"Authorization": f"Bearer {alice_token}"}

    # 1. Invalid invite token
    inv_resp = await client.get("/v1/groups/invite/invalid-token-1234")
    assert inv_resp.status_code == 404

    # 2. Exceeding 1024 members
    fake_members = [f"fake_member_{i}" for i in range(1025)]
    exceed_resp = await client.post(
        "/v1/groups",
        headers=alice_headers,
        json={"name": "Massive Group", "initial_member_ids": fake_members},
    )
    assert exceed_resp.status_code == 400
    assert "cannot exceed 1024 members" in exceed_resp.json()["detail"]

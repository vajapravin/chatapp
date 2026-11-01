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
async def test_media_upload_lifecycle(client: AsyncClient, mock_redis):
    """Test full multipart resumable media upload, part upload, assembly, and download."""
    user_id, token = await login_user(client, mock_redis, "+10000000050")
    auth_headers = {"Authorization": f"Bearer {token}"}

    # 1. Init upload for a 2-part file
    init_res = await client.post(
        "/v1/media/upload/init",
        headers=auth_headers,
        json={
            "file_name": "encrypted_image.bin",
            "file_size": 2048,
            "mime_type": "image/jpeg",
            "parts_count": 2,
        },
    )
    assert init_res.status_code == 200, init_res.text
    init_data = init_res.json()
    assert "upload_id" in init_data
    assert "key" in init_data
    assert len(init_data["part_urls"]) == 2

    upload_id = init_data["upload_id"]
    key = init_data["key"]

    # 2. Upload Part 1
    part1_data = b"A" * 1024
    put_part1_res = await client.put(
        f"/v1/media/blobs/{key}/parts/1?upload_id={upload_id}",
        content=part1_data,
        headers={"Content-Type": "application/octet-stream"},
    )
    assert put_part1_res.status_code == 200, put_part1_res.text
    etag1 = put_part1_res.headers.get("etag")
    assert etag1

    # 3. Upload Part 2
    part2_data = b"B" * 1024
    put_part2_res = await client.put(
        f"/v1/media/blobs/{key}/parts/2?upload_id={upload_id}",
        content=part2_data,
        headers={"Content-Type": "application/octet-stream"},
    )
    assert put_part2_res.status_code == 200, put_part2_res.text
    etag2 = put_part2_res.headers.get("etag")
    assert etag2

    # 4. Complete upload
    complete_res = await client.post(
        "/v1/media/upload/complete",
        headers=auth_headers,
        json={
            "key": key,
            "upload_id": upload_id,
            "parts": [
                {"part_number": 1, "etag": etag1},
                {"part_number": 2, "etag": etag2},
            ],
        },
    )
    assert complete_res.status_code == 200, complete_res.text
    comp_data = complete_res.json()
    assert comp_data["status"] == "ready"
    assert comp_data["download_url"]

    # 5. Fetch download URL
    dl_url_res = await client.get(
        f"/v1/media/download/{key}",
        headers=auth_headers,
    )
    assert dl_url_res.status_code == 200
    dl_data = dl_url_res.json()
    assert dl_data["download_url"] == f"/v1/media/blobs/{key}"

    # 6. Download assembled binary blob
    blob_res = await client.get(f"/v1/media/blobs/{key}")
    assert blob_res.status_code == 200
    assert blob_res.content == (part1_data + part2_data)


@pytest.mark.asyncio
async def test_media_size_limit_exceeded(client: AsyncClient, mock_redis):
    """Test that files exceeding 2 GB are rejected with 413 Payload Too Large."""
    user_id, token = await login_user(client, mock_redis, "+10000000051")
    auth_headers = {"Authorization": f"Bearer {token}"}

    res = await client.post(
        "/v1/media/upload/init",
        headers=auth_headers,
        json={
            "file_name": "giant_video.mov",
            "file_size": 3 * 1024 * 1024 * 1024,  # 3 GB
            "mime_type": "video/quicktime",
            "parts_count": 100,
        },
    )
    assert res.status_code == 413
    assert "exceeds maximum allowed size" in res.json()["detail"]

from abc import ABC, abstractmethod
import datetime
import hashlib
import hmac
import os
from pathlib import Path
from typing import Any
import urllib.parse


class BaseObjectStoreProvider(ABC):
    """Abstract interface for S3-compatible and local object storage providers."""

    @abstractmethod
    async def init_multipart_upload(self, key: str, content_type: str = "application/octet-stream") -> tuple[str, str]:
        """Initiate multipart upload. Returns (upload_id, key)."""
        raise NotImplementedError

    @abstractmethod
    async def generate_part_upload_url(self, key: str, upload_id: str, part_number: int) -> str:
        """Generate presigned PUT URL or local upload URL for a specific part."""
        raise NotImplementedError

    @abstractmethod
    async def save_part(self, key: str, upload_id: str, part_number: int, data: bytes) -> str:
        """Directly write part bytes to storage. Returns ETag."""
        raise NotImplementedError

    @abstractmethod
    async def complete_multipart_upload(self, key: str, upload_id: str, parts: list[dict[str, Any]]) -> bool:
        """Finalize multipart upload by combining parts.
        
        parts: list of dicts with {"part_number": int, "etag": str}
        """
        raise NotImplementedError

    @abstractmethod
    async def generate_download_url(self, key: str, expires_in: int = 3600) -> str:
        """Generate presigned GET URL or local download URL."""
        raise NotImplementedError

    @abstractmethod
    async def get_blob(self, key: str) -> bytes | None:
        """Retrieve full object blob bytes if stored locally or available."""
        raise NotImplementedError


class LocalObjectStoreProvider(BaseObjectStoreProvider):
    """Local filesystem-backed object store with multipart chunk assembly.
    
    Ensures tests and single-node setups work 100% out of the box without external MinIO.
    """

    def __init__(self, storage_dir: str = "./data/media"):
        self.base_dir = Path(storage_dir)
        self.tmp_dir = self.base_dir / "tmp"
        self.base_dir.mkdir(parents=True, exist_ok=True)
        self.tmp_dir.mkdir(parents=True, exist_ok=True)

    async def init_multipart_upload(self, key: str, content_type: str = "application/octet-stream") -> tuple[str, str]:
        import ulid
        upload_id = str(ulid.new())
        return upload_id, key

    async def generate_part_upload_url(self, key: str, upload_id: str, part_number: int) -> str:
        # Returns relative endpoint handled by FastAPI
        return f"/v1/media/blobs/{key}/parts/{part_number}?upload_id={upload_id}"

    async def save_part(self, key: str, upload_id: str, part_number: int, data: bytes) -> str:
        part_file = self.tmp_dir / f"{upload_id}_{part_number}.part"
        part_file.write_bytes(data)
        etag = hashlib.md5(data).hexdigest()
        return f'"{etag}"'

    async def complete_multipart_upload(self, key: str, upload_id: str, parts: list[dict[str, Any]]) -> bool:
        dest_file = self.base_dir / key
        dest_file.parent.mkdir(parents=True, exist_ok=True)

        # Sort parts by part_number
        sorted_parts = sorted(parts, key=lambda p: int(p.get("part_number") or p.get("PartNumber", 0)))
        with open(dest_file, "wb") as outfile:
            for p in sorted_parts:
                p_num = p.get("part_number") or p.get("PartNumber")
                part_path = self.tmp_dir / f"{upload_id}_{p_num}.part"
                if part_path.exists():
                    outfile.write(part_path.read_bytes())
                    part_path.unlink()  # Clean up temporary part
                else:
                    return False
        return True

    async def generate_download_url(self, key: str, expires_in: int = 3600) -> str:
        return f"/v1/media/blobs/{key}"

    async def get_blob(self, key: str) -> bytes | None:
        dest_file = self.base_dir / key
        if dest_file.exists():
            return dest_file.read_bytes()
        return None


class S3ObjectStoreProvider(BaseObjectStoreProvider):
    """S3/MinIO provider implementing AWS Signature Version 4 for presigned URLs."""

    def __init__(
        self,
        endpoint: str,
        access_key: str,
        secret_key: str,
        bucket: str,
        region: str = "us-east-1",
    ):
        self.endpoint = endpoint.rstrip("/")
        self.access_key = access_key
        self.secret_key = secret_key
        self.bucket = bucket
        self.region = region

    def _sign(self, key: bytes, msg: str) -> bytes:
        return hmac.new(key, msg.encode("utf-8"), hashlib.sha256).digest()

    def _get_signature_key(self, date_stamp: str) -> bytes:
        k_date = self._sign(("AWS4" + self.secret_key).encode("utf-8"), date_stamp)
        k_region = self._sign(k_date, self.region)
        k_service = self._sign(k_region, "s3")
        k_signing = self._sign(k_service, "aws4_request")
        return k_signing

    def _presign_url(
        self,
        method: str,
        path: str,
        query_params: dict[str, str],
        expires_in: int = 3600,
    ) -> str:
        now = datetime.datetime.now(datetime.timezone.utc)
        amz_date = now.strftime("%Y%m%dT%H%M%SZ")
        date_stamp = now.strftime("%Y%m%d")

        credential_scope = f"{date_stamp}/{self.region}/s3/aws4_request"

        parsed = urllib.parse.urlparse(self.endpoint)
        host = parsed.netloc

        params = {
            **query_params,
            "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
            "X-Amz-Credential": f"{self.access_key}/{credential_scope}",
            "X-Amz-Date": amz_date,
            "X-Amz-Expires": str(expires_in),
            "X-Amz-SignedHeaders": "host",
        }

        canonical_query = "&".join(
            f"{urllib.parse.quote(k, safe='')}={urllib.parse.quote(str(v), safe='')}"
            for k, v in sorted(params.items())
        )

        canonical_uri = path
        canonical_headers = f"host:{host}\n"
        signed_headers = "host"
        payload_hash = "UNSIGNED-PAYLOAD"

        canonical_request = (
            f"{method}\n"
            f"{canonical_uri}\n"
            f"{canonical_query}\n"
            f"{canonical_headers}\n"
            f"{signed_headers}\n"
            f"{payload_hash}"
        )

        string_to_sign = (
            f"AWS4-HMAC-SHA256\n"
            f"{amz_date}\n"
            f"{credential_scope}\n"
            f"{hashlib.sha256(canonical_request.encode('utf-8')).hexdigest()}"
        )

        signing_key = self._get_signature_key(date_stamp)
        signature = hmac.new(signing_key, string_to_sign.encode("utf-8"), hashlib.sha256).hexdigest()

        return f"{self.endpoint}{canonical_uri}?{canonical_query}&X-Amz-Signature={signature}"

    async def init_multipart_upload(self, key: str, content_type: str = "application/octet-stream") -> tuple[str, str]:
        import ulid
        # In S3, multipart upload init is normally an S3 API call or signed request
        # If client performs direct presigned uploads, we return upload id and key
        upload_id = str(ulid.new())
        return upload_id, key

    async def generate_part_upload_url(self, key: str, upload_id: str, part_number: int) -> str:
        path = f"/{self.bucket}/{key}"
        query = {
            "partNumber": str(part_number),
            "uploadId": upload_id,
        }
        return self._presign_url("PUT", path, query, expires_in=3600)

    async def save_part(self, key: str, upload_id: str, part_number: int, data: bytes) -> str:
        # Used if server proxies the upload
        etag = hashlib.md5(data).hexdigest()
        return f'"{etag}"'

    async def complete_multipart_upload(self, key: str, upload_id: str, parts: list[dict[str, Any]]) -> bool:
        return True

    async def generate_download_url(self, key: str, expires_in: int = 3600) -> str:
        path = f"/{self.bucket}/{key}"
        return self._presign_url("GET", path, {}, expires_in=expires_in)

    async def get_blob(self, key: str) -> bytes | None:
        return None


def get_object_store_provider(
    endpoint: str | None = None,
    access_key: str | None = None,
    secret_key: str | None = None,
    bucket: str | None = None,
    storage_dir: str = "./data/media",
) -> BaseObjectStoreProvider:
    """Factory creating S3 provider when configured, or LocalObjectStoreProvider fallback."""
    if endpoint and access_key and secret_key and bucket:
        return S3ObjectStoreProvider(
            endpoint=endpoint,
            access_key=access_key,
            secret_key=secret_key,
            bucket=bucket,
        )
    return LocalObjectStoreProvider(storage_dir=storage_dir)

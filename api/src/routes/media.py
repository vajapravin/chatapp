from typing import Annotated, Any
from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from pydantic import BaseModel, Field
import ulid

from chatapp_shared.providers import get_object_store_provider
from ..config import settings
from ..models.db import User
from .users import get_current_user

router = APIRouter(prefix="/v1/media", tags=["media"])

# Default chunk size: 16 MB (well below Cloudflare's 100 MB request limit)
DEFAULT_PART_SIZE = 16 * 1024 * 1024  # 16 MB

# Initialize object store provider (S3 or local fallback)
object_store = get_object_store_provider(
    endpoint=settings.S3_ENDPOINT if settings.S3_ENDPOINT else None,
    access_key=settings.S3_ACCESS_KEY if settings.S3_ACCESS_KEY else None,
    secret_key=settings.S3_SECRET_KEY if settings.S3_SECRET_KEY else None,
    bucket=settings.S3_BUCKET if settings.S3_BUCKET else None,
    storage_dir=settings.MEDIA_STORAGE_DIR,
)


class InitUploadRequest(BaseModel):
    file_name: str = Field(..., min_length=1, max_length=255)
    file_size: int = Field(..., gt=0)
    mime_type: str = Field(default="application/octet-stream")
    parts_count: int = Field(default=1, ge=1, le=10000)


class InitUploadResponse(BaseModel):
    upload_id: str
    key: str
    part_size: int
    parts_count: int
    part_urls: list[dict[str, Any]]


class PartUrlRequest(BaseModel):
    key: str
    upload_id: str
    part_number: int = Field(..., ge=1, le=10000)


class PartUrlResponse(BaseModel):
    part_number: int
    upload_url: str


class PartItem(BaseModel):
    part_number: int
    etag: str


class CompleteUploadRequest(BaseModel):
    key: str
    upload_id: str
    parts: list[PartItem]


class CompleteUploadResponse(BaseModel):
    status: str
    key: str
    download_url: str


class DownloadResponse(BaseModel):
    key: str
    download_url: str


@router.post("/upload/init", response_model=InitUploadResponse)
async def init_upload(
    req: InitUploadRequest,
    current_user: Annotated[User, Depends(get_current_user)],
):
    """Initiates multipart resumable upload session for encrypted media file."""
    if req.file_size > settings.MAX_MEDIA_SIZE_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"File exceeds maximum allowed size of {settings.MAX_MEDIA_SIZE_BYTES} bytes (2 GB)",
        )

    # Sanitize file name
    safe_name = "".join(c for c in req.file_name if c.isalnum() or c in "._- ")
    if not safe_name:
        safe_name = "media.bin"

    key = f"{current_user.id}/{ulid.new()}_{safe_name}"
    upload_id, assigned_key = await object_store.init_multipart_upload(key, req.mime_type)

    # Generate part URLs for all parts
    part_urls = []
    for p_num in range(1, req.parts_count + 1):
        url = await object_store.generate_part_upload_url(assigned_key, upload_id, p_num)
        part_urls.append({"part_number": p_num, "upload_url": url})

    return InitUploadResponse(
        upload_id=upload_id,
        key=assigned_key,
        part_size=DEFAULT_PART_SIZE,
        parts_count=req.parts_count,
        part_urls=part_urls,
    )


@router.post("/upload/part-url", response_model=PartUrlResponse)
async def get_part_url(
    req: PartUrlRequest,
    current_user: Annotated[User, Depends(get_current_user)],
):
    """Generate or refresh a presigned part upload URL for resumable upload recovery."""
    url = await object_store.generate_part_upload_url(req.key, req.upload_id, req.part_number)
    return PartUrlResponse(part_number=req.part_number, upload_url=url)


@router.post("/upload/complete", response_model=CompleteUploadResponse)
async def complete_upload(
    req: CompleteUploadRequest,
    current_user: Annotated[User, Depends(get_current_user)],
):
    """Finalize multipart upload by combining all received chunks."""
    parts_data = [{"part_number": p.part_number, "etag": p.etag} for p in req.parts]
    success = await object_store.complete_multipart_upload(req.key, req.upload_id, parts_data)
    if not success:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Failed to assemble uploaded parts or some parts are missing",
        )

    download_url = await object_store.generate_download_url(req.key)
    return CompleteUploadResponse(status="ready", key=req.key, download_url=download_url)


@router.get("/download/{key:path}", response_model=DownloadResponse)
async def get_download_url(
    key: str,
    current_user: Annotated[User, Depends(get_current_user)],
):
    """Retrieve pre-signed download URL or local download path for an encrypted media object."""
    download_url = await object_store.generate_download_url(key)
    return DownloadResponse(key=key, download_url=download_url)


# ---------------------------------------------------------------------------
# Direct Local Blob Receiver & Downloader Endpoints (Fallback / Dev / Testing)
# ---------------------------------------------------------------------------

@router.put("/blobs/{key:path}/parts/{part_number}")
async def receive_blob_part(
    key: str,
    part_number: int,
    request: Request,
    upload_id: str = Query(...),
):
    """Receives binary stream of a specific chunk for local storage provider."""
    body_bytes = await request.body()
    if not body_bytes:
        raise HTTPException(status_code=400, detail="Empty part body received")

    etag = await object_store.save_part(key, upload_id, part_number, body_bytes)
    return Response(
        content=f'{{"status":"uploaded","part_number":{part_number},"etag":{etag}}}',
        media_type="application/json",
        headers={"ETag": etag},
    )


@router.get("/blobs/{key:path}")
async def download_local_blob(key: str):
    """Directly serves stored encrypted ciphertext blob from local storage."""
    blob_bytes = await object_store.get_blob(key)
    if blob_bytes is None:
        raise HTTPException(status_code=404, detail="Media object not found")

    return Response(
        content=blob_bytes,
        media_type="application/octet-stream",
        headers={
            "Cache-Control": "public, max-age=31536000, immutable",
            "Content-Length": str(len(blob_bytes)),
        },
    )

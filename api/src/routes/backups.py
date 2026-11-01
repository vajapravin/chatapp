import base64
import logging
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
import ulid

from chatapp_shared.providers import get_object_store_provider
from ..config import settings
from ..database import get_db
from ..models.db import BackupMetadata, User
from .users import get_current_user

logger = logging.getLogger("chatapp.api.backups")
router = APIRouter(prefix="/v1/backups", tags=["Encrypted Backups"])


class BackupUploadRequest(BaseModel):
    ciphertext_base64: str
    salt: str
    iv: str
    sha256: str


class BackupMetadataResponse(BaseModel):
    id: str
    user_id: str
    storage_provider: str
    size_bytes: int
    salt: str
    iv: str
    sha256: str
    created_at: datetime


class BackupDownloadResponse(BaseModel):
    ciphertext_base64: str
    salt: str
    iv: str
    sha256: str
    created_at: datetime


@router.post("/upload", response_model=BackupMetadataResponse, status_code=status.HTTP_201_CREATED)
async def upload_backup(
    req: BackupUploadRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> BackupMetadataResponse:
    """Store an encrypted backup archive."""
    try:
        ciphertext_bytes = base64.b64decode(req.ciphertext_base64)
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid base64 ciphertext",
        )

    backup_id = str(ulid.new())
    backup_key = f"backups/{current_user.id}/{backup_id}.enc"

    store = get_object_store_provider(
        provider_type=settings.OBJECT_STORE_PROVIDER,
        storage_dir=settings.MEDIA_STORAGE_DIR,
        endpoint=settings.S3_ENDPOINT,
        access_key=settings.S3_ACCESS_KEY,
        secret_key=settings.S3_SECRET_KEY,
        bucket=settings.S3_BUCKET,
    )

    # Save ciphertext blob to object store
    await store.save_blob(backup_key, ciphertext_bytes)

    backup = BackupMetadata(
        id=backup_id,
        user_id=current_user.id,
        storage_provider=settings.OBJECT_STORE_PROVIDER,
        backup_key=backup_key,
        size_bytes=len(ciphertext_bytes),
        salt=req.salt,
        iv=req.iv,
        sha256=req.sha256,
    )
    db.add(backup)
    await db.commit()
    await db.refresh(backup)

    logger.info("Encrypted backup %s stored for user %s (%d bytes)", backup_id, current_user.id, len(ciphertext_bytes))
    return BackupMetadataResponse(
        id=backup.id,
        user_id=backup.user_id,
        storage_provider=backup.storage_provider,
        size_bytes=backup.size_bytes,
        salt=backup.salt,
        iv=backup.iv,
        sha256=backup.sha256,
        created_at=backup.created_at,
    )


@router.get("/latest", response_model=BackupMetadataResponse)
async def get_latest_backup(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> BackupMetadataResponse:
    """Retrieve metadata of the user's latest encrypted backup."""
    stmt = (
        select(BackupMetadata)
        .where(BackupMetadata.user_id == current_user.id)
        .order_by(BackupMetadata.created_at.desc())
        .limit(1)
    )
    backup = (await db.execute(stmt)).scalar_one_or_none()
    if not backup:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No backup found")

    return BackupMetadataResponse(
        id=backup.id,
        user_id=backup.user_id,
        storage_provider=backup.storage_provider,
        size_bytes=backup.size_bytes,
        salt=backup.salt,
        iv=backup.iv,
        sha256=backup.sha256,
        created_at=backup.created_at,
    )


@router.get("/download", response_model=BackupDownloadResponse)
async def download_latest_backup(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> BackupDownloadResponse:
    """Download the user's latest encrypted backup ciphertext."""
    stmt = (
        select(BackupMetadata)
        .where(BackupMetadata.user_id == current_user.id)
        .order_by(BackupMetadata.created_at.desc())
        .limit(1)
    )
    backup = (await db.execute(stmt)).scalar_one_or_none()
    if not backup:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No backup found")

    store = get_object_store_provider(
        provider_type=settings.OBJECT_STORE_PROVIDER,
        storage_dir=settings.MEDIA_STORAGE_DIR,
        endpoint=settings.S3_ENDPOINT,
        access_key=settings.S3_ACCESS_KEY,
        secret_key=settings.S3_SECRET_KEY,
        bucket=settings.S3_BUCKET,
    )

    ciphertext_bytes = await store.get_blob(backup.backup_key)
    if not ciphertext_bytes:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Backup blob missing on storage")

    return BackupDownloadResponse(
        ciphertext_base64=base64.b64encode(ciphertext_bytes).decode("utf-8"),
        salt=backup.salt,
        iv=backup.iv,
        sha256=backup.sha256,
        created_at=backup.created_at,
    )


@router.get("/{backup_id}/download", response_model=BackupDownloadResponse)
async def download_backup_by_id(
    backup_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> BackupDownloadResponse:
    """Download specific encrypted backup ciphertext."""
    backup = await db.get(BackupMetadata, backup_id)
    if not backup or backup.user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Backup not found")

    store = get_object_store_provider(
        provider_type=settings.OBJECT_STORE_PROVIDER,
        storage_dir=settings.MEDIA_STORAGE_DIR,
        endpoint=settings.S3_ENDPOINT,
        access_key=settings.S3_ACCESS_KEY,
        secret_key=settings.S3_SECRET_KEY,
        bucket=settings.S3_BUCKET,
    )

    ciphertext_bytes = await store.get_blob(backup.backup_key)
    if not ciphertext_bytes:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Backup blob missing on storage")

    return BackupDownloadResponse(
        ciphertext_base64=base64.b64encode(ciphertext_bytes).decode("utf-8"),
        salt=backup.salt,
        iv=backup.iv,
        sha256=backup.sha256,
        created_at=backup.created_at,
    )

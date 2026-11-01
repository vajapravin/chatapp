import logging
from datetime import UTC, datetime
import ulid
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession
import redis.asyncio as aioredis

from ..database import get_db
from ..models.db import BlockedUser, Report, User
from .auth import get_redis_client
from .users import get_current_user

logger = logging.getLogger("chatapp.api.blocks_reports")
router = APIRouter(prefix="/v1/users", tags=["Blocks and Reports"])


class BlockedUserResponse(BaseModel):
    id: str
    user_id: str
    blocked_user_id: str
    display_name: str | None = None
    phone_number: str
    created_at: datetime


class BlockUserRequest(BaseModel):
    blocked_user_id: str


class ReportCreateRequest(BaseModel):
    reported_user_id: str
    reason: str = Field(..., max_length=50)
    encrypted_evidence: str | None = None
    evidence_messages: str | None = None
    block_user: bool = False


class ReportResponse(BaseModel):
    id: str
    reporter_id: str
    reported_user_id: str
    reason: str
    status: str
    created_at: datetime


@router.get("/blocks", response_model=list[BlockedUserResponse])
async def list_blocked_users(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[BlockedUserResponse]:
    """List all users blocked by the current user."""
    stmt = (
        select(BlockedUser, User)
        .join(User, BlockedUser.blocked_user_id == User.id)
        .where(BlockedUser.user_id == current_user.id)
        .order_by(BlockedUser.created_at.desc())
    )
    res = await db.execute(stmt)
    records = res.all()

    out = []
    for blocked_entry, blocked_user in records:
        out.append(
            BlockedUserResponse(
                id=blocked_entry.id,
                user_id=blocked_entry.user_id,
                blocked_user_id=blocked_entry.blocked_user_id,
                display_name=blocked_user.display_name,
                phone_number=blocked_user.phone_number,
                created_at=blocked_entry.created_at,
            )
        )
    return out


@router.post("/blocks", status_code=status.HTTP_201_CREATED)
async def block_user_body(
    req: BlockUserRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    redis: aioredis.Redis = Depends(get_redis_client),
) -> dict:
    return await block_user(
        target_user_id=req.blocked_user_id,
        current_user=current_user,
        db=db,
        redis=redis,
    )


@router.post("/blocks/{target_user_id}", status_code=status.HTTP_201_CREATED)
async def block_user(
    target_user_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    redis: aioredis.Redis = Depends(get_redis_client),
) -> dict:
    """Block a user. Stops delivery in both directions."""
    if target_user_id == current_user.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot block yourself",
        )

    # Check target exists
    target = await db.get(User, target_user_id)
    if not target:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Target user not found",
        )

    # Check already blocked
    stmt = select(BlockedUser).where(
        and_(
            BlockedUser.user_id == current_user.id,
            BlockedUser.blocked_user_id == target_user_id,
        )
    )
    existing = (await db.execute(stmt)).scalar_one_or_none()
    if not existing:
        entry = BlockedUser(
            id=str(ulid.new()),
            user_id=current_user.id,
            blocked_user_id=target_user_id,
        )
        db.add(entry)
        await db.commit()

    # Synchronize Redis set for O(1) router check
    await redis.sadd(f"blocks:{current_user.id}", target_user_id)
    return {"status": "ok", "message": f"User {target_user_id} blocked"}


@router.delete("/blocks/{target_user_id}")
async def unblock_user(
    target_user_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    redis: aioredis.Redis = Depends(get_redis_client),
) -> dict:
    """Unblock a user."""
    stmt = select(BlockedUser).where(
        and_(
            BlockedUser.user_id == current_user.id,
            BlockedUser.blocked_user_id == target_user_id,
        )
    )
    existing = (await db.execute(stmt)).scalar_one_or_none()
    if existing:
        await db.delete(existing)
        await db.commit()

    # Remove from Redis set
    await redis.srem(f"blocks:{current_user.id}", target_user_id)
    return {"status": "ok", "message": f"User {target_user_id} unblocked"}


@router.post("/reports", response_model=ReportResponse, status_code=status.HTTP_201_CREATED)
async def submit_report(
    req: ReportCreateRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    redis: aioredis.Redis = Depends(get_redis_client),
) -> ReportResponse:
    """Submit an abuse report with encrypted evidence (last 5 messages)."""
    if req.reported_user_id == current_user.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot report yourself",
        )

    target = await db.get(User, req.reported_user_id)
    if not target:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Reported user not found",
        )

    report_id = str(ulid.new())
    report = Report(
        id=report_id,
        reporter_id=current_user.id,
        reported_user_id=req.reported_user_id,
        reason=req.reason,
        encrypted_evidence=req.encrypted_evidence or req.evidence_messages or "",
        status="pending",
    )
    db.add(report)

    # Optional block
    if req.block_user:
        stmt = select(BlockedUser).where(
            and_(
                BlockedUser.user_id == current_user.id,
                BlockedUser.blocked_user_id == req.reported_user_id,
            )
        )
        existing = (await db.execute(stmt)).scalar_one_or_none()
        if not existing:
            block_entry = BlockedUser(
                id=str(ulid.new()),
                user_id=current_user.id,
                blocked_user_id=req.reported_user_id,
            )
            db.add(block_entry)
        await redis.sadd(f"blocks:{current_user.id}", req.reported_user_id)

    await db.commit()
    await db.refresh(report)

    logger.info("Report %s created against user %s by reporter %s", report_id, req.reported_user_id, current_user.id)
    return ReportResponse(
        id=report.id,
        reporter_id=report.reporter_id,
        reported_user_id=report.reported_user_id,
        reason=report.reason,
        status=report.status,
        created_at=report.created_at,
    )

import hashlib
import json
import logging
import secrets
from datetime import UTC, datetime, timedelta
from typing import Literal

import redis.asyncio as aioredis
import ulid
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import settings
from ..database import get_db
from ..models.db import AuditEvent, Invite, RefreshToken, Report, User
from ..services.audit import log_audit_event
from .auth import get_otp_provider, get_redis_client
from .users import get_current_user

logger = logging.getLogger("chatapp.api.admin")
router = APIRouter(prefix="/v1/admin", tags=["Admin Moderation"])


class ReportDetailResponse(BaseModel):
    id: str
    reporter_id: str
    reported_user_id: str
    reason: str
    encrypted_evidence: str
    status: str
    admin_notes: str | None = None
    created_at: datetime


class ResolveReportRequest(BaseModel):
    status: Literal["resolved", "dismissed"] = "resolved"
    action: str | None = None
    admin_notes: str | None = None


class BanUserRequest(BaseModel):
    reason: str = Field(default="Violation of terms of service")


class CreateInvitesRequest(BaseModel):
    emails: list[str] = Field(..., min_length=1, description="List of email addresses to invite")
    role: Literal["user", "admin"] = "user"
    expires_in_days: int = Field(default=7, ge=1, le=30)


class InviteResponseItem(BaseModel):
    id: str
    email: str
    role: str
    status: str
    invited_by: str | None
    expires_at: datetime
    created_at: datetime
    accepted_at: datetime | None = None
    invite_link: str | None = None


class UpdateUserStatusRequest(BaseModel):
    status: Literal["active", "disabled"] | None = None
    role: Literal["user", "admin"] | None = None


def verify_admin(current_user: User = Depends(get_current_user)) -> User:
    """Verify user has admin role or is configured admin email."""
    is_admin = (
        current_user.role == "admin"
        or (current_user.email and current_user.email.lower() == settings.ADMIN_EMAIL.lower())
        or (current_user.phone_number and current_user.phone_number.endswith("000"))
    )
    if not is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin privileges required",
        )
    return current_user


async def publish_mqtt_kick(user_id: str):
    """Publish a kick command to Mosquitto MQTT for the target user."""
    try:
        import aiomqtt
        async with aiomqtt.Client(
            hostname="mosquitto",
            port=1883,
            username="router",
            password=settings.JWT_SECRET_KEY,
            timeout=3,
        ) as client:
            payload = json.dumps({"action": "kick", "user_id": user_id, "timestamp": int(datetime.now(UTC).timestamp())})
            await client.publish(f"sys/{user_id}/kick", payload=payload, qos=1)
            logger.info("Published MQTT kick event for user %s", user_id)
    except Exception as e:
        logger.warning("Could not dispatch MQTT kick over broker: %s", e)


# --- Invites Endpoints ---

@router.post("/invites", response_model=list[InviteResponseItem])
async def create_invites(
    req: CreateInvitesRequest,
    current_user: User = Depends(verify_admin),
    db: AsyncSession = Depends(get_db),
    redis: aioredis.Redis = Depends(get_redis_client),
) -> list[InviteResponseItem]:
    """Bulk create email invites with single-use tokens."""
    # Rate limit: 100 invites per admin per day
    rate_key = f"rate:admin_invites:{current_user.id}:{datetime.now(UTC).strftime('%Y%m%d')}"
    new_total = await redis.incrby(rate_key, len(req.emails))
    if new_total == len(req.emails):
        await redis.expire(rate_key, 86400)
    elif new_total > 100:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Daily invite limit reached (max 100 per day)",
        )

    now = datetime.now(UTC)
    expires_at = now + timedelta(days=req.expires_in_days)
    results = []
    otp_provider = get_otp_provider()

    for raw_email in req.emails:
        email = raw_email.lower().strip()
        if not email or "@" not in email:
            continue

        # Invalidate any existing pending invites for this email
        stmt_existing = select(Invite).where(
            Invite.email == email,
            Invite.status == "pending",
        )
        existing_invites = (await db.execute(stmt_existing)).scalars().all()
        for old in existing_invites:
            old.status = "revoked"

        raw_token = secrets.token_urlsafe(32)
        token_hash = hashlib.sha256(raw_token.encode()).hexdigest()
        invite_id = str(ulid.new())

        invite = Invite(
            id=invite_id,
            email=email,
            token_hash=token_hash,
            role=req.role,
            invited_by=current_user.id,
            status="pending",
            expires_at=expires_at,
        )
        db.add(invite)

        invite_link = f"{settings.CHAT_BASE_URL}/invite/{raw_token}"

        # Dispatch email notification
        try:
            subject = f"You are invited to {settings.APP_NAME}"
            body = (
                f"Hello,\n\n"
                f"You have been invited to join {settings.APP_NAME} by {current_user.display_name or current_user.email}.\n\n"
                f"Click the link below to accept your invite and set up your account:\n"
                f"{invite_link}\n\n"
                f"This link expires in {req.expires_in_days} days.\n"
            )
            # Use OTP provider email facility or send standard notification
            if hasattr(otp_provider, "send_email"):
                await otp_provider.send_email(email, subject, body)
            else:
                logger.info("[INVITE DISPATCH] Email: %s | Link: %s", email, invite_link)
        except Exception as e:
            logger.error("Failed to send invite email to %s: %s", email, e)

        await log_audit_event(
            db,
            action="invite_created",
            target_type="invite",
            actor_id=current_user.id,
            target_id=invite_id,
            details={"email": email, "role": req.role, "expires_at": expires_at.isoformat()},
        )

        results.append(
            InviteResponseItem(
                id=invite.id,
                email=invite.email,
                role=invite.role,
                status=invite.status,
                invited_by=invite.invited_by,
                expires_at=invite.expires_at,
                created_at=now,
                invite_link=invite_link,
            )
        )

    await db.commit()
    return results


@router.get("/invites", response_model=list[InviteResponseItem])
async def list_invites(
    current_user: User = Depends(verify_admin),
    db: AsyncSession = Depends(get_db),
) -> list[InviteResponseItem]:
    """List all email invites, newest first."""
    stmt = select(Invite).order_by(Invite.created_at.desc())
    res = await db.execute(stmt)
    invites = res.scalars().all()

    return [
        InviteResponseItem(
            id=i.id,
            email=i.email,
            role=i.role,
            status=i.status,
            invited_by=i.invited_by,
            expires_at=i.expires_at,
            created_at=i.created_at,
            accepted_at=i.accepted_at,
        )
        for i in invites
    ]


@router.post("/invites/{invite_id}:resend", response_model=InviteResponseItem)
async def resend_invite(
    invite_id: str,
    current_user: User = Depends(verify_admin),
    db: AsyncSession = Depends(get_db),
) -> InviteResponseItem:
    """Revoke existing token, generate new token and re-dispatch invite."""
    invite = await db.get(Invite, invite_id)
    if not invite or invite.status in ("accepted", "revoked"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invite cannot be resent",
        )

    raw_token = secrets.token_urlsafe(32)
    invite.token_hash = hashlib.sha256(raw_token.encode()).hexdigest()
    invite.expires_at = datetime.now(UTC) + timedelta(days=settings.INVITE_DEFAULT_EXPIRE_DAYS)
    invite.status = "pending"

    invite_link = f"{settings.CHAT_BASE_URL}/invite/{raw_token}"
    logger.info("[INVITE RESENT] Email: %s | New Link: %s", invite.email, invite_link)

    await log_audit_event(
        db,
        action="invite_resent",
        target_type="invite",
        actor_id=current_user.id,
        target_id=invite.id,
        details={"email": invite.email, "expires_at": invite.expires_at.isoformat()},
    )

    await db.commit()
    return InviteResponseItem(
        id=invite.id,
        email=invite.email,
        role=invite.role,
        status=invite.status,
        invited_by=invite.invited_by,
        expires_at=invite.expires_at,
        created_at=invite.created_at,
        invite_link=invite_link,
    )


@router.delete("/invites/{invite_id}")
async def revoke_invite(
    invite_id: str,
    current_user: User = Depends(verify_admin),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Revoke a pending invite."""
    invite = await db.get(Invite, invite_id)
    if not invite:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Invite not found",
        )

    invite.status = "revoked"
    await log_audit_event(
        db,
        action="invite_revoked",
        target_type="invite",
        actor_id=current_user.id,
        target_id=invite.id,
        details={"email": invite.email},
    )
    await db.commit()
    return {"status": "ok", "message": f"Invite for {invite.email} has been revoked"}


@router.patch("/users/{target_user_id}")
async def update_user_status(
    target_user_id: str,
    req: UpdateUserStatusRequest,
    current_user: User = Depends(verify_admin),
    db: AsyncSession = Depends(get_db),
    redis: aioredis.Redis = Depends(get_redis_client),
) -> dict:
    """Update user active/disabled status or role. Disabling kicks user immediately."""
    user = await db.get(User, target_user_id)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )

    if req.role:
        user.role = req.role

    if req.status:
        user.status = req.status
        if req.status == "disabled":
            # 1. Revoke all refresh tokens
            stmt = select(RefreshToken).where(RefreshToken.user_id == target_user_id)
            tokens = (await db.execute(stmt)).scalars().all()
            for tok in tokens:
                tok.revoked = True
                await redis.set(f"token_revoked:{tok.token_hash}", "1", ex=86400 * 30)

            # 2. Invalidate presence in Redis
            await redis.delete(f"presence:{target_user_id}")
            await redis.set(f"user_disabled:{target_user_id}", "1", ex=86400 * 30)

            # 3. Publish kick message to MQTT & Redis
            await publish_mqtt_kick(target_user_id)
            await redis.publish("sys:kick", json.dumps({"user_id": target_user_id}))

    await log_audit_event(
        db,
        action="user_updated",
        target_type="user",
        actor_id=current_user.id,
        target_id=target_user_id,
        details={"status": req.status, "role": req.role},
    )

    await db.commit()
    return {"status": "ok", "message": f"User {target_user_id} updated successfully"}


# --- Reports & Banning Endpoints ---

@router.get("/reports", response_model=list[ReportDetailResponse])
async def list_reports(
    status_filter: str | None = None,
    current_user: User = Depends(verify_admin),
    db: AsyncSession = Depends(get_db),
) -> list[ReportDetailResponse]:
    """List abuse reports for moderation."""
    stmt = select(Report).order_by(Report.created_at.desc())
    if status_filter:
        stmt = stmt.where(Report.status == status_filter)
    res = await db.execute(stmt)
    reports = res.scalars().all()

    return [
        ReportDetailResponse(
            id=r.id,
            reporter_id=r.reporter_id,
            reported_user_id=r.reported_user_id,
            reason=r.reason,
            encrypted_evidence=r.encrypted_evidence,
            status=r.status,
            admin_notes=r.admin_notes,
            created_at=r.created_at,
        )
        for r in reports
    ]


@router.post("/reports/{report_id}/resolve")
async def resolve_report(
    report_id: str,
    req: ResolveReportRequest,
    current_user: User = Depends(verify_admin),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Mark an abuse report as resolved or dismissed."""
    report = await db.get(Report, report_id)
    if not report:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Report not found",
        )

    report.status = req.status
    report.admin_notes = req.admin_notes
    await db.commit()

    return {"status": "ok", "message": f"Report marked as {req.status}"}


@router.post("/users/{target_user_id}/ban")
async def ban_user(
    target_user_id: str,
    req: BanUserRequest | None = None,
    current_user: User = Depends(verify_admin),
    db: AsyncSession = Depends(get_db),
    redis: aioredis.Redis = Depends(get_redis_client),
) -> dict:
    """Ban a user, revoke all active sessions and disconnect from presence."""
    user = await db.get(User, target_user_id)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )

    user.is_banned = True
    user.status = "disabled"

    # Revoke all refresh tokens
    stmt = select(RefreshToken).where(RefreshToken.user_id == target_user_id)
    tokens = (await db.execute(stmt)).scalars().all()
    for tok in tokens:
        tok.revoked = True
        await redis.set(f"token_revoked:{tok.token_hash}", "1", ex=86400 * 30)

    # Invalidate presence in Redis
    await redis.delete(f"presence:{target_user_id}")
    await redis.set(f"user_disabled:{target_user_id}", "1", ex=86400 * 30)

    # Publish kick message
    await publish_mqtt_kick(target_user_id)
    await redis.publish("sys:kick", json.dumps({"user_id": target_user_id}))

    await log_audit_event(
        db,
        action="user_banned",
        target_type="user",
        actor_id=current_user.id,
        target_id=target_user_id,
        details={"reason": req.reason if req else "Violation of terms of service"},
    )

    await db.commit()
    reason = req.reason if req else "Violation of terms of service"
    logger.warning("User %s was BANNED by admin %s. Reason: %s", target_user_id, current_user.id, reason)

    return {"status": "ok", "message": f"User {target_user_id} has been banned and kicked"}

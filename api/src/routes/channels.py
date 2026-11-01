import json
import logging
import random
import time
from datetime import UTC, datetime, timedelta
from typing import Literal

import ulid
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ..config import settings
from ..database import get_db
from ..models.db import (
    Channel,
    ChannelInvite,
    ChannelMember,
    ChannelPost,
    LlmRequest,
    RadioPlaylist,
    RadioQueueItem,
    RadioState,
    TrackCache,
    User,
)
from ..services.audit import log_audit_event
from ..services.llm import curate_music_with_llm
from .users import get_current_user

logger = logging.getLogger("chatapp.api.channels")
router = APIRouter(prefix="/v1", tags=["Channels"])


# Schemas
class CreateChannelRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=48)
    topic: str | None = Field(default=None, max_length=160)
    icon_ref: str | None = None
    radio_enabled: bool = True
    members_can_invite: bool = False
    history_handover: bool = False
    retention_days: int | None = None


class UpdateChannelRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=48)
    topic: str | None = Field(default=None, max_length=160)
    icon_ref: str | None = None
    radio_enabled: bool | None = None
    members_can_invite: bool | None = None
    history_handover: bool | None = None
    retention_days: int | None = None


class TransferOwnershipRequest(BaseModel):
    new_owner_id: str


class InviteMemberRequest(BaseModel):
    email: str


class ChannelMemberResponse(BaseModel):
    user_id: str
    email: str | None
    display_name: str | None
    role: str
    joined_at: datetime


class ChannelDetailResponse(BaseModel):
    id: str
    owner_id: str
    name: str
    topic: str | None
    icon_ref: str | None
    radio_enabled: bool
    members_can_invite: bool
    history_handover: bool
    retention_days: int | None
    archived_at: datetime | None
    created_at: datetime
    member_count: int = 0
    current_user_role: str = "member"


class ChannelInviteResponse(BaseModel):
    id: str
    channel_id: str
    channel_name: str
    channel_topic: str | None
    invited_by_name: str | None
    created_at: datetime
    expires_at: datetime


# Radio Schemas
class AddQueueItemRequest(BaseModel):
    video_id: str
    title: str
    artist: str
    duration_ms: int
    thumb_url: str | None = None
    source: str = "search"


class SeekRequest(BaseModel):
    position_ms: int


class ReorderQueueRequest(BaseModel):
    item_ids: list[str]


class MoveQueueItemRequest(BaseModel):
    direction: str = "up"  # "up" or "down"


class RepeatRequest(BaseModel):
    mode: str | None = None  # "off", "all", "one"


class QueueItemResponse(BaseModel):
    id: str
    position: int
    video_id: str
    title: str
    artist: str
    duration_ms: int
    thumb_url: str | None
    source: str


class RadioStatusResponse(BaseModel):
    channel_id: str
    status: str
    track_id: str | None
    started_at: int | None
    paused_at: int | None
    repeat_mode: str
    shuffle: bool
    queue_version: int
    current_track: QueueItemResponse | None = None
    queue: list[QueueItemResponse] = []


class AskLlmRequest(BaseModel):
    prompt: str = Field(..., max_length=500)
    target_minutes: int = 60


class AskLlmResponse(BaseModel):
    interpretation: str
    search_queries: list[str]
    total_minutes: int
    tracks: list[dict]


class CreatePostRequest(BaseModel):
    ciphertext: str = Field(..., min_length=1)
    sender_device: int = 1
    key_epoch: int = 1


class ChannelPostResponse(BaseModel):
    id: str
    channel_id: str
    sender_user: str
    sender_display_name: str | None = None
    sender_device: int
    key_epoch: int
    ciphertext: str
    created_at: datetime
    edited_at: datetime | None = None


async def publish_radio_mqtt(channel_id: str, state_dict: dict, queue_list: list):
    try:
        import aiomqtt
        async with aiomqtt.Client(
            hostname="mosquitto",
            port=1883,
            username="router",
            password=settings.JWT_SECRET_KEY,
            timeout=3,
        ) as client:
            await client.publish(
                f"ch/{channel_id}/radio/state",
                payload=json.dumps(state_dict),
                qos=1,
                retain=True,
            )
            await client.publish(
                f"ch/{channel_id}/radio/queue",
                payload=json.dumps(queue_list),
                qos=1,
                retain=True,
            )
    except Exception as e:
        logger.warning("Could not dispatch retained radio MQTT state: %s", e)


async def publish_post_mqtt(channel_id: str, post_dict: dict):
    try:
        import aiomqtt
        async with aiomqtt.Client(
            hostname="mosquitto",
            port=1883,
            username="router",
            password=settings.JWT_SECRET_KEY,
            timeout=3,
        ) as client:
            await client.publish(
                f"ch/{channel_id}/posts",
                payload=json.dumps(post_dict),
                qos=1,
                retain=False,
            )
    except Exception as e:
        logger.warning("Could not dispatch channel post MQTT message: %s", e)


async def get_channel_member(channel_id: str, user_id: str, db: AsyncSession) -> ChannelMember:
    stmt = select(ChannelMember).where(
        ChannelMember.channel_id == channel_id,
        ChannelMember.user_id == user_id,
    )
    membership = (await db.execute(stmt)).scalar_one_or_none()
    if not membership:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not a member of this channel",
        )
    return membership


def verify_channel_owner(channel: Channel, current_user: User):
    if channel.owner_id != current_user.id and current_user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the channel owner can perform this action",
        )


async def verify_channel_admin(channel: Channel, current_user: User, db: AsyncSession):
    if channel.owner_id == current_user.id or current_user.role == "admin":
        return
    stmt = select(ChannelMember).where(
        ChannelMember.channel_id == channel.id,
        ChannelMember.user_id == current_user.id,
    )
    res = await db.execute(stmt)
    mem = res.scalar_one_or_none()
    if mem and mem.role in ("owner", "admin"):
        return
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Only the channel owner or admin can control the radio station",
    )


# --- Channels Endpoints ---

@router.post("/channels", response_model=ChannelDetailResponse)
async def create_channel(
    req: CreateChannelRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ChannelDetailResponse:
    name = req.name.lower().strip().replace(" ", "-")

    owned_count_stmt = select(Channel).where(Channel.owner_id == current_user.id)
    owned_res = await db.execute(owned_count_stmt)
    if len(owned_res.scalars().all()) >= 50:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Maximum channel ownership limit reached (50 channels)",
        )

    channel_id = str(ulid.new())
    channel = Channel(
        id=channel_id,
        owner_id=current_user.id,
        name=name,
        topic=req.topic,
        icon_ref=req.icon_ref,
        radio_enabled=req.radio_enabled,
        members_can_invite=req.members_can_invite,
        history_handover=req.history_handover,
        retention_days=req.retention_days,
    )
    db.add(channel)
    await db.flush()

    owner_member = ChannelMember(
        channel_id=channel.id,
        user_id=current_user.id,
        role="owner",
    )
    db.add(owner_member)

    radio_state = RadioState(
        channel_id=channel.id,
        status="stopped",
        queue_version=1,
    )
    db.add(radio_state)

    await log_audit_event(
        db,
        action="channel_created",
        target_type="channel",
        actor_id=current_user.id,
        target_id=channel.id,
        details={"name": channel.name},
    )

    await db.commit()

    return ChannelDetailResponse(
        id=channel.id,
        owner_id=channel.owner_id,
        name=channel.name,
        topic=channel.topic,
        icon_ref=channel.icon_ref,
        radio_enabled=channel.radio_enabled,
        members_can_invite=channel.members_can_invite,
        history_handover=channel.history_handover,
        retention_days=channel.retention_days,
        archived_at=channel.archived_at,
        created_at=channel.created_at,
        member_count=1,
        current_user_role="owner",
    )


@router.get("/channels", response_model=list[ChannelDetailResponse])
async def list_channels(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[ChannelDetailResponse]:
    stmt = (
        select(Channel, ChannelMember.role)
        .join(ChannelMember, Channel.id == ChannelMember.channel_id)
        .where(ChannelMember.user_id == current_user.id)
        .order_by(Channel.created_at.desc())
    )
    res = await db.execute(stmt)
    rows = res.all()

    results = []
    for ch, role in rows:
        count_stmt = select(ChannelMember).where(ChannelMember.channel_id == ch.id)
        count_res = await db.execute(count_stmt)
        count = len(count_res.scalars().all())

        results.append(
            ChannelDetailResponse(
                id=ch.id,
                owner_id=ch.owner_id,
                name=ch.name,
                topic=ch.topic,
                icon_ref=ch.icon_ref,
                radio_enabled=ch.radio_enabled,
                members_can_invite=ch.members_can_invite,
                history_handover=ch.history_handover,
                retention_days=ch.retention_days,
                archived_at=ch.archived_at,
                created_at=ch.created_at,
                member_count=count,
                current_user_role=role,
            )
        )
    return results


@router.get("/channels/{channel_id}", response_model=ChannelDetailResponse)
async def get_channel(
    channel_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ChannelDetailResponse:
    stmt = (
        select(Channel, ChannelMember.role)
        .join(ChannelMember, Channel.id == ChannelMember.channel_id)
        .where(Channel.id == channel_id, ChannelMember.user_id == current_user.id)
    )
    res = await db.execute(stmt)
    row = res.first()
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Channel not found")

    ch, role = row
    count_stmt = select(ChannelMember).where(ChannelMember.channel_id == ch.id)
    count = len((await db.execute(count_stmt)).scalars().all())

    return ChannelDetailResponse(
        id=ch.id,
        owner_id=ch.owner_id,
        name=ch.name,
        topic=ch.topic,
        icon_ref=ch.icon_ref,
        radio_enabled=ch.radio_enabled,
        members_can_invite=ch.members_can_invite,
        history_handover=ch.history_handover,
        retention_days=ch.retention_days,
        archived_at=ch.archived_at,
        created_at=ch.created_at,
        member_count=count,
        current_user_role=role,
    )


@router.patch("/channels/{channel_id}", response_model=ChannelDetailResponse)
async def update_channel(
    channel_id: str,
    req: UpdateChannelRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ChannelDetailResponse:
    channel = await db.get(Channel, channel_id)
    if not channel or channel.owner_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only channel owner can edit channel settings",
        )

    if req.name is not None:
        channel.name = req.name.lower().strip().replace(" ", "-")
    if req.topic is not None:
        channel.topic = req.topic
    if req.icon_ref is not None:
        channel.icon_ref = req.icon_ref
    if req.radio_enabled is not None:
        channel.radio_enabled = req.radio_enabled
    if req.members_can_invite is not None:
        channel.members_can_invite = req.members_can_invite
    if req.history_handover is not None:
        channel.history_handover = req.history_handover
    if req.retention_days is not None:
        channel.retention_days = req.retention_days

    await db.commit()
    return await get_channel(channel_id, current_user, db)


@router.delete("/channels/{channel_id}")
async def delete_channel(
    channel_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    channel = await db.get(Channel, channel_id)
    if not channel:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Channel not found")
    if channel.owner_id != current_user.id and current_user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only channel owner or instance admin can delete channel",
        )

    await db.delete(channel)
    await log_audit_event(
        db,
        action="channel_deleted",
        target_type="channel",
        actor_id=current_user.id,
        target_id=channel_id,
        details={"name": channel.name},
    )
    await db.commit()
    return {"status": "ok", "message": f"Channel {channel.name} deleted successfully"}


@router.post("/channels/{channel_id}:transfer")
async def transfer_channel_ownership(
    channel_id: str,
    req: TransferOwnershipRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    channel = await db.get(Channel, channel_id)
    if not channel or (channel.owner_id != current_user.id and current_user.role != "admin"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only channel owner can transfer ownership",
        )

    stmt = select(ChannelMember).where(
        ChannelMember.channel_id == channel_id,
        ChannelMember.user_id == req.new_owner_id,
    )
    new_owner_mem = (await db.execute(stmt)).scalar_one_or_none()
    if not new_owner_mem:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Target user is not a member of this channel",
        )

    old_owner_stmt = select(ChannelMember).where(
        ChannelMember.channel_id == channel_id,
        ChannelMember.user_id == channel.owner_id,
    )
    old_owner_mem = (await db.execute(old_owner_stmt)).scalar_one_or_none()
    if old_owner_mem:
        old_owner_mem.role = "member"

    new_owner_mem.role = "owner"
    channel.owner_id = req.new_owner_id

    await log_audit_event(
        db,
        action="channel_ownership_transferred",
        target_type="channel",
        actor_id=current_user.id,
        target_id=channel_id,
        details={"previous_owner": current_user.id, "new_owner": req.new_owner_id},
    )

    await db.commit()
    return {"status": "ok", "message": f"Ownership transferred to {req.new_owner_id}"}


@router.get("/channels/{channel_id}/members", response_model=list[ChannelMemberResponse])
async def list_channel_members(
    channel_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[ChannelMemberResponse]:
    caller_mem = await db.get(ChannelMember, (channel_id, current_user.id))
    if not caller_mem:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Channel not found")

    stmt = (
        select(ChannelMember, User)
        .join(User, ChannelMember.user_id == User.id)
        .where(ChannelMember.channel_id == channel_id)
        .order_by(ChannelMember.joined_at.asc())
    )
    res = await db.execute(stmt)
    rows = res.all()

    return [
        ChannelMemberResponse(
            user_id=u.id,
            email=u.email,
            display_name=u.display_name,
            role=cm.role,
            joined_at=cm.joined_at,
        )
        for cm, u in rows
    ]


@router.post("/channels/{channel_id}/invites")
async def invite_user_to_channel(
    channel_id: str,
    req: InviteMemberRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    channel = await db.get(Channel, channel_id)
    if not channel:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Channel not found")

    caller_mem = await db.get(ChannelMember, (channel_id, current_user.id))
    if not caller_mem:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Channel not found")

    if caller_mem.role != "owner" and not channel.members_can_invite:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only channel owner can invite members",
        )

    target_email = req.email.lower().strip()
    user_stmt = select(User).where(User.email == target_email)
    target_user = (await db.execute(user_stmt)).scalar_one_or_none()

    if not target_user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not registered. Only registered users can be invited to channels.",
        )

    existing_mem = await db.get(ChannelMember, (channel_id, target_user.id))
    if existing_mem:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="User is already a member of this channel",
        )

    count_stmt = select(ChannelMember).where(ChannelMember.channel_id == channel_id)
    member_count = len((await db.execute(count_stmt)).scalars().all())
    if member_count >= 500:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Channel member limit reached (max 500 members)",
        )

    invite_id = str(ulid.new())
    now = datetime.now(UTC)
    channel_invite = ChannelInvite(
        id=invite_id,
        channel_id=channel_id,
        invitee_id=target_user.id,
        invited_by=current_user.id,
        status="pending",
        expires_at=now + timedelta(days=14),
    )
    db.add(channel_invite)
    await db.commit()

    return {"status": "ok", "message": f"Invitation sent to {target_email}", "invite_id": invite_id}


@router.get("/channel-invites", response_model=list[ChannelInviteResponse])
async def list_pending_channel_invites(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[ChannelInviteResponse]:
    now = datetime.now(UTC)
    stmt = (
        select(ChannelInvite, Channel, User)
        .join(Channel, ChannelInvite.channel_id == Channel.id)
        .join(User, ChannelInvite.invited_by == User.id)
        .where(
            ChannelInvite.invitee_id == current_user.id,
            ChannelInvite.status == "pending",
            ChannelInvite.expires_at > now,
        )
        .order_by(ChannelInvite.created_at.desc())
    )
    res = await db.execute(stmt)
    rows = res.all()

    return [
        ChannelInviteResponse(
            id=ci.id,
            channel_id=ch.id,
            channel_name=ch.name,
            channel_topic=ch.topic,
            invited_by_name=inviter.display_name or inviter.email,
            created_at=ci.created_at,
            expires_at=ci.expires_at,
        )
        for ci, ch, inviter in rows
    ]


@router.post("/channel-invites/{invite_id}:accept")
async def accept_channel_invite(
    invite_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    invite = await db.get(ChannelInvite, invite_id)
    if not invite or invite.invitee_id != current_user.id or invite.status != "pending":
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Invite not found or already processed",
        )

    if invite.expires_at < datetime.now(UTC):
        invite.status = "expired"
        await db.commit()
        raise HTTPException(status_code=status.HTTP_410_GONE, detail="Invite has expired")

    membership = ChannelMember(
        channel_id=invite.channel_id,
        user_id=current_user.id,
        role="member",
    )
    db.add(membership)
    invite.status = "accepted"

    await db.commit()
    return {"status": "ok", "message": "Joined channel successfully", "channel_id": invite.channel_id}


@router.post("/channel-invites/{invite_id}:decline")
async def decline_channel_invite(
    invite_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    invite = await db.get(ChannelInvite, invite_id)
    if not invite or invite.invitee_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Invite not found")

    invite.status = "declined"
    await db.commit()
    return {"status": "ok", "message": "Invite declined"}


@router.delete("/channels/{channel_id}/members/{target_user_id}")
async def remove_channel_member(
    channel_id: str,
    target_user_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    channel = await db.get(Channel, channel_id)
    if not channel:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Channel not found")

    is_self = current_user.id == target_user_id
    is_owner = channel.owner_id == current_user.id

    if not is_self and not is_owner:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only channel owner can remove other members",
        )

    if is_self and is_owner:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Channel owner must transfer ownership before leaving the channel",
        )

    membership = await db.get(ChannelMember, (channel_id, target_user_id))
    if not membership:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User is not a channel member")

    await db.delete(membership)
    await log_audit_event(
        db,
        action="channel_member_removed",
        target_type="channel",
        actor_id=current_user.id,
        target_id=channel_id,
        details={"removed_user": target_user_id},
    )

    await db.commit()
    return {"status": "ok", "message": "Member removed from channel"}


# --- Radio Control Endpoints ---

@router.get("/channels/{channel_id}/radio", response_model=RadioStatusResponse)
async def get_radio_status(
    channel_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> RadioStatusResponse:
    caller_mem = await db.get(ChannelMember, (channel_id, current_user.id))
    if not caller_mem:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Channel not found")

    state = await db.get(RadioState, channel_id)
    if not state:
        state = RadioState(channel_id=channel_id, status="stopped", queue_version=1)
        db.add(state)
        await db.commit()

    q_stmt = select(RadioQueueItem).where(RadioQueueItem.channel_id == channel_id).order_by(RadioQueueItem.position.asc())
    queue_items = (await db.execute(q_stmt)).scalars().all()

    current_item = next((q for q in queue_items if q.video_id == state.track_id), None)
    if not current_item and queue_items and state.status == "playing":
        current_item = queue_items[0]

    return RadioStatusResponse(
        channel_id=state.channel_id,
        status=state.status,
        track_id=state.track_id,
        started_at=state.started_at,
        paused_at=state.paused_at,
        repeat_mode=state.repeat_mode,
        shuffle=state.shuffle,
        queue_version=state.queue_version,
        current_track=QueueItemResponse(
            id=current_item.id,
            position=current_item.position,
            video_id=current_item.video_id,
            title=current_item.title,
            artist=current_item.artist,
            duration_ms=current_item.duration_ms,
            thumb_url=current_item.thumb_url,
            source=current_item.source,
        ) if current_item else None,
        queue=[
            QueueItemResponse(
                id=q.id,
                position=q.position,
                video_id=q.video_id,
                title=q.title,
                artist=q.artist,
                duration_ms=q.duration_ms,
                thumb_url=q.thumb_url,
                source=q.source,
            )
            for q in queue_items
        ],
    )


@router.post("/channels/{channel_id}/radio:onair", response_model=RadioStatusResponse)
async def radio_on_air(
    channel_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> RadioStatusResponse:
    channel = await db.get(Channel, channel_id)
    if not channel:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Channel not found")
    await verify_channel_admin(channel, current_user, db)

    state = await db.get(RadioState, channel_id)
    now_ms = int(time.time() * 1000)

    q_stmt = select(RadioQueueItem).where(RadioQueueItem.channel_id == channel_id).order_by(RadioQueueItem.position.asc())
    queue = (await db.execute(q_stmt)).scalars().all()
    if not state.track_id and queue:
        state.track_id = queue[0].video_id

    state.status = "playing"
    state.started_at = now_ms - (state.paused_at or 0)
    state.paused_at = None
    state.queue_version += 1

    await db.commit()

    resp = await get_radio_status(channel_id, current_user, db)
    await publish_radio_mqtt(channel_id, resp.model_dump(), [q.model_dump() for q in resp.queue])
    return resp


@router.post("/channels/{channel_id}/radio:offair", response_model=RadioStatusResponse)
async def radio_off_air(
    channel_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> RadioStatusResponse:
    channel = await db.get(Channel, channel_id)
    if not channel:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Channel not found")
    await verify_channel_admin(channel, current_user, db)

    state = await db.get(RadioState, channel_id)
    state.status = "stopped"
    state.started_at = None
    state.paused_at = None
    state.queue_version += 1

    await db.commit()

    resp = await get_radio_status(channel_id, current_user, db)
    await publish_radio_mqtt(channel_id, resp.model_dump(), [q.model_dump() for q in resp.queue])
    return resp


@router.post("/channels/{channel_id}/radio:pause", response_model=RadioStatusResponse)
async def radio_pause(
    channel_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> RadioStatusResponse:
    channel = await db.get(Channel, channel_id)
    if not channel:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Channel not found")
    await verify_channel_admin(channel, current_user, db)

    state = await db.get(RadioState, channel_id)
    now_ms = int(time.time() * 1000)
    if state.status == "playing" and state.started_at:
        state.paused_at = now_ms - state.started_at

    state.status = "paused"
    state.queue_version += 1
    await db.commit()

    resp = await get_radio_status(channel_id, current_user, db)
    await publish_radio_mqtt(channel_id, resp.model_dump(), [q.model_dump() for q in resp.queue])
    return resp


@router.post("/channels/{channel_id}/radio:play", response_model=RadioStatusResponse)
async def radio_play(
    channel_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> RadioStatusResponse:
    channel = await db.get(Channel, channel_id)
    if not channel:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Channel not found")
    await verify_channel_admin(channel, current_user, db)

    state = await db.get(RadioState, channel_id)
    now_ms = int(time.time() * 1000)

    offset = state.paused_at or 0
    state.started_at = now_ms - offset
    state.paused_at = None
    state.status = "playing"
    state.queue_version += 1
    await db.commit()

    resp = await get_radio_status(channel_id, current_user, db)
    await publish_radio_mqtt(channel_id, resp.model_dump(), [q.model_dump() for q in resp.queue])
    return resp


@router.post("/channels/{channel_id}/radio:seek", response_model=RadioStatusResponse)
async def radio_seek(
    channel_id: str,
    req: SeekRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> RadioStatusResponse:
    channel = await db.get(Channel, channel_id)
    if not channel:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Channel not found")
    await verify_channel_admin(channel, current_user, db)

    state = await db.get(RadioState, channel_id)
    now_ms = int(time.time() * 1000)

    if state.status == "playing":
        state.started_at = now_ms - req.position_ms
    else:
        state.paused_at = req.position_ms

    state.queue_version += 1
    await db.commit()

    resp = await get_radio_status(channel_id, current_user, db)
    await publish_radio_mqtt(channel_id, resp.model_dump(), [q.model_dump() for q in resp.queue])
    return resp


@router.post("/channels/{channel_id}/radio:skip", response_model=RadioStatusResponse)
async def radio_skip(
    channel_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> RadioStatusResponse:
    channel = await db.get(Channel, channel_id)
    if not channel:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Channel not found")
    await verify_channel_admin(channel, current_user, db)

    state = await db.get(RadioState, channel_id)
    q_stmt = select(RadioQueueItem).where(RadioQueueItem.channel_id == channel_id).order_by(RadioQueueItem.position.asc())
    queue = list((await db.execute(q_stmt)).scalars().all())

    if queue:
        curr_idx = next((i for i, q in enumerate(queue) if q.video_id == state.track_id), -1)
        if state.repeat_mode == "one":
            next_idx = curr_idx if curr_idx >= 0 else 0
        elif state.shuffle and len(queue) > 1:
            choices = [i for i in range(len(queue)) if i != curr_idx]
            next_idx = random.choice(choices)
        else:
            next_idx = (curr_idx + 1) % len(queue)

        next_track = queue[next_idx]
        state.track_id = next_track.video_id
        now_ms = int(time.time() * 1000)
        state.started_at = now_ms
        state.paused_at = None
        state.queue_version += 1
        await db.commit()

    resp = await get_radio_status(channel_id, current_user, db)
    await publish_radio_mqtt(channel_id, resp.model_dump(), [q.model_dump() for q in resp.queue])
    return resp


@router.post("/channels/{channel_id}/radio:previous", response_model=RadioStatusResponse)
async def radio_previous(
    channel_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> RadioStatusResponse:
    channel = await db.get(Channel, channel_id)
    if not channel:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Channel not found")
    await verify_channel_admin(channel, current_user, db)

    state = await db.get(RadioState, channel_id)
    q_stmt = select(RadioQueueItem).where(RadioQueueItem.channel_id == channel_id).order_by(RadioQueueItem.position.asc())
    queue = list((await db.execute(q_stmt)).scalars().all())

    if queue:
        curr_idx = next((i for i, q in enumerate(queue) if q.video_id == state.track_id), 0)
        prev_idx = (curr_idx - 1 + len(queue)) % len(queue)
        prev_track = queue[prev_idx]
        state.track_id = prev_track.video_id
        now_ms = int(time.time() * 1000)
        state.started_at = now_ms
        state.paused_at = None
        state.queue_version += 1
        await db.commit()

    resp = await get_radio_status(channel_id, current_user, db)
    await publish_radio_mqtt(channel_id, resp.model_dump(), [q.model_dump() for q in resp.queue])
    return resp


@router.post("/channels/{channel_id}/radio/queue/items", response_model=RadioStatusResponse)
async def add_queue_item(
    channel_id: str,
    req: AddQueueItemRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> RadioStatusResponse:
    channel = await db.get(Channel, channel_id)
    if not channel:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Channel not found")
    await verify_channel_admin(channel, current_user, db)

    q_stmt = select(RadioQueueItem).where(RadioQueueItem.channel_id == channel_id).order_by(RadioQueueItem.position.desc())
    latest = (await db.execute(q_stmt)).scalars().first()
    new_pos = (latest.position + 1) if latest else 1

    item = RadioQueueItem(
        id=str(ulid.new()),
        channel_id=channel_id,
        position=new_pos,
        video_id=req.video_id,
        title=req.title,
        artist=req.artist,
        duration_ms=req.duration_ms,
        thumb_url=req.thumb_url,
        added_by=current_user.id,
        source=req.source,
    )
    db.add(item)

    state = await db.get(RadioState, channel_id)
    if not state.track_id:
        state.track_id = req.video_id
        if state.status == "playing":
            state.started_at = int(time.time() * 1000)

    state.queue_version += 1
    await db.commit()

    resp = await get_radio_status(channel_id, current_user, db)
    await publish_radio_mqtt(channel_id, resp.model_dump(), [q.model_dump() for q in resp.queue])
    return resp


@router.delete("/channels/{channel_id}/radio/queue/{item_id}", response_model=RadioStatusResponse)
async def remove_queue_item(
    channel_id: str,
    item_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> RadioStatusResponse:
    """Admin removes a track from the channel radio queue."""
    channel = await db.get(Channel, channel_id)
    if not channel:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Channel not found")
    await verify_channel_admin(channel, current_user, db)

    item = await db.get(RadioQueueItem, item_id)
    if not item or item.channel_id != channel_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Queue item not found")

    deleted_video_id = item.video_id
    await db.delete(item)
    await db.flush()

    # Re-normalize positions and handle active track if deleted
    q_stmt = select(RadioQueueItem).where(RadioQueueItem.channel_id == channel_id).order_by(RadioQueueItem.position.asc())
    remaining = list((await db.execute(q_stmt)).scalars().all())
    for idx, rem in enumerate(remaining, start=1):
        rem.position = idx

    state = await db.get(RadioState, channel_id)
    if state and state.track_id == deleted_video_id:
        if remaining:
            state.track_id = remaining[0].video_id
            if state.status == "playing":
                state.started_at = int(time.time() * 1000)
                state.paused_at = None
        else:
            state.track_id = None
            state.status = "stopped"
            state.started_at = None
            state.paused_at = None

    if state:
        state.queue_version += 1
    await db.commit()

    resp = await get_radio_status(channel_id, current_user, db)
    await publish_radio_mqtt(channel_id, resp.model_dump(), [q.model_dump() for q in resp.queue])
    return resp


@router.post("/channels/{channel_id}/radio/queue/{item_id}:play", response_model=RadioStatusResponse)
async def play_queue_item(
    channel_id: str,
    item_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> RadioStatusResponse:
    """Admin jumps directly to play a specific track from the queue."""
    channel = await db.get(Channel, channel_id)
    if not channel:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Channel not found")
    await verify_channel_admin(channel, current_user, db)

    item = await db.get(RadioQueueItem, item_id)
    if not item or item.channel_id != channel_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Queue item not found")

    state = await db.get(RadioState, channel_id)
    if not state:
        state = RadioState(channel_id=channel_id, status="playing", queue_version=1)
        db.add(state)

    now_ms = int(time.time() * 1000)
    state.track_id = item.video_id
    state.status = "playing"
    state.started_at = now_ms
    state.paused_at = None
    state.queue_version += 1

    await db.commit()

    resp = await get_radio_status(channel_id, current_user, db)
    await publish_radio_mqtt(channel_id, resp.model_dump(), [q.model_dump() for q in resp.queue])
    return resp


@router.put("/channels/{channel_id}/radio/queue", response_model=RadioStatusResponse)
async def reorder_queue(
    channel_id: str,
    req: ReorderQueueRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> RadioStatusResponse:
    """Admin reorders the queue using an ordered list of item IDs."""
    channel = await db.get(Channel, channel_id)
    if not channel:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Channel not found")
    await verify_channel_admin(channel, current_user, db)

    q_stmt = select(RadioQueueItem).where(RadioQueueItem.channel_id == channel_id)
    items_by_id = {item.id: item for item in (await db.execute(q_stmt)).scalars().all()}

    pos = 1
    for i_id in req.item_ids:
        if i_id in items_by_id:
            items_by_id[i_id].position = pos
            pos += 1

    for i_id, itm in items_by_id.items():
        if i_id not in req.item_ids:
            itm.position = pos
            pos += 1

    state = await db.get(RadioState, channel_id)
    if state:
        state.queue_version += 1
    await db.commit()

    resp = await get_radio_status(channel_id, current_user, db)
    await publish_radio_mqtt(channel_id, resp.model_dump(), [q.model_dump() for q in resp.queue])
    return resp


@router.post("/channels/{channel_id}/radio/queue/{item_id}:move", response_model=RadioStatusResponse)
async def move_queue_item(
    channel_id: str,
    item_id: str,
    req: MoveQueueItemRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> RadioStatusResponse:
    """Admin moves a single track up or down in the queue."""
    channel = await db.get(Channel, channel_id)
    if not channel:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Channel not found")
    await verify_channel_admin(channel, current_user, db)

    q_stmt = select(RadioQueueItem).where(RadioQueueItem.channel_id == channel_id).order_by(RadioQueueItem.position.asc())
    items = list((await db.execute(q_stmt)).scalars().all())

    curr_idx = next((i for i, itm in enumerate(items) if itm.id == item_id), -1)
    if curr_idx == -1:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Queue item not found")

    target_idx = curr_idx - 1 if req.direction == "up" else curr_idx + 1
    if 0 <= target_idx < len(items):
        items[curr_idx], items[target_idx] = items[target_idx], items[curr_idx]
        for idx, itm in enumerate(items, start=1):
            itm.position = idx

        state = await db.get(RadioState, channel_id)
        if state:
            state.queue_version += 1
        await db.commit()

    resp = await get_radio_status(channel_id, current_user, db)
    await publish_radio_mqtt(channel_id, resp.model_dump(), [q.model_dump() for q in resp.queue])
    return resp


@router.post("/channels/{channel_id}/radio:shuffle", response_model=RadioStatusResponse)
async def radio_shuffle(
    channel_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> RadioStatusResponse:
    """Admin shuffles the radio queue."""
    channel = await db.get(Channel, channel_id)
    if not channel:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Channel not found")
    await verify_channel_admin(channel, current_user, db)

    state = await db.get(RadioState, channel_id)
    if not state:
        state = RadioState(channel_id=channel_id, status="stopped", queue_version=1)
        db.add(state)

    state.shuffle = not state.shuffle

    q_stmt = select(RadioQueueItem).where(RadioQueueItem.channel_id == channel_id).order_by(RadioQueueItem.position.asc())
    items = list((await db.execute(q_stmt)).scalars().all())

    if items and len(items) > 1:
        current_item = next((itm for itm in items if itm.video_id == state.track_id), None)
        other_items = [itm for itm in items if itm != current_item]
        random.shuffle(other_items)
        shuffled = ([current_item] if current_item else []) + other_items
        for idx, itm in enumerate(shuffled, start=1):
            itm.position = idx

    state.queue_version += 1
    await db.commit()

    resp = await get_radio_status(channel_id, current_user, db)
    await publish_radio_mqtt(channel_id, resp.model_dump(), [q.model_dump() for q in resp.queue])
    return resp


@router.post("/channels/{channel_id}/radio:repeat", response_model=RadioStatusResponse)
async def radio_repeat(
    channel_id: str,
    req: RepeatRequest = RepeatRequest(),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> RadioStatusResponse:
    """Admin toggles or sets the loop/repeat mode (off -> all -> one -> off)."""
    channel = await db.get(Channel, channel_id)
    if not channel:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Channel not found")
    await verify_channel_admin(channel, current_user, db)

    state = await db.get(RadioState, channel_id)
    if not state:
        state = RadioState(channel_id=channel_id, status="stopped", queue_version=1)
        db.add(state)

    modes = ["off", "all", "one"]
    if req.mode and req.mode in modes:
        state.repeat_mode = req.mode
    else:
        curr_idx = modes.index(state.repeat_mode) if state.repeat_mode in modes else 0
        state.repeat_mode = modes[(curr_idx + 1) % len(modes)]

    state.queue_version += 1
    await db.commit()

    resp = await get_radio_status(channel_id, current_user, db)
    await publish_radio_mqtt(channel_id, resp.model_dump(), [q.model_dump() for q in resp.queue])
    return resp

    q_stmt = select(RadioQueueItem).where(RadioQueueItem.channel_id == channel_id).order_by(RadioQueueItem.position.desc())
    latest = (await db.execute(q_stmt)).scalars().first()
    new_pos = (latest.position + 1) if latest else 1

    item = RadioQueueItem(
        id=str(ulid.new()),
        channel_id=channel_id,
        position=new_pos,
        video_id=req.video_id,
        title=req.title,
        artist=req.artist,
        duration_ms=req.duration_ms,
        thumb_url=req.thumb_url,
        added_by=current_user.id,
        source=req.source,
    )
    db.add(item)

    state = await db.get(RadioState, channel_id)
    if not state.track_id:
        state.track_id = req.video_id
        if state.status == "playing":
            state.started_at = int(time.time() * 1000)

    state.queue_version += 1
    await db.commit()

    resp = await get_radio_status(channel_id, current_user, db)
    await publish_radio_mqtt(channel_id, resp.model_dump(), [q.model_dump() for q in resp.queue])
    return resp


@router.post("/channels/{channel_id}/radio/report")
async def report_unplayable_track(
    channel_id: str,
    req: AddQueueItemRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    caller_mem = await db.get(ChannelMember, (channel_id, current_user.id))
    if not caller_mem:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Channel not found")

    cache_item = await db.get(TrackCache, req.video_id)
    if cache_item:
        cache_item.is_playable = False
    else:
        db.add(
            TrackCache(
                video_id=req.video_id,
                title=req.title,
                artist=req.artist,
                duration_ms=req.duration_ms,
                thumb_url=req.thumb_url,
                is_playable=False,
                expires_at=datetime.now(UTC) + timedelta(days=1),
            )
        )

    state = await db.get(RadioState, channel_id)
    if state and state.track_id == req.video_id:
        q_stmt = select(RadioQueueItem).where(RadioQueueItem.channel_id == channel_id).order_by(RadioQueueItem.position.asc())
        queue = (await db.execute(q_stmt)).scalars().all()
        if queue:
            curr_idx = next((i for i, q in enumerate(queue) if q.video_id == state.track_id), -1)
            next_idx = (curr_idx + 1) % len(queue)
            state.track_id = queue[next_idx].video_id
            state.started_at = int(time.time() * 1000)
            state.paused_at = None
            state.queue_version += 1

    await db.commit()
    logger.info("Skipped unplayable track %s for channel %s", req.video_id, channel_id)
    return {"status": "ok", "message": "Report logged and track skipped"}


@router.get("/music/search")
async def search_music(
    q: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
    query = q.strip()
    try:
        from ytmusicapi import YTMusic
        yt = YTMusic()
        results = yt.search(query, filter="songs", limit=10)
        tracks = []
        for r in results:
            video_id = r.get("videoId")
            if not video_id:
                continue
            title = r.get("title", "Unknown")
            artists = ", ".join([a.get("name", "") for a in r.get("artists", [])]) or "Artist"
            duration_sec = r.get("duration_seconds", 180)
            thumbnails = r.get("thumbnails", [])
            thumb_url = thumbnails[-1]["url"] if thumbnails else None
            tracks.append({
                "video_id": video_id,
                "title": title,
                "artist": artists,
                "duration_ms": duration_sec * 1000,
                "thumb_url": thumb_url,
                "source": "search",
            })
        if tracks:
            return tracks
    except Exception as e:
        logger.warning("ytmusicapi search error: %s. Returning fallback test tracks.", e)

    return [
        {
            "video_id": "jfKfPfyJRdk",
            "title": f"lofi hip hop radio - {query}",
            "artist": "Lofi Girl",
            "duration_ms": 180000,
            "thumb_url": "https://img.youtube.com/vi/jfKfPfyJRdk/hqdefault.jpg",
            "source": "search",
        },
        {
            "video_id": "5qap5aO4i9A",
            "title": f"Chill Beats for Coding ({query})",
            "artist": "ChilledCow",
            "duration_ms": 210000,
            "thumb_url": "https://img.youtube.com/vi/5qap5aO4i9A/hqdefault.jpg",
            "source": "search",
        },
        {
            "video_id": "DWcJFNfaw9c",
            "title": f"Synthwave / Chillwave - {query}",
            "artist": "Astral Throb",
            "duration_ms": 240000,
            "thumb_url": "https://img.youtube.com/vi/DWcJFNfaw9c/hqdefault.jpg",
            "source": "search",
        },
    ]


# --- Ask LLM Music Curation Endpoint ---

@router.post("/channels/{channel_id}/radio/ask", response_model=AskLlmResponse)
async def ask_llm_curate_music(
    channel_id: str,
    req: AskLlmRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> AskLlmResponse:
    """Channel owner asks LLM to curate YouTube Music search queries for their mood."""
    channel = await db.get(Channel, channel_id)
    if not channel:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Channel not found")
    await verify_channel_admin(channel, current_user, db)

    prompt_text = req.prompt.strip()
    if not prompt_text:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Prompt cannot be empty")

    # Fetch recent track titles from channel queue for LLM context
    stmt = (
        select(RadioQueueItem.title)
        .where(RadioQueueItem.channel_id == channel_id)
        .order_by(RadioQueueItem.position.desc())
        .limit(10)
    )
    recent_titles = list((await db.execute(stmt)).scalars().all())

    # Call Gemini LLM curation
    llm_data = await curate_music_with_llm(
        prompt=prompt_text,
        target_minutes=req.target_minutes,
        current_queue_titles=recent_titles,
    )

    search_queries = llm_data.get("search_queries") or [
        f"{prompt_text} hits",
        f"best {prompt_text}",
        f"{prompt_text} essentials",
    ]
    interpretation = llm_data.get("interpretation") or f"Curated vibe for '{prompt_text}' (~{req.target_minutes} min)"

    # Resolve queries to real songs via search
    curated_tracks = []
    seen_ids = set()

    for q in search_queries:
        sub_results = await search_music(q, current_user, db)
        for trk in sub_results:
            vid = trk.get("video_id")
            if vid and vid not in seen_ids:
                seen_ids.add(vid)
                curated_tracks.append(trk)
                if len(curated_tracks) >= 10:
                    break
        if len(curated_tracks) >= 10:
            break

    # Save to llm_requests table for history
    llm_req = LlmRequest(
        id=str(ulid.new()),
        channel_id=channel_id,
        user_id=current_user.id,
        prompt=prompt_text,
        response_json=json.dumps({"interpretation": interpretation, "queries": search_queries}),
        selected_track_ids=",".join([t["video_id"] for t in curated_tracks]),
    )
    db.add(llm_req)
    await db.commit()

    total_min = sum([t["duration_ms"] for t in curated_tracks]) // 60000

    return AskLlmResponse(
        interpretation=interpretation,
        search_queries=search_queries,
        total_minutes=total_min,
        tracks=curated_tracks,
    )


@router.get("/channels/{channel_id}/posts", response_model=list[ChannelPostResponse])
async def list_channel_posts(
    channel_id: str,
    limit: int = 100,
    before_id: str | None = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[ChannelPostResponse]:
    """Retrieve recent posts from the channel."""
    channel = await db.get(Channel, channel_id)
    if not channel:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Channel not found")
    await get_channel_member(channel_id, current_user.id, db)

    stmt = (
        select(ChannelPost, User.display_name)
        .join(User, ChannelPost.sender_user == User.id, isouter=True)
        .where(
            ChannelPost.channel_id == channel_id,
            ChannelPost.deleted_at.is_(None),
        )
    )
    if before_id:
        stmt = stmt.where(ChannelPost.id < before_id)
    stmt = stmt.order_by(ChannelPost.created_at.desc()).limit(min(limit, 200))

    rows = (await db.execute(stmt)).all()
    results = [
        ChannelPostResponse(
            id=post.id,
            channel_id=post.channel_id,
            sender_user=post.sender_user,
            sender_display_name=display_name,
            sender_device=post.sender_device,
            key_epoch=post.key_epoch,
            ciphertext=post.ciphertext,
            created_at=post.created_at,
            edited_at=post.edited_at,
        )
        for post, display_name in reversed(rows)
    ]
    return results


@router.post("/channels/{channel_id}/posts", response_model=ChannelPostResponse)
async def create_channel_post(
    channel_id: str,
    req: CreatePostRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ChannelPostResponse:
    """Create a new post in the channel and broadcast via MQTT."""
    channel = await db.get(Channel, channel_id)
    if not channel:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Channel not found")
    await get_channel_member(channel_id, current_user.id, db)

    post_id = str(ulid.new())
    post = ChannelPost(
        id=post_id,
        channel_id=channel_id,
        sender_user=current_user.id,
        sender_device=req.sender_device,
        key_epoch=req.key_epoch,
        ciphertext=req.ciphertext,
    )
    db.add(post)
    await db.commit()
    await db.refresh(post)

    resp = ChannelPostResponse(
        id=post.id,
        channel_id=post.channel_id,
        sender_user=post.sender_user,
        sender_display_name=current_user.display_name,
        sender_device=post.sender_device,
        key_epoch=post.key_epoch,
        ciphertext=post.ciphertext,
        created_at=post.created_at,
        edited_at=post.edited_at,
    )

    # Broadcast via Mosquitto
    await publish_post_mqtt(channel_id, {
        "id": resp.id,
        "channel_id": resp.channel_id,
        "sender_user": resp.sender_user,
        "sender_display_name": resp.sender_display_name,
        "sender_device": resp.sender_device,
        "key_epoch": resp.key_epoch,
        "ciphertext": resp.ciphertext,
        "created_at": resp.created_at.isoformat(),
        "edited_at": resp.edited_at.isoformat() if resp.edited_at else None,
    })

    return resp


@router.delete("/channels/{channel_id}/posts/{post_id}")
async def delete_channel_post(
    channel_id: str,
    post_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Soft delete a post if author or channel owner."""
    channel = await db.get(Channel, channel_id)
    if not channel:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Channel not found")
    membership = await get_channel_member(channel_id, current_user.id, db)

    post = await db.get(ChannelPost, post_id)
    if not post or post.channel_id != channel_id or post.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Post not found")

    if post.sender_user != current_user.id and membership.role != "owner" and current_user.role != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cannot delete this post")

    post.deleted_at = datetime.now(UTC)
    await db.commit()

    return {"status": "deleted", "post_id": post_id}

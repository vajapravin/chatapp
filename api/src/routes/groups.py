import secrets
from typing import Annotated, Literal

import ulid
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ..database import get_db
from ..models.db import Group, GroupMember, User
from .users import get_current_user

router = APIRouter(prefix="/v1/groups", tags=["groups"])

MAX_GROUP_MEMBERS = 1024


# Schemas
class CreateGroupRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    description: str | None = None
    avatar_url: str | None = None
    initial_member_ids: list[str] = Field(default_factory=list)
    disappearing_mode: int = 0  # 0=off, 86400=24h, 604800=7d, 7776000=90d


class UpdateGroupRequest(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=100)
    description: str | None = None
    avatar_url: str | None = None
    disappearing_mode: int | None = None


class AddMembersRequest(BaseModel):
    user_ids: list[str] = Field(..., min_length=1)


class UpdateRoleRequest(BaseModel):
    role: Literal["admin", "member"]


class GroupMemberResponse(BaseModel):
    user_id: str
    phone_number: str
    display_name: str | None = None
    avatar_url: str | None = None
    role: str
    joined_at: str


class GroupDetailResponse(BaseModel):
    id: str
    name: str
    description: str | None = None
    avatar_url: str | None = None
    creator_id: str
    invite_token: str
    disappearing_mode: int
    created_at: str
    updated_at: str
    members: list[GroupMemberResponse]
    current_user_role: str


class GroupSummaryResponse(BaseModel):
    id: str
    name: str
    description: str | None = None
    avatar_url: str | None = None
    creator_id: str
    disappearing_mode: int
    member_count: int
    current_user_role: str
    created_at: str
    updated_at: str


class InvitePreviewResponse(BaseModel):
    id: str
    name: str
    description: str | None = None
    avatar_url: str | None = None
    member_count: int


@router.post("", response_model=GroupDetailResponse, status_code=status.HTTP_201_CREATED)
async def create_group(
    req: CreateGroupRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Create a new group with creator as admin and optional initial members."""
    # Deduplicate member ids and exclude creator
    member_ids = list(set(req.initial_member_ids) - {current_user.id})

    if len(member_ids) + 1 > MAX_GROUP_MEMBERS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Groups cannot exceed {MAX_GROUP_MEMBERS} members",
        )

    # Verify initial members exist
    if member_ids:
        users_result = await db.execute(select(User.id).where(User.id.in_(member_ids)))
        valid_user_ids = {u[0] for u in users_result.all()}
    else:
        valid_user_ids = set()

    group_id = str(ulid.new())
    invite_token = secrets.token_urlsafe(32)

    new_group = Group(
        id=group_id,
        name=req.name,
        description=req.description,
        avatar_url=req.avatar_url,
        creator_id=current_user.id,
        invite_token=invite_token,
        disappearing_mode=req.disappearing_mode,
    )
    db.add(new_group)

    # Add creator as admin
    creator_member = GroupMember(
        id=str(ulid.new()),
        group_id=group_id,
        user_id=current_user.id,
        role="admin",
    )
    db.add(creator_member)

    # Add initial members
    for uid in valid_user_ids:
        db.add(
            GroupMember(
                id=str(ulid.new()),
                group_id=group_id,
                user_id=uid,
                role="member",
            )
        )

    await db.commit()

    # Fetch complete group with members and user profiles
    return await get_group_details_internal(group_id, current_user.id, db)


@router.get("", response_model=list[GroupSummaryResponse])
async def list_user_groups(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """List all groups the current user belongs to."""
    stmt = (
        select(Group, GroupMember.role)
        .join(GroupMember, GroupMember.group_id == Group.id)
        .where(GroupMember.user_id == current_user.id)
        .order_by(Group.updated_at.desc())
    )
    results = await db.execute(stmt)
    rows = results.all()

    response = []
    for group, user_role in rows:
        # Count members
        count_stmt = select(func.count(GroupMember.id)).where(GroupMember.group_id == group.id)
        count_res = await db.execute(count_stmt)
        count = count_res.scalar() or 0

        response.append(
            GroupSummaryResponse(
                id=group.id,
                name=group.name,
                description=group.description,
                avatar_url=group.avatar_url,
                creator_id=group.creator_id,
                disappearing_mode=group.disappearing_mode,
                member_count=count,
                current_user_role=user_role,
                created_at=group.created_at.isoformat(),
                updated_at=group.updated_at.isoformat(),
            )
        )

    return response


@router.get("/invite/{invite_token}", response_model=InvitePreviewResponse)
async def get_invite_preview(
    invite_token: str,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Preview a group before joining via invite token."""
    group_stmt = select(Group).where(Group.invite_token == invite_token)
    res = await db.execute(group_stmt)
    group = res.scalar_one_or_none()
    if not group:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Invite link invalid or expired")

    count_stmt = select(func.count(GroupMember.id)).where(GroupMember.group_id == group.id)
    count_res = await db.execute(count_stmt)
    count = count_res.scalar() or 0

    return InvitePreviewResponse(
        id=group.id,
        name=group.name,
        description=group.description,
        avatar_url=group.avatar_url,
        member_count=count,
    )


@router.post("/invite/{invite_token}/join", response_model=GroupDetailResponse)
async def join_group_via_invite(
    invite_token: str,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Join a group using an invite token."""
    group_stmt = select(Group).where(Group.invite_token == invite_token)
    res = await db.execute(group_stmt)
    group = res.scalar_one_or_none()
    if not group:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Invite link invalid or expired")

    # Check if already a member
    existing_stmt = select(GroupMember).where(
        GroupMember.group_id == group.id, GroupMember.user_id == current_user.id
    )
    existing_res = await db.execute(existing_stmt)
    if existing_res.scalar_one_or_none():
        return await get_group_details_internal(group.id, current_user.id, db)

    # Check member limit
    count_stmt = select(func.count(GroupMember.id)).where(GroupMember.group_id == group.id)
    count_res = await db.execute(count_stmt)
    count = count_res.scalar() or 0
    if count >= MAX_GROUP_MEMBERS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Group has reached maximum capacity of {MAX_GROUP_MEMBERS} members",
        )

    # Add member
    new_member = GroupMember(
        id=str(ulid.new()),
        group_id=group.id,
        user_id=current_user.id,
        role="member",
    )
    db.add(new_member)
    await db.commit()

    return await get_group_details_internal(group.id, current_user.id, db)


@router.get("/{group_id}", response_model=GroupDetailResponse)
async def get_group(
    group_id: str,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Get group details and members list."""
    return await get_group_details_internal(group_id, current_user.id, db)


@router.patch("/{group_id}", response_model=GroupDetailResponse)
async def update_group(
    group_id: str,
    req: UpdateGroupRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Update group metadata (Admin only)."""
    membership = await verify_admin(group_id, current_user.id, db)
    group = membership.group

    if req.name is not None:
        group.name = req.name
    if req.description is not None:
        group.description = req.description
    if req.avatar_url is not None:
        group.avatar_url = req.avatar_url
    if req.disappearing_mode is not None:
        group.disappearing_mode = req.disappearing_mode

    await db.commit()
    return await get_group_details_internal(group_id, current_user.id, db)


@router.post("/{group_id}/members", response_model=GroupDetailResponse)
async def add_members(
    group_id: str,
    req: AddMembersRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Add new members to the group (Admin only)."""
    await verify_admin(group_id, current_user.id, db)

    # Current member count
    count_stmt = select(func.count(GroupMember.id)).where(GroupMember.group_id == group_id)
    count_res = await db.execute(count_stmt)
    current_count = count_res.scalar() or 0

    # Filter out users already in group
    existing_members_stmt = select(GroupMember.user_id).where(GroupMember.group_id == group_id)
    existing_res = await db.execute(existing_members_stmt)
    existing_user_ids = {r[0] for r in existing_res.all()}

    new_user_ids = [uid for uid in set(req.user_ids) if uid not in existing_user_ids]

    if current_count + len(new_user_ids) > MAX_GROUP_MEMBERS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Adding {len(new_user_ids)} members exceeds the {MAX_GROUP_MEMBERS} member limit",
        )

    # Verify users exist
    valid_stmt = select(User.id).where(User.id.in_(new_user_ids))
    valid_res = await db.execute(valid_stmt)
    valid_ids = {r[0] for r in valid_res.all()}

    for uid in valid_ids:
        db.add(
            GroupMember(
                id=str(ulid.new()),
                group_id=group_id,
                user_id=uid,
                role="member",
            )
        )

    await db.commit()
    return await get_group_details_internal(group_id, current_user.id, db)


@router.delete("/{group_id}/members/{target_user_id}")
async def remove_member(
    group_id: str,
    target_user_id: str,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Remove a member from the group (Admin) or leave the group (Self)."""
    is_self = target_user_id == current_user.id

    # If removing someone else, must be admin
    if not is_self:
        await verify_admin(group_id, current_user.id, db)

    # Check target is a member
    member_stmt = select(GroupMember).where(
        GroupMember.group_id == group_id, GroupMember.user_id == target_user_id
    )
    res = await db.execute(member_stmt)
    member = res.scalar_one_or_none()
    if not member:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User is not a member of this group")

    await db.delete(member)
    await db.commit()

    # Check if any members remain
    count_stmt = select(func.count(GroupMember.id)).where(GroupMember.group_id == group_id)
    count_res = await db.execute(count_stmt)
    if (count_res.scalar() or 0) == 0:
        group_stmt = select(Group).where(Group.id == group_id)
        g_res = await db.execute(group_stmt)
        group = g_res.scalar_one_or_none()
        if group:
            await db.delete(group)
            await db.commit()

    return {"result": "ok"}


@router.patch("/{group_id}/members/{target_user_id}/role")
async def update_member_role(
    group_id: str,
    target_user_id: str,
    req: UpdateRoleRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Promote or demote a member's role (Admin only)."""
    await verify_admin(group_id, current_user.id, db)

    member_stmt = select(GroupMember).where(
        GroupMember.group_id == group_id, GroupMember.user_id == target_user_id
    )
    res = await db.execute(member_stmt)
    member = res.scalar_one_or_none()
    if not member:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User is not a member of this group")

    member.role = req.role
    await db.commit()
    return {"result": "ok", "role": req.role}


# Helper functions
async def verify_admin(group_id: str, user_id: str, db: AsyncSession) -> GroupMember:
    stmt = (
        select(GroupMember)
        .options(selectinload(GroupMember.group))
        .where(GroupMember.group_id == group_id, GroupMember.user_id == user_id)
    )
    res = await db.execute(stmt)
    member = res.scalar_one_or_none()
    if not member:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You are not a member of this group")
    if member.role != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin permissions required")
    return member


async def get_group_details_internal(group_id: str, user_id: str, db: AsyncSession) -> GroupDetailResponse:
    # Verify caller membership
    member_stmt = select(GroupMember).where(
        GroupMember.group_id == group_id, GroupMember.user_id == user_id
    )
    member_res = await db.execute(member_stmt)
    caller_membership = member_res.scalar_one_or_none()
    if not caller_membership:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You are not a member of this group")

    # Fetch group
    group_stmt = select(Group).where(Group.id == group_id)
    group_res = await db.execute(group_stmt)
    group = group_res.scalar_one_or_none()
    if not group:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Group not found")

    # Fetch all members with users
    members_stmt = (
        select(GroupMember, User)
        .join(User, User.id == GroupMember.user_id)
        .where(GroupMember.group_id == group_id)
        .order_by(GroupMember.joined_at.asc())
    )
    members_res = await db.execute(members_stmt)
    member_rows = members_res.all()

    members_list = [
        GroupMemberResponse(
            user_id=gm.user_id,
            phone_number=u.phone_number,
            display_name=u.display_name,
            avatar_url=u.avatar_url,
            role=gm.role,
            joined_at=gm.joined_at.isoformat(),
        )
        for gm, u in member_rows
    ]

    return GroupDetailResponse(
        id=group.id,
        name=group.name,
        description=group.description,
        avatar_url=group.avatar_url,
        creator_id=group.creator_id,
        invite_token=group.invite_token,
        disappearing_mode=group.disappearing_mode,
        created_at=group.created_at.isoformat(),
        updated_at=group.updated_at.isoformat(),
        members=members_list,
        current_user_role=caller_membership.role,
    )

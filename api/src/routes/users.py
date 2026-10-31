import jwt
from chatapp_shared.auth import decode_access_token
from chatapp_shared.models import UserResponse
from fastapi import APIRouter, Depends, Header, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import settings
from ..database import get_db
from ..models.db import User

router = APIRouter(prefix="/v1/users", tags=["Users"])


async def get_current_user(
    authorization: str | None = Header(default=None),
    db: AsyncSession = Depends(get_db),
) -> User:
    """Extract and validate bearer token, returning the authenticated user."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing or invalid Authorization header",
        )

    token = authorization.split(" ")[1]
    try:
        payload = decode_access_token(
            token,
            secret_key=settings.JWT_SECRET_KEY,
            algorithms=[settings.JWT_ALGORITHM],
        )
        user_id = payload.get("sub")
        if not user_id:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Token missing subject claim",
            )
    except jwt.PyJWTError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid token: {e}",
        )

    stmt = select(User).where(User.id == user_id)
    result = await db.execute(stmt)
    user = result.scalar_one_or_none()

    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )

    return user


@router.get("/me", response_model=UserResponse)
async def get_my_profile(
    current_user: User = Depends(get_current_user),
) -> UserResponse:
    """Return the authenticated user's profile."""
    return UserResponse.model_validate(current_user)


@router.get("/lookup", response_model=UserResponse)
async def lookup_user(
    phone: str,
    _: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> UserResponse:
    """Look up a user profile by exact phone number."""
    clean_phone = phone.strip()
    if not clean_phone.startswith("+"):
        clean_phone = "+" + clean_phone
    stmt = select(User).where(User.phone_number == clean_phone)
    result = await db.execute(stmt)
    user = result.scalar_one_or_none()

    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )

    return UserResponse.model_validate(user)


@router.get("/search", response_model=list[UserResponse])
async def search_users(
    q: str = "",
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[UserResponse]:
    """Search users by phone number or display name."""
    clean_q = q.strip()
    pattern = f"%{clean_q}%"
    stmt = (
        select(User)
        .where(
            (User.id != current_user.id)
            & (
                User.phone_number.ilike(pattern)
                | User.display_name.ilike(pattern)
            )
        )
        .limit(20)
    )
    result = await db.execute(stmt)
    return [UserResponse.model_validate(u) for u in result.scalars().all()]


@router.get("/{user_id}", response_model=UserResponse)
async def get_user_by_id(
    user_id: str,
    _: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> UserResponse:
    """Look up a user profile by user ID."""
    stmt = select(User).where(User.id == user_id)
    result = await db.execute(stmt)
    user = result.scalar_one_or_none()

    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )

    return UserResponse.model_validate(user)

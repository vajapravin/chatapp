from datetime import datetime

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ..database import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(26), primary_key=True)  # ULID
    phone_number: Mapped[str] = mapped_column(String(32), unique=True, index=True, nullable=False)
    email: Mapped[str | None] = mapped_column(String(255), index=True, nullable=True)
    display_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    avatar_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    role: Mapped[str] = mapped_column(String(20), default="user", nullable=False)
    is_banned: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    devices: Mapped[list["Device"]] = relationship("Device", back_populates="user", cascade="all, delete-orphan")
    refresh_tokens: Mapped[list["RefreshToken"]] = relationship(
        "RefreshToken", back_populates="user", cascade="all, delete-orphan"
    )


class Device(Base):
    __tablename__ = "devices"

    id: Mapped[str] = mapped_column(String(26), primary_key=True)  # ULID
    user_id: Mapped[str] = mapped_column(
        String(26), ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    device_id: Mapped[int] = mapped_column(Integer, nullable=False)  # 1: primary, 2-4: linked
    device_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    public_identity_key: Mapped[str | None] = mapped_column(Text, nullable=True)
    last_active_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    user: Mapped["User"] = relationship("User", back_populates="devices")
    refresh_tokens: Mapped[list["RefreshToken"]] = relationship(
        "RefreshToken", back_populates="device", cascade="all, delete-orphan"
    )

    __table_args__ = (
        UniqueConstraint("user_id", "device_id", name="uq_user_device"),
    )


class RefreshToken(Base):
    __tablename__ = "refresh_tokens"

    id: Mapped[str] = mapped_column(String(26), primary_key=True)  # ULID
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True, nullable=False)
    user_id: Mapped[str] = mapped_column(
        String(26), ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    device_id: Mapped[str] = mapped_column(
        String(26), ForeignKey("devices.id", ondelete="CASCADE"), index=True, nullable=False
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    revoked: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    user: Mapped["User"] = relationship("User", back_populates="refresh_tokens")
    device: Mapped["Device"] = relationship("Device", back_populates="refresh_tokens")


class IdentityKey(Base):
    __tablename__ = "identity_keys"

    id: Mapped[str] = mapped_column(String(26), primary_key=True)
    user_id: Mapped[str] = mapped_column(
        String(26), ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    device_id: Mapped[int] = mapped_column(Integer, nullable=False)
    public_key: Mapped[str] = mapped_column(Text, nullable=False)  # Base64
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        UniqueConstraint("user_id", "device_id", name="uq_identity_user_device"),
    )


class SignedPrekey(Base):
    __tablename__ = "signed_prekeys"

    id: Mapped[str] = mapped_column(String(26), primary_key=True)
    user_id: Mapped[str] = mapped_column(
        String(26), ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    device_id: Mapped[int] = mapped_column(Integer, nullable=False)
    key_id: Mapped[int] = mapped_column(Integer, nullable=False)
    public_key: Mapped[str] = mapped_column(Text, nullable=False)  # Base64
    signature: Mapped[str] = mapped_column(Text, nullable=False)  # Base64
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        UniqueConstraint("user_id", "device_id", "key_id", name="uq_signed_prekey_user_device_key"),
    )


class OneTimePrekey(Base):
    __tablename__ = "one_time_prekeys"

    id: Mapped[str] = mapped_column(String(26), primary_key=True)
    user_id: Mapped[str] = mapped_column(
        String(26), ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    device_id: Mapped[int] = mapped_column(Integer, nullable=False)
    key_id: Mapped[int] = mapped_column(Integer, nullable=False)
    public_key: Mapped[str] = mapped_column(Text, nullable=False)  # Base64
    consumed: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        UniqueConstraint("user_id", "device_id", "key_id", name="uq_one_time_prekey_user_device_key"),
    )


class EnvelopeModel(Base):
    __tablename__ = "envelopes"

    id: Mapped[str] = mapped_column(String(26), primary_key=True)  # ULID
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    sender_user: Mapped[str] = mapped_column(String(26), index=True, nullable=False)
    sender_device: Mapped[int] = mapped_column(Integer, nullable=False)
    recipient_user: Mapped[str] = mapped_column(String(26), index=True, nullable=False)
    recipient_device: Mapped[int] = mapped_column(Integer, nullable=False)
    group_id: Mapped[str | None] = mapped_column(String(26), index=True, nullable=True)
    type: Mapped[int] = mapped_column(Integer, nullable=False)
    ciphertext: Mapped[str] = mapped_column(Text, nullable=False)  # Base64 encoded payload
    timestamp: Mapped[int] = mapped_column(Integer, nullable=False)
    delivered: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    acked: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class PushSubscription(Base):
    __tablename__ = "push_subscriptions"

    id: Mapped[str] = mapped_column(String(26), primary_key=True)
    user_id: Mapped[str] = mapped_column(
        String(26), ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    device_id: Mapped[int] = mapped_column(Integer, nullable=False)
    endpoint: Mapped[str] = mapped_column(Text, nullable=False)
    p256dh: Mapped[str] = mapped_column(Text, nullable=False)
    auth: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        UniqueConstraint("user_id", "device_id", name="uq_push_user_device"),
    )


class Group(Base):
    __tablename__ = "groups"

    id: Mapped[str] = mapped_column(String(26), primary_key=True)  # ULID
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    avatar_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    creator_id: Mapped[str] = mapped_column(
        String(26), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    invite_token: Mapped[str] = mapped_column(String(64), unique=True, index=True, nullable=False)
    disappearing_mode: Mapped[int] = mapped_column(Integer, default=0, nullable=False)  # 0=off, 86400=24h, etc.
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    creator: Mapped["User"] = relationship("User", foreign_keys=[creator_id])
    members: Mapped[list["GroupMember"]] = relationship(
        "GroupMember", back_populates="group", cascade="all, delete-orphan"
    )


class GroupMember(Base):
    __tablename__ = "group_members"

    id: Mapped[str] = mapped_column(String(26), primary_key=True)  # ULID
    group_id: Mapped[str] = mapped_column(
        String(26), ForeignKey("groups.id", ondelete="CASCADE"), index=True, nullable=False
    )
    user_id: Mapped[str] = mapped_column(
        String(26), ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    role: Mapped[str] = mapped_column(String(20), default="member", nullable=False)  # 'admin' | 'member'
    joined_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    group: Mapped["Group"] = relationship("Group", back_populates="members")
    user: Mapped["User"] = relationship("User")

    __table_args__ = (
        UniqueConstraint("group_id", "user_id", name="uq_group_user"),
    )


class PrivacySetting(Base):
    __tablename__ = "privacy_settings"

    user_id: Mapped[str] = mapped_column(
        String(26), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    last_seen: Mapped[str] = mapped_column(String(20), default="everyone", nullable=False)
    online: Mapped[str] = mapped_column(String(20), default="everyone", nullable=False)
    profile_photo: Mapped[str] = mapped_column(String(20), default="everyone", nullable=False)
    about: Mapped[str] = mapped_column(String(20), default="everyone", nullable=False)
    read_receipts: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    add_to_groups: Mapped[str] = mapped_column(String(20), default="everyone", nullable=False)
    silence_unknown_callers: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    user: Mapped["User"] = relationship("User")


class BlockedUser(Base):
    __tablename__ = "blocked_users"

    id: Mapped[str] = mapped_column(String(26), primary_key=True)  # ULID
    user_id: Mapped[str] = mapped_column(
        String(26), ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    blocked_user_id: Mapped[str] = mapped_column(
        String(26), ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    user: Mapped["User"] = relationship("User", foreign_keys=[user_id])
    blocked_user: Mapped["User"] = relationship("User", foreign_keys=[blocked_user_id])

    __table_args__ = (
        UniqueConstraint("user_id", "blocked_user_id", name="uq_blocked_user"),
    )


class Report(Base):
    __tablename__ = "reports"

    id: Mapped[str] = mapped_column(String(26), primary_key=True)  # ULID
    reporter_id: Mapped[str] = mapped_column(
        String(26), ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    reported_user_id: Mapped[str] = mapped_column(
        String(26), ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    reason: Mapped[str] = mapped_column(String(50), nullable=False)
    encrypted_evidence: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="pending", nullable=False)  # pending, resolved, dismissed
    admin_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    reporter: Mapped["User"] = relationship("User", foreign_keys=[reporter_id])
    reported_user: Mapped["User"] = relationship("User", foreign_keys=[reported_user_id])


class TwoStepVerification(Base):
    __tablename__ = "two_step_verifications"

    user_id: Mapped[str] = mapped_column(
        String(26), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    pin_hash: Mapped[str] = mapped_column(Text, nullable=False)
    salt: Mapped[str] = mapped_column(String(64), nullable=False)
    recovery_email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    user: Mapped["User"] = relationship("User")


class WebAuthnCredential(Base):
    __tablename__ = "webauthn_credentials"

    id: Mapped[str] = mapped_column(String(255), primary_key=True)  # Credential ID base64url
    user_id: Mapped[str] = mapped_column(
        String(26), ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    public_key: Mapped[str] = mapped_column(Text, nullable=False)  # Base64url encoded
    sign_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    transports: Mapped[str | None] = mapped_column(Text, nullable=True)  # JSON array string
    name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    user: Mapped["User"] = relationship("User")


class LinkedDeviceChallenge(Base):
    __tablename__ = "linked_device_challenges"

    id: Mapped[str] = mapped_column(String(26), primary_key=True)  # ULID
    link_code: Mapped[str] = mapped_column(String(64), unique=True, index=True, nullable=False)
    user_id: Mapped[str | None] = mapped_column(
        String(26), ForeignKey("users.id", ondelete="CASCADE"), nullable=True
    )
    status: Mapped[str] = mapped_column(String(20), default="pending", nullable=False)  # pending, authorized, consumed, expired
    device_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    auth_token: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class BackupMetadata(Base):
    __tablename__ = "backup_metadata"

    id: Mapped[str] = mapped_column(String(26), primary_key=True)  # ULID
    user_id: Mapped[str] = mapped_column(
        String(26), ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    storage_provider: Mapped[str] = mapped_column(String(20), default="s3", nullable=False)
    backup_key: Mapped[str] = mapped_column(Text, nullable=False)
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    salt: Mapped[str] = mapped_column(String(64), nullable=False)
    iv: Mapped[str] = mapped_column(String(64), nullable=False)
    sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    user: Mapped["User"] = relationship("User")


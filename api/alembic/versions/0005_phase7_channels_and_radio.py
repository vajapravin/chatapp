"""Phase 7: Invite-only access, channels, and radio

Revision ID: 0005_phase7_channels_and_radio
Revises: 0004_privacy_and_security
Create Date: 2026-11-01 21:55:00.000000

"""
from collections.abc import Sequence
from alembic import op
import sqlalchemy as sa

revision: str = "0005_phase7_channels_and_radio"
down_revision: str | None = "0004_privacy_and_security"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # 1. Alter users table: make phone_number nullable, add status, unique index on email
    op.alter_column("users", "phone_number", nullable=True)
    op.add_column("users", sa.Column("status", sa.String(length=20), server_default="active", nullable=False))
    # Create unique index on email where email is not null
    op.create_index("uq_users_email", "users", ["email"], unique=True, postgresql_where=sa.text("email IS NOT NULL"))

    # 2. invites table
    op.create_table(
        "invites",
        sa.Column("id", sa.String(length=26), nullable=False),
        sa.Column("email", sa.String(length=255), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("role", sa.String(length=20), server_default="user", nullable=False),
        sa.Column("invited_by", sa.String(length=26), nullable=True),
        sa.Column("status", sa.String(length=20), server_default="pending", nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("accepted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["invited_by"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("token_hash", name="uq_invites_token_hash"),
    )
    op.create_index("ix_invites_email", "invites", ["email"])
    op.create_index("ix_invites_status", "invites", ["status"])

    # 3. audit_events table
    op.create_table(
        "audit_events",
        sa.Column("id", sa.String(length=26), nullable=False),
        sa.Column("actor_id", sa.String(length=26), nullable=True),
        sa.Column("action", sa.String(length=50), nullable=False),
        sa.Column("target_type", sa.String(length=50), nullable=False),
        sa.Column("target_id", sa.String(length=26), nullable=True),
        sa.Column("details", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_audit_events_action", "audit_events", ["action"])
    op.create_index("ix_audit_events_actor", "audit_events", ["actor_id"])

    # 4. channels table
    op.create_table(
        "channels",
        sa.Column("id", sa.String(length=26), nullable=False),
        sa.Column("owner_id", sa.String(length=26), nullable=False),
        sa.Column("name", sa.String(length=48), nullable=False),
        sa.Column("topic", sa.String(length=160), nullable=True),
        sa.Column("icon_ref", sa.Text(), nullable=True),
        sa.Column("radio_enabled", sa.Boolean(), server_default="true", nullable=False),
        sa.Column("members_can_invite", sa.Boolean(), server_default="false", nullable=False),
        sa.Column("history_handover", sa.Boolean(), server_default="false", nullable=False),
        sa.Column("retention_days", sa.Integer(), nullable=True),
        sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["owner_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_channels_owner_id", "channels", ["owner_id"])

    # 5. channel_members table
    op.create_table(
        "channel_members",
        sa.Column("channel_id", sa.String(length=26), nullable=False),
        sa.Column("user_id", sa.String(length=26), nullable=False),
        sa.Column("role", sa.String(length=20), server_default="member", nullable=False),
        sa.Column("joined_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("last_read_post_id", sa.String(length=26), nullable=True),
        sa.ForeignKeyConstraint(["channel_id"], ["channels.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("channel_id", "user_id"),
    )

    # 6. channel_invites table
    op.create_table(
        "channel_invites",
        sa.Column("id", sa.String(length=26), nullable=False),
        sa.Column("channel_id", sa.String(length=26), nullable=False),
        sa.Column("invitee_id", sa.String(length=26), nullable=False),
        sa.Column("invited_by", sa.String(length=26), nullable=False),
        sa.Column("status", sa.String(length=20), server_default="pending", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["channel_id"], ["channels.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["invitee_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["invited_by"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_channel_invites_channel_id", "channel_invites", ["channel_id"])
    op.create_index("ix_channel_invites_invitee_id", "channel_invites", ["invitee_id"])

    # 7. channel_posts table
    op.create_table(
        "channel_posts",
        sa.Column("id", sa.String(length=26), nullable=False),
        sa.Column("channel_id", sa.String(length=26), nullable=False),
        sa.Column("sender_user", sa.String(length=26), nullable=False),
        sa.Column("sender_device", sa.Integer(), nullable=False),
        sa.Column("key_epoch", sa.Integer(), server_default="1", nullable=False),
        sa.Column("ciphertext", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("edited_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["channel_id"], ["channels.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["sender_user"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_channel_posts_channel_id", "channel_posts", ["channel_id"])
    op.create_index("ix_channel_posts_created_at", "channel_posts", ["created_at"])

    # 8. radio_state table
    op.create_table(
        "radio_state",
        sa.Column("channel_id", sa.String(length=26), nullable=False),
        sa.Column("status", sa.String(length=20), server_default="stopped", nullable=False),
        sa.Column("track_id", sa.String(length=64), nullable=True),
        sa.Column("started_at", sa.BigInteger(), nullable=True),
        sa.Column("paused_at", sa.BigInteger(), nullable=True),
        sa.Column("repeat_mode", sa.String(length=10), server_default="off", nullable=False),
        sa.Column("shuffle", sa.Boolean(), server_default="false", nullable=False),
        sa.Column("queue_version", sa.Integer(), server_default="1", nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["channel_id"], ["channels.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("channel_id"),
    )

    # 9. radio_queue table
    op.create_table(
        "radio_queue",
        sa.Column("id", sa.String(length=26), nullable=False),
        sa.Column("channel_id", sa.String(length=26), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("video_id", sa.String(length=64), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("artist", sa.String(length=255), nullable=False),
        sa.Column("duration_ms", sa.Integer(), nullable=False),
        sa.Column("thumb_url", sa.Text(), nullable=True),
        sa.Column("added_by", sa.String(length=26), nullable=True),
        sa.Column("source", sa.String(length=32), server_default="search", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["channel_id"], ["channels.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["added_by"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_radio_queue_channel_id", "radio_queue", ["channel_id"])
    op.create_index("ix_radio_queue_position", "radio_queue", ["channel_id", "position"])

    # 10. radio_playlists table
    op.create_table(
        "radio_playlists",
        sa.Column("id", sa.String(length=26), nullable=False),
        sa.Column("channel_id", sa.String(length=26), nullable=False),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("tracks_json", sa.Text(), nullable=False),
        sa.Column("created_by", sa.String(length=26), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["channel_id"], ["channels.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_radio_playlists_channel_id", "radio_playlists", ["channel_id"])

    # 11. llm_requests table
    op.create_table(
        "llm_requests",
        sa.Column("id", sa.String(length=26), nullable=False),
        sa.Column("channel_id", sa.String(length=26), nullable=False),
        sa.Column("user_id", sa.String(length=26), nullable=False),
        sa.Column("prompt", sa.Text(), nullable=False),
        sa.Column("response_json", sa.Text(), nullable=False),
        sa.Column("selected_track_ids", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["channel_id"], ["channels.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_llm_requests_channel_id", "llm_requests", ["channel_id"])

    # 12. track_cache table
    op.create_table(
        "track_cache",
        sa.Column("video_id", sa.String(length=64), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("artist", sa.String(length=255), nullable=False),
        sa.Column("duration_ms", sa.Integer(), nullable=False),
        sa.Column("thumb_url", sa.Text(), nullable=True),
        sa.Column("is_playable", sa.Boolean(), server_default="true", nullable=False),
        sa.Column("cached_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("video_id"),
    )


def downgrade() -> None:
    op.drop_table("track_cache")
    op.drop_table("llm_requests")
    op.drop_table("radio_playlists")
    op.drop_table("radio_queue")
    op.drop_table("radio_state")
    op.drop_table("channel_posts")
    op.drop_table("channel_invites")
    op.drop_table("channel_members")
    op.drop_table("channels")
    op.drop_table("audit_events")
    op.drop_table("invites")
    op.drop_index("uq_users_email", table_name="users")
    op.drop_column("users", "status")
    op.alter_column("users", "phone_number", nullable=False)

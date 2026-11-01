"""Privacy settings, blocks, reports, two-step verification, passkeys, linked devices, and backups

Revision ID: 0004_privacy_and_security
Revises: 0003_groups_and_rich_messages
Create Date: 2026-11-01 00:48:00.000000

"""
from collections.abc import Sequence
from alembic import op
import sqlalchemy as sa

revision: str = "0004_privacy_and_security"
down_revision: str | None = "0003_groups_and_rich_messages"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # 1. Add role and is_banned to users table
    op.add_column("users", sa.Column("role", sa.String(length=20), server_default="user", nullable=False))
    op.add_column("users", sa.Column("is_banned", sa.Boolean(), server_default="false", nullable=False))

    # 2. privacy_settings
    op.create_table(
        "privacy_settings",
        sa.Column("user_id", sa.String(length=26), nullable=False),
        sa.Column("last_seen", sa.String(length=20), server_default="everyone", nullable=False),
        sa.Column("online", sa.String(length=20), server_default="everyone", nullable=False),
        sa.Column("profile_photo", sa.String(length=20), server_default="everyone", nullable=False),
        sa.Column("about", sa.String(length=20), server_default="everyone", nullable=False),
        sa.Column("read_receipts", sa.Boolean(), server_default="true", nullable=False),
        sa.Column("add_to_groups", sa.String(length=20), server_default="everyone", nullable=False),
        sa.Column("silence_unknown_callers", sa.Boolean(), server_default="false", nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("user_id"),
    )

    # 3. blocked_users
    op.create_table(
        "blocked_users",
        sa.Column("id", sa.String(length=26), nullable=False),
        sa.Column("user_id", sa.String(length=26), nullable=False),
        sa.Column("blocked_user_id", sa.String(length=26), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["blocked_user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "blocked_user_id", name="uq_blocked_user"),
    )
    op.create_index(op.f("ix_blocked_users_user_id"), "blocked_users", ["user_id"], unique=False)
    op.create_index(op.f("ix_blocked_users_blocked_user_id"), "blocked_users", ["blocked_user_id"], unique=False)

    # 4. reports
    op.create_table(
        "reports",
        sa.Column("id", sa.String(length=26), nullable=False),
        sa.Column("reporter_id", sa.String(length=26), nullable=False),
        sa.Column("reported_user_id", sa.String(length=26), nullable=False),
        sa.Column("reason", sa.String(length=50), nullable=False),
        sa.Column("encrypted_evidence", sa.Text(), nullable=False),
        sa.Column("status", sa.String(length=20), server_default="pending", nullable=False),
        sa.Column("admin_notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["reporter_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["reported_user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_reports_reporter_id"), "reports", ["reporter_id"], unique=False)
    op.create_index(op.f("ix_reports_reported_user_id"), "reports", ["reported_user_id"], unique=False)

    # 5. two_step_verifications
    op.create_table(
        "two_step_verifications",
        sa.Column("user_id", sa.String(length=26), nullable=False),
        sa.Column("pin_hash", sa.Text(), nullable=False),
        sa.Column("salt", sa.String(length=64), nullable=False),
        sa.Column("recovery_email", sa.String(length=255), nullable=True),
        sa.Column("enabled", sa.Boolean(), server_default="true", nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("user_id"),
    )

    # 6. webauthn_credentials
    op.create_table(
        "webauthn_credentials",
        sa.Column("id", sa.String(length=255), nullable=False),
        sa.Column("user_id", sa.String(length=26), nullable=False),
        sa.Column("public_key", sa.Text(), nullable=False),
        sa.Column("sign_count", sa.Integer(), server_default="0", nullable=False),
        sa.Column("transports", sa.Text(), nullable=True),
        sa.Column("name", sa.String(length=100), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_webauthn_credentials_user_id"), "webauthn_credentials", ["user_id"], unique=False)

    # 7. linked_device_challenges
    op.create_table(
        "linked_device_challenges",
        sa.Column("id", sa.String(length=26), nullable=False),
        sa.Column("link_code", sa.String(length=64), nullable=False),
        sa.Column("user_id", sa.String(length=26), nullable=True),
        sa.Column("status", sa.String(length=20), server_default="pending", nullable=False),
        sa.Column("device_id", sa.Integer(), nullable=True),
        sa.Column("auth_token", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_linked_device_challenges_link_code"), "linked_device_challenges", ["link_code"], unique=True)

    # 8. backup_metadata
    op.create_table(
        "backup_metadata",
        sa.Column("id", sa.String(length=26), nullable=False),
        sa.Column("user_id", sa.String(length=26), nullable=False),
        sa.Column("storage_provider", sa.String(length=20), server_default="s3", nullable=False),
        sa.Column("backup_key", sa.Text(), nullable=False),
        sa.Column("size_bytes", sa.Integer(), nullable=False),
        sa.Column("salt", sa.String(length=64), nullable=False),
        sa.Column("iv", sa.String(length=64), nullable=False),
        sa.Column("sha256", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_backup_metadata_user_id"), "backup_metadata", ["user_id"], unique=False)


def downgrade() -> None:
    op.drop_table("backup_metadata")
    op.drop_table("linked_device_challenges")
    op.drop_table("webauthn_credentials")
    op.drop_table("two_step_verifications")
    op.drop_table("reports")
    op.drop_table("blocked_users")
    op.drop_table("privacy_settings")
    op.drop_column("users", "is_banned")
    op.drop_column("users", "role")

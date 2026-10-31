"""Signal keys, envelopes, and push subscriptions

Revision ID: 0002_signal_keys_and_envelopes
Revises: 0001_initial_schema
Create Date: 2026-10-31 20:50:00.000000

"""
from collections.abc import Sequence
from alembic import op
import sqlalchemy as sa

revision: str = "0002_signal_keys_and_envelopes"
down_revision: str | None = "0001_initial_schema"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # identity_keys
    op.create_table(
        "identity_keys",
        sa.Column("id", sa.String(length=26), nullable=False),
        sa.Column("user_id", sa.String(length=26), nullable=False),
        sa.Column("device_id", sa.Integer(), nullable=False),
        sa.Column("public_key", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "device_id", name="uq_identity_user_device"),
    )
    op.create_index(op.f("ix_identity_keys_user_id"), "identity_keys", ["user_id"], unique=False)

    # signed_prekeys
    op.create_table(
        "signed_prekeys",
        sa.Column("id", sa.String(length=26), nullable=False),
        sa.Column("user_id", sa.String(length=26), nullable=False),
        sa.Column("device_id", sa.Integer(), nullable=False),
        sa.Column("key_id", sa.Integer(), nullable=False),
        sa.Column("public_key", sa.Text(), nullable=False),
        sa.Column("signature", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "device_id", "key_id", name="uq_signed_prekey_user_device_key"),
    )
    op.create_index(op.f("ix_signed_prekeys_user_id"), "signed_prekeys", ["user_id"], unique=False)

    # one_time_prekeys
    op.create_table(
        "one_time_prekeys",
        sa.Column("id", sa.String(length=26), nullable=False),
        sa.Column("user_id", sa.String(length=26), nullable=False),
        sa.Column("device_id", sa.Integer(), nullable=False),
        sa.Column("key_id", sa.Integer(), nullable=False),
        sa.Column("public_key", sa.Text(), nullable=False),
        sa.Column("consumed", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "device_id", "key_id", name="uq_one_time_prekey_user_device_key"),
    )
    op.create_index(op.f("ix_one_time_prekeys_user_id"), "one_time_prekeys", ["user_id"], unique=False)
    op.create_index(op.f("ix_one_time_prekeys_consumed"), "one_time_prekeys", ["consumed"], unique=False)

    # envelopes
    op.create_table(
        "envelopes",
        sa.Column("id", sa.String(length=26), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False, server_default=sa.text("1")),
        sa.Column("sender_user", sa.String(length=26), nullable=False),
        sa.Column("sender_device", sa.Integer(), nullable=False),
        sa.Column("recipient_user", sa.String(length=26), nullable=False),
        sa.Column("recipient_device", sa.Integer(), nullable=False),
        sa.Column("type", sa.Integer(), nullable=False),
        sa.Column("ciphertext", sa.Text(), nullable=False),
        sa.Column("timestamp", sa.BigInteger(), nullable=False),
        sa.Column("delivered", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("acked", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_envelopes_sender_user"), "envelopes", ["sender_user"], unique=False)
    op.create_index(op.f("ix_envelopes_recipient_user"), "envelopes", ["recipient_user"], unique=False)
    op.create_index(op.f("ix_envelopes_acked"), "envelopes", ["acked"], unique=False)

    # push_subscriptions
    op.create_table(
        "push_subscriptions",
        sa.Column("id", sa.String(length=26), nullable=False),
        sa.Column("user_id", sa.String(length=26), nullable=False),
        sa.Column("device_id", sa.Integer(), nullable=False),
        sa.Column("endpoint", sa.Text(), nullable=False),
        sa.Column("p256dh", sa.Text(), nullable=False),
        sa.Column("auth", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "device_id", name="uq_push_user_device"),
    )
    op.create_index(op.f("ix_push_subscriptions_user_id"), "push_subscriptions", ["user_id"], unique=False)


def downgrade() -> None:
    op.drop_table("push_subscriptions")
    op.drop_table("envelopes")
    op.drop_table("one_time_prekeys")
    op.drop_table("signed_prekeys")
    op.drop_table("identity_keys")

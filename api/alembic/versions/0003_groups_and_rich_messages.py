"""Groups, group memberships, and envelope group routing

Revision ID: 0003_groups_and_rich_messages
Revises: 0002_signal_keys_and_envelopes
Create Date: 2026-10-31 23:10:00.000000

"""
from collections.abc import Sequence
from alembic import op
import sqlalchemy as sa

revision: str = "0003_groups_and_rich_messages"
down_revision: str | None = "0002_signal_keys_and_envelopes"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # groups
    op.create_table(
        "groups",
        sa.Column("id", sa.String(length=26), nullable=False),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("avatar_url", sa.Text(), nullable=True),
        sa.Column("creator_id", sa.String(length=26), nullable=False),
        sa.Column("invite_token", sa.String(length=64), nullable=False),
        sa.Column("disappearing_mode", sa.Integer(), server_default="0", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["creator_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_groups_invite_token"), "groups", ["invite_token"], unique=True)
    op.create_index(op.f("ix_groups_creator_id"), "groups", ["creator_id"], unique=False)

    # group_members
    op.create_table(
        "group_members",
        sa.Column("id", sa.String(length=26), nullable=False),
        sa.Column("group_id", sa.String(length=26), nullable=False),
        sa.Column("user_id", sa.String(length=26), nullable=False),
        sa.Column("role", sa.String(length=20), server_default="member", nullable=False),
        sa.Column("joined_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["group_id"], ["groups.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("group_id", "user_id", name="uq_group_user"),
    )
    op.create_index(op.f("ix_group_members_group_id"), "group_members", ["group_id"], unique=False)
    op.create_index(op.f("ix_group_members_user_id"), "group_members", ["user_id"], unique=False)

    # Add group_id to envelopes
    op.add_column("envelopes", sa.Column("group_id", sa.String(length=26), nullable=True))
    op.create_index(op.f("ix_envelopes_group_id"), "envelopes", ["group_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_envelopes_group_id"), table_name="envelopes")
    op.drop_column("envelopes", "group_id")

    op.drop_index(op.f("ix_group_members_user_id"), table_name="group_members")
    op.drop_index(op.f("ix_group_members_group_id"), table_name="group_members")
    op.drop_table("group_members")

    op.drop_index(op.f("ix_groups_creator_id"), table_name="groups")
    op.drop_index(op.f("ix_groups_invite_token"), table_name="groups")
    op.drop_table("groups")

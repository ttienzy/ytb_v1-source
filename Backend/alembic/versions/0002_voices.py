"""create voices table

Revision ID: 0002_voices
Revises: 0001_empty
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0002_voices"
down_revision: Union[str, Sequence[str], None] = "0001_empty"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "voices",
        sa.Column("voice_id", sa.String(length=64), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("ref_path", sa.String(length=512), nullable=True),
        sa.Column("tags", sa.JSON(), nullable=False, server_default="{}"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("voice_id"),
    )


def downgrade() -> None:
    op.drop_table("voices")

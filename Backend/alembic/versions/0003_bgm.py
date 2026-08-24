"""create bgm_tracks table

Revision ID: 0003_bgm
Revises: 0002_voices
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0003_bgm"
down_revision: Union[str, Sequence[str], None] = "0002_voices"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "bgm_tracks",
        sa.Column("track_id", sa.String(length=64), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("file_path", sa.String(length=512), nullable=False),
        sa.Column("needs_attribution", sa.Boolean(), nullable=False, server_default=sa.text("0")),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("duration_sec", sa.Float(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("track_id"),
    )


def downgrade() -> None:
    op.drop_table("bgm_tracks")

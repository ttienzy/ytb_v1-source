"""create watermarks table

Revision ID: 0004_watermark
Revises: 0003_bgm
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0004_watermark"
down_revision: Union[str, Sequence[str], None] = "0003_bgm"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "watermarks",
        sa.Column("wm_id", sa.String(length=64), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("wm_id"),
    )


def downgrade() -> None:
    op.drop_table("watermarks")

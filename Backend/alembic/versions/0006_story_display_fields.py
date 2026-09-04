"""add story display fields for following and source update time

Revision ID: 0006_story_display_fields
Revises: 0005_stories
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "0006_story_display_fields"
down_revision: Union[str, Sequence[str], None] = "0005_stories"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    columns = {column["name"] for column in inspector.get_columns("crawled_stories")}
    if "team_name" not in columns:
        op.add_column("crawled_stories", sa.Column("team_name", sa.String(length=255), nullable=True))
    if "following" not in columns:
        op.add_column("crawled_stories", sa.Column("following", sa.Integer(), nullable=True))
    if "source_updated_at" not in columns:
        op.add_column("crawled_stories", sa.Column("source_updated_at", sa.String(length=100), nullable=True))


def downgrade() -> None:
    op.drop_column("crawled_stories", "source_updated_at")
    op.drop_column("crawled_stories", "following")
    op.drop_column("crawled_stories", "team_name")

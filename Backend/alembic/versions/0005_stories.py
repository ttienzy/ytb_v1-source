"""create crawled stories and chapters tables

Revision ID: 0005_stories
Revises: 0004_watermark
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0005_stories"
down_revision: Union[str, Sequence[str], None] = "0004_watermark"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if not inspector.has_table("crawled_stories"):
        op.create_table(
            "crawled_stories",
            sa.Column("story_slug", sa.String(length=255), nullable=False),
            sa.Column("source_id", sa.Integer(), nullable=True),
            sa.Column("name", sa.String(length=500), nullable=False),
            sa.Column("author_name", sa.String(length=255), nullable=True),
            sa.Column("team_name", sa.String(length=255), nullable=True),
            sa.Column("image", sa.String(length=1000), nullable=True),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("total_chapter", sa.Integer(), nullable=True),
            sa.Column("total_view", sa.Integer(), nullable=True),
            sa.Column("following", sa.Integer(), nullable=True),
            sa.Column("source_updated_at", sa.String(length=100), nullable=True),
            sa.Column("raw_metadata", sa.JSON(), nullable=False, server_default="{}"),
            sa.Column("categories", sa.JSON(), nullable=False, server_default="[]"),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.PrimaryKeyConstraint("story_slug"),
        )
    if not any(index["name"] == "ix_crawled_stories_source_id" for index in inspector.get_indexes("crawled_stories")):
        op.create_index("ix_crawled_stories_source_id", "crawled_stories", ["source_id"])
    if not inspector.has_table("crawled_chapters"):
        op.create_table(
            "crawled_chapters",
            sa.Column("chapter_key", sa.String(length=320), nullable=False),
            sa.Column("story_slug", sa.String(length=255), nullable=False),
            sa.Column("source_id", sa.Integer(), nullable=True),
            sa.Column("chapter_number", sa.Integer(), nullable=False),
            sa.Column("title", sa.String(length=500), nullable=False),
            sa.Column("paragraph", sa.Text(), nullable=False),
            sa.Column("source_updated_at", sa.String(length=100), nullable=True),
            sa.Column("crawled_at", sa.DateTime(timezone=True), nullable=False),
            sa.PrimaryKeyConstraint("chapter_key"),
        )
    chapter_indexes = {index["name"] for index in inspector.get_indexes("crawled_chapters")}
    if "ix_crawled_chapters_story_slug" not in chapter_indexes:
        op.create_index("ix_crawled_chapters_story_slug", "crawled_chapters", ["story_slug"])
    if "ix_crawled_chapters_chapter_number" not in chapter_indexes:
        op.create_index("ix_crawled_chapters_chapter_number", "crawled_chapters", ["chapter_number"])


def downgrade() -> None:
    op.drop_index("ix_crawled_chapters_chapter_number", table_name="crawled_chapters")
    op.drop_index("ix_crawled_chapters_story_slug", table_name="crawled_chapters")
    op.drop_table("crawled_chapters")
    op.drop_index("ix_crawled_stories_source_id", table_name="crawled_stories")
    op.drop_table("crawled_stories")

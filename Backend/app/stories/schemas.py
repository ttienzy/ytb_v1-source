from pydantic import BaseModel, Field


class CrawlRequest(BaseModel):
    chapter_number: int | None = Field(default=None, ge=1)


class BulkCrawlRequest(BaseModel):
    category_ids: list[int] = Field(min_length=1, max_length=100)
    recrawl_full: bool = False

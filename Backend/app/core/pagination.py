from typing import TypeVar


LIBRARY_PAGE_SIZE = 50
T = TypeVar("T")


def page_window(page: int, total: int) -> tuple[int, int]:
    last = max(1, (total + LIBRARY_PAGE_SIZE - 1) // LIBRARY_PAGE_SIZE)
    current = min(max(1, page), last)
    return current, (current - 1) * LIBRARY_PAGE_SIZE


def paginate_items(items: list[T], page: int) -> dict:
    current, start = page_window(page, len(items))
    return {"items": items[start:start + LIBRARY_PAGE_SIZE], "total": len(items), "page": current, "page_size": LIBRARY_PAGE_SIZE}

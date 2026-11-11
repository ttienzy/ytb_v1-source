"""ChatGPT (reverse-gpt) làm provider tạo ảnh #2 — thay thế tuỳ chọn cho Leonardo Image Bot.

`GptImageClient` khớp interface ImageBotClient (generate/download/set_progress) nên drop-in vào film_project.
Chi tiết: adapter.py. Nguồn pkg: github.com/lamvbg/reverse-gpt (MIT).
"""
from .adapter import GptImageClient, GptImageError

__all__ = ["GptImageClient", "GptImageError"]

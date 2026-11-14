"""Ảnh cho video truyện audio: tải/cache ảnh bìa nguồn, dựng khung nền bố cục "ảnh bìa + phụ đề" và thumbnail.

Dựng bằng Pillow MỘT lần cho mỗi truyện/khổ (ảnh tĩnh); phần chuyển động (phụ đề, nhãn chương, lời nhắc đăng ký, logo, waveform)
do ffmpeg phủ lên sau — xem layouts.py.
"""
from __future__ import annotations

import hashlib
import io
import textwrap
from pathlib import Path

from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont, ImageOps

from app.media.fonts import find_font

SOURCE_SITE = "https://daotruyen.me"  # ảnh bìa crawl lưu dạng đường dẫn tương đối "/img/stories/…"
COVER_TIMEOUT_SEC = 20
COVER_MAX_BYTES = 15 * 1024 * 1024

SIZES = {"16:9": (1920, 1080), "9:16": (1080, 1920)}
THUMB_SIZES = {"16:9": (1280, 720), "9:16": (1080, 1920)}
YELLOW = (255, 214, 0)
WHITE = (255, 255, 255)
BLACK = (0, 0, 0)
ACCENT = (225, 29, 72)


# ── Ảnh bìa nguồn ────────────────────────────────────────────────────────────

def cover_url(image: str | None) -> str | None:
    image = (image or "").strip()
    if not image:
        return None
    return image if image.startswith(("http://", "https://")) else f"{SOURCE_SITE}{image if image.startswith('/') else '/' + image}"


def cached_cover(cover_dir: Path, story_slug: str) -> Path | None:
    for path in cover_dir.glob(f"{_safe(story_slug)}.*"):
        if path.is_file() and path.stat().st_size:
            return path
    return None


class CoverError(RuntimeError):
    pass


def download_cover(cover_dir: Path, story_slug: str, image: str | None, attempts: int = 2) -> Path:
    """Ảnh bìa nguồn của truyện (tải một lần rồi dùng lại). Lỗi → CoverError có lý do (để báo cho người dùng)."""
    cached = cached_cover(cover_dir, story_slug)
    if cached:
        return cached
    url = cover_url(image)
    if not url:
        raise CoverError("truyện không có ảnh bìa nguồn")
    import httpx  # nạp muộn: module này còn dùng trong test không cần mạng

    last = ""
    for _ in range(attempts):  # GET ảnh tĩnh: thử lại an toàn
        try:
            response = httpx.get(url, timeout=COVER_TIMEOUT_SEC, follow_redirects=True, headers={"User-Agent": "Mozilla/5.0", "Referer": SOURCE_SITE + "/"})
            response.raise_for_status()
            data = response.content
            if not data or len(data) > COVER_MAX_BYTES:
                raise CoverError(f"ảnh bìa rỗng hoặc quá lớn ({len(data)} byte)")
            with Image.open(io.BytesIO(data)) as probe:
                probe.verify()
                fmt = (probe.format or "PNG").lower()
            break
        except CoverError:
            raise
        except Exception as error:  # noqa: BLE001
            last = f"{type(error).__name__}: {error}"
    else:
        raise CoverError(f"không tải được ảnh bìa nguồn ({last})")
    cover_dir.mkdir(parents=True, exist_ok=True)
    path = cover_dir / f"{_safe(story_slug)}.{'jpg' if fmt == 'jpeg' else fmt}"
    path.write_bytes(data)
    return path


def fetch_cover(cover_dir: Path, story_slug: str, image: str | None) -> Path | None:
    """Như download_cover nhưng lỗi → None (dùng cho endpoint xem ảnh)."""
    try:
        return download_cover(cover_dir, story_slug, image)
    except CoverError:
        return None


def _safe(value: str) -> str:
    keep = "".join(c if c.isalnum() or c in "-_" else "_" for c in value).strip("_")
    return keep[:80] or hashlib.sha1(value.encode()).hexdigest()[:12]


# ── Dựng ảnh ─────────────────────────────────────────────────────────────────

def _font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    path = find_font()
    return ImageFont.truetype(str(path), size) if path else ImageFont.load_default(size)


def _open_rgb(path: Path) -> Image.Image:
    with Image.open(path) as image:
        image = ImageOps.exif_transpose(image)
        return image.convert("RGB")


def _backdrop(cover: Image.Image, size: tuple[int, int], brightness: float = 0.5) -> Image.Image:
    """Nền: chính ảnh bìa phóng kín khung, làm mờ mạnh và tối đi."""
    small = ImageOps.fit(cover, (max(1, size[0] // 4), max(1, size[1] // 4)), Image.Resampling.LANCZOS)
    blurred = small.filter(ImageFilter.GaussianBlur(10)).resize(size, Image.Resampling.BICUBIC)
    return ImageEnhance.Brightness(blurred).enhance(brightness)


def _card(cover: Image.Image, box: tuple[int, int], radius: int) -> tuple[Image.Image, Image.Image]:
    """Ảnh bìa vừa trong `box` (giữ tỉ lệ) + mặt nạ bo góc."""
    card = ImageOps.contain(cover, box, Image.Resampling.LANCZOS)
    mask = Image.new("L", card.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, card.size[0] - 1, card.size[1] - 1), radius=radius, fill=255)
    return card, mask


def _paste_card(canvas: Image.Image, card: Image.Image, mask: Image.Image, xy: tuple[int, int], radius: int) -> None:
    """Dán thẻ ảnh có bóng đổ mềm + viền sáng mảnh."""
    x, y = xy
    shadow = Image.new("L", (card.size[0] + 80, card.size[1] + 80), 0)
    ImageDraw.Draw(shadow).rounded_rectangle((40, 50, 40 + card.size[0], 50 + card.size[1]), radius=radius, fill=170)
    shadow = shadow.filter(ImageFilter.GaussianBlur(22))
    canvas.paste(Image.new("RGB", shadow.size, BLACK), (x - 40, y - 40), shadow)
    canvas.paste(card, (x, y), mask)
    ImageDraw.Draw(canvas).rounded_rectangle((x, y, x + card.size[0] - 1, y + card.size[1] - 1), radius=radius, outline=(255, 255, 255), width=3)


def _wrap_fit(draw: ImageDraw.ImageDraw, text: str, max_w: int, max_lines: int, size_max: int, size_min: int, max_h: int | None = None):
    """Cỡ chữ lớn nhất để `text` vừa `max_w` (và cao ≤ max_h) trong ≤ max_lines dòng. Trả (font, lines)."""
    for size in range(size_max, size_min - 1, -4):
        font = _font(size)
        avg = max(1.0, draw.textlength("ABCDEFGHIKLMNOPQRSTUVXY", font=font) / 23)
        lines = textwrap.wrap(text, width=max(4, int(max_w / avg)), break_long_words=False) or [text]
        fits_height = not max_h or int(size * 1.12) * len(lines) <= max_h
        if len(lines) <= max_lines and fits_height and all(draw.textlength(line, font=font) <= max_w for line in lines):
            return font, lines
    font = _font(size_min)
    lines = textwrap.wrap(text, width=max(4, int(max_w / max(1.0, draw.textlength("M", font=font)))), break_long_words=True)[:max_lines]
    return font, lines


def _draw_lines(draw: ImageDraw.ImageDraw, lines: list[str], font, *, x: int, y: int, align: str, max_w: int,
                colors: list[tuple[int, int, int]], stroke: int, spacing: float = 1.12) -> int:
    """Vẽ các dòng (căn trái/giữa trong vùng rộng max_w), trả y kết thúc."""
    line_h = int(font.size * spacing)
    for index, line in enumerate(lines):
        width = draw.textlength(line, font=font)
        lx = x + (max_w - width) / 2 if align == "center" else x
        draw.text((lx, y), line, font=font, fill=colors[min(index, len(colors) - 1)], stroke_width=stroke, stroke_fill=BLACK)
        y += line_h
    return y


def _pill(draw: ImageDraw.ImageDraw, xy: tuple[int, int], text: str, size: int, fill, color=WHITE, anchor_right: bool = False) -> None:
    font = _font(size)
    pad_x, pad_y = int(size * 0.55), int(size * 0.32)
    width = int(draw.textlength(text, font=font))
    x, y = xy
    if anchor_right:
        x -= width + 2 * pad_x
    draw.rounded_rectangle((x, y, x + width + 2 * pad_x, y + size + 2 * pad_y), radius=int(size * 0.5), fill=fill)
    draw.text((x + pad_x, y + pad_y - int(size * 0.12)), text, font=font, fill=color)


def placeholder_cover(dest: Path) -> Path:
    """Ảnh bìa thay thế khi truyện không có ảnh (hoặc chạy thử bằng text): nền chuyển màu tối, dựng một lần."""
    if dest.is_file() and dest.stat().st_size:
        return dest
    w, h = 900, 1200
    top, bottom = (58, 38, 92), (14, 18, 38)
    image = Image.new("RGB", (w, h))
    draw = ImageDraw.Draw(image)
    for y in range(h):
        k = y / (h - 1)
        draw.line([(0, y), (w, y)], fill=tuple(int(a + (b - a) * k) for a, b in zip(top, bottom)))
    font = _font(110)
    text = "AUDIO"
    draw.text(((w - draw.textlength(text, font=font)) / 2, h * 0.42), text, font=font, fill=(255, 255, 255))
    dest.parent.mkdir(parents=True, exist_ok=True)
    image.save(dest, "PNG")
    return dest


def frame_layout(aspect: str) -> dict:
    """Vị trí các vùng của bố cục ảnh bìa (dùng chung cho Pillow và ASS để nhãn/phụ đề không đè lên ảnh)."""
    w, h = SIZES[aspect]
    if aspect == "16:9":
        card_box = (int(w * 0.34), int(h * 0.70))
        # Cột trái: tên truyện (y 0.10–0.56H) rồi nhãn "Chương N" (0.66H); giữa: thẻ ảnh bìa; phải: lời nhắc đăng ký; dưới: phụ đề.
        return {"size": (w, h), "card_box": card_box, "card_top": int(h * 0.06), "title_box": (int(w * 0.05), int(h * 0.10), int(w * 0.27)),
                "title_max_h": int(h * 0.46), "label_pos": (int(w * 0.185), int(h * 0.66)), "cta_pos": (int(w * 0.835), int(h * 0.42)),
                "sub_margin_v": int(h * 0.055), "sub_size": int(h * 0.050), "label_size": int(h * 0.044)}
    card_box = (int(w * 0.84), int(h * 0.47))
    return {"size": (w, h), "card_box": card_box, "card_top": int(h * 0.17), "title_box": (int(w * 0.07), int(h * 0.045), int(w * 0.86)),
            "title_max_h": int(h * 0.11), "label_pos": (w // 2, int(h * 0.675)), "cta_pos": (w // 2, int(h * 0.93)), "sub_margin_v": int(h * 0.19),
            "sub_size": int(h * 0.032), "label_size": int(h * 0.026)}


def compose_frame(cover_path: Path, aspect: str, title: str, dest: Path, *, brightness: float = 0.5) -> Path:
    """Khung nền tĩnh của video: nền mờ + thẻ ảnh bìa + tên truyện. Nhãn chương/phụ đề/CTA do ffmpeg phủ sau."""
    layout = frame_layout(aspect)
    w, h = layout["size"]
    cover = _open_rgb(cover_path)
    canvas = _backdrop(cover, (w, h), brightness)
    radius = int(min(w, h) * 0.022)
    card, mask = _card(cover, layout["card_box"], radius)
    _paste_card(canvas, card, mask, ((w - card.size[0]) // 2, layout["card_top"]), radius)
    draw = ImageDraw.Draw(canvas)
    x, y, max_w = layout["title_box"]
    max_h = layout["title_max_h"]
    if aspect == "16:9":
        font, lines = _wrap_fit(draw, title.upper(), max_w, 6, int(h * 0.075), int(h * 0.032), max_h=max_h)
    else:
        font, lines = _wrap_fit(draw, title.upper(), max_w, 2, int(h * 0.040), int(h * 0.022), max_h=max_h)
    block_h = int(font.size * 1.12) * len(lines)
    _draw_lines(draw, lines, font, x=x, y=y + max(0, (max_h - block_h) // 2), align="center", max_w=max_w, colors=[YELLOW, WHITE],
                stroke=max(3, font.size // 14))
    dest.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(dest, "PNG")
    return dest


def compose_thumbnail(cover_path: Path, aspect: str, title: str, badge: str | None, dest: Path) -> Path:
    """Thumbnail kiểu kênh truyện audio: ảnh bìa + chữ tên/hook rất to (2 màu, viền đen) + nhãn AUDIO và FULL/TẬP/CHƯƠNG."""
    w, h = THUMB_SIZES[aspect]
    cover = _open_rgb(cover_path)
    canvas = _backdrop(cover, (w, h), 0.42)
    draw = ImageDraw.Draw(canvas)
    radius = int(min(w, h) * 0.03)
    text = title.upper()
    if aspect == "16:9":
        card, mask = _card(cover, (int(w * 0.40), int(h * 0.86)), radius)
        _paste_card(canvas, card, mask, (int(w * 0.04), (h - card.size[1]) // 2), radius)
        left = int(w * 0.04) + card.size[0] + int(w * 0.04)
        max_w = w - left - int(w * 0.04)
        top, bottom = int(h * 0.16), int(h * 0.84)  # chừa chỗ nhãn AUDIO (trên) và FULL/TẬP (dưới)
        font, lines = _wrap_fit(draw, text, max_w, 5, int(h * 0.15), int(h * 0.07), max_h=bottom - top)
        block_h = int(font.size * 1.12) * len(lines)
        _draw_lines(draw, lines, font, x=left, y=top + max(0, (bottom - top - block_h) // 2), align="left", max_w=max_w,
                    colors=[YELLOW, YELLOW, WHITE] if len(lines) > 3 else [YELLOW, WHITE], stroke=max(4, font.size // 11))
        _pill(draw, (w - int(w * 0.03), int(h * 0.05)), "AUDIO", int(h * 0.05), ACCENT, anchor_right=True)
        if badge:
            _pill(draw, (w - int(w * 0.03), h - int(h * 0.13)), badge.upper(), int(h * 0.055), YELLOW, color=BLACK, anchor_right=True)
    else:
        card, mask = _card(cover, (int(w * 0.86), int(h * 0.52)), radius)
        _paste_card(canvas, card, mask, ((w - card.size[0]) // 2, int(h * 0.08)), radius)
        top = int(h * 0.08) + card.size[1] + int(h * 0.04)
        font, lines = _wrap_fit(draw, text, int(w * 0.90), 4, int(h * 0.065), int(h * 0.032))
        _draw_lines(draw, lines, font, x=int(w * 0.05), y=top, align="center", max_w=int(w * 0.90), colors=[YELLOW, WHITE], stroke=max(4, font.size // 11))
        _pill(draw, (int(w * 0.05), int(h * 0.025)), "AUDIO", int(h * 0.028), ACCENT)
        if badge:
            _pill(draw, (w - int(w * 0.05), int(h * 0.025)), badge.upper(), int(h * 0.028), YELLOW, color=BLACK, anchor_right=True)
    dest.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(dest, "JPEG", quality=90)
    return dest

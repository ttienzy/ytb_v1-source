"""Văn bản truyện → các dòng để đọc + phụ đề (hàm thuần, không I/O).

Truyện crawl đã xuống dòng theo câu/đoạn; mỗi dòng là MỘT lượt TTS → voice-service trả thời lượng từng dòng → phụ đề khớp giọng
mà không cần nhận dạng giọng nói (đo 2026-11-14: đọc theo dòng tốn đúng bằng thời gian đọc cả khối).
"""
from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass

# Tốc độ đọc đo được với giọng VieNeu turbo (ký tự / giây, đã gồm khoảng nghỉ giữa dòng) — chỉ dùng để ƯỚC LƯỢNG.
CHARS_PER_SECOND = 17.9
LINE_GAP_SEC = 0.4        # lặng giữa hai dòng
CHAPTER_GAP_SEC = 1.2     # lặng giữa hai chương trong video cả truyện
SUBTITLE_MAX_CHARS = 84   # một cue phụ đề tối đa ~2 dòng chữ

_BARE_NUMBER = re.compile(r"^(?:chương|chuong|phần|phan)?\s*\d+\s*[.:\-–—]?\s*$", re.IGNORECASE)
_HAS_WORD = re.compile(r"[^\W_]", re.UNICODE)
_QUOTES = str.maketrans({"“": '"', "”": '"', "„": '"', "‘": "'", "’": "'", " ": " "})


def clean_name(name: str) -> str:
    """Tên truyện để hiển thị/đặt tên file: bỏ khoảng trắng thừa (dữ liệu crawl có tên bắt đầu bằng dấu cách)."""
    return re.sub(r"\s+", " ", unicodedata.normalize("NFC", name or "")).strip()


def spoken_name(name: str) -> str:
    """Tên truyện để ĐỌC: tên crawl hay viết hoa toàn bộ — đưa về dạng câu cho tự nhiên."""
    name = clean_name(name)
    return name[:1].upper() + name[1:].lower() if name.isupper() else name


def clean_lines(text: str) -> list[str]:
    """Các dòng sẽ đọc của một chương.

    - bỏ dòng chỉ có số chương ở ĐẦU chương ("1", "Chương 3") — không thì giọng đọc "Một" mở đầu video;
    - bỏ dòng không có chữ/số (dấu phân cách "***", "---");
    - chuẩn hóa NFC, ngoặc kép cong → thẳng, gộp khoảng trắng.
    """
    lines = []
    for raw in unicodedata.normalize("NFC", text or "").splitlines():
        line = re.sub(r"\s+", " ", raw.translate(_QUOTES)).strip()
        if line and _HAS_WORD.search(line):
            lines.append(line)
    while lines and _BARE_NUMBER.match(lines[0]):
        lines.pop(0)
    return lines


def estimate_seconds(chars: int) -> float:
    return chars / CHARS_PER_SECOND if chars > 0 else 0.0


@dataclass(frozen=True)
class Cue:
    start: float
    end: float
    text: str


def _split_for_display(text: str, max_chars: int) -> list[str]:
    """Cắt một dòng dài thành các mẩu ≤ max_chars, ưu tiên ranh giới câu rồi dấu phẩy rồi khoảng trắng."""
    if len(text) <= max_chars:
        return [text]
    pieces = [p for p in re.split(r"(?<=[.!?…])\s+", text) if p]
    if len(pieces) == 1:
        pieces = [p for p in re.split(r"(?<=[,;:])\s+", text) if p]
    out: list[str] = []
    for piece in pieces:
        while len(piece) > max_chars:
            cut = piece.rfind(" ", 0, max_chars)
            cut = cut if cut > max_chars // 3 else max_chars
            out.append(piece[:cut].strip())
            piece = piece[cut:].strip()
        if piece:
            out.append(piece)
    merged: list[str] = []
    for piece in out:  # gộp lại các mẩu ngắn liền nhau nếu vẫn vừa
        if merged and len(merged[-1]) + 1 + len(piece) <= max_chars:
            merged[-1] = f"{merged[-1]} {piece}"
        else:
            merged.append(piece)
    return merged


def build_cues(lines: list[str], durations: list[float], *, offset: float = 0.0, gap: float = LINE_GAP_SEC,
               speed: float = 1.0, max_chars: int = SUBTITLE_MAX_CHARS) -> tuple[list[Cue], float]:
    """Mốc phụ đề cho các dòng đã đọc liền nhau (mỗi dòng + `gap` giây lặng).

    Dòng dài được tách thành nhiều cue, chia thời lượng theo số ký tự. `speed` (atempo) co giãn mọi mốc.
    Trả (cues, thời điểm kết thúc = offset + tổng độ dài kể cả các khoảng lặng)."""
    if len(lines) != len(durations):
        raise ValueError(f"Số dòng ({len(lines)}) khác số thời lượng ({len(durations)}).")
    scale = 1.0 / speed if speed > 0 else 1.0
    cues: list[Cue] = []
    t = offset
    for index, (line, duration) in enumerate(zip(lines, durations)):
        length = max(0.0, duration) * scale
        pieces = _split_for_display(line, max_chars)
        total_chars = sum(len(p) for p in pieces) or 1
        start = t
        for piece in pieces:
            end = start + length * len(piece) / total_chars
            cues.append(Cue(round(start, 3), round(end, 3), piece))
            start = end
        t += length + (gap * scale if index < len(lines) - 1 else 0.0)
    return cues, t


def _ass_time(seconds: float) -> str:
    cs = max(0, round(seconds * 100))
    h, rest = divmod(cs, 360000)
    m, rest = divmod(rest, 6000)
    s, cs = divmod(rest, 100)
    return f"{h}:{m:02d}:{s:02d}.{cs:02d}"


def _ass_escape(text: str) -> str:
    return text.replace("\\", "\\\\").replace("{", "(").replace("}", ")").replace("\n", " ")


ASS_FONT = "Be Vietnam Pro ExtraBold"  # tên ĐẦY ĐỦ của resources/fonts/BeVietnamPro-ExtraBold.ttf; chỉ "Be Vietnam Pro" thì libass rơi về Arial


@dataclass(frozen=True)
class AssStyle:
    name: str
    size: int
    alignment: int = 2          # bàn phím số: 2 = giữa dưới, 5 = chính giữa
    margin_v: int = 40
    margin_h: int = 0
    primary: str = "&H00FFFFFF"  # &HAABBGGRR
    outline: str = "&H00000000"
    back: str = "&H64000000"
    outline_px: float = 3
    shadow_px: float = 1
    border_style: int = 1       # 1 = viền + bóng, 3 = hộp nền


def ass_event(start: float, end: float, style: str, text: str, *, prefix: str = "", layer: int = 0) -> str:
    """Một dòng Dialogue; `prefix` là thẻ override ASS (vd "{\\an5\\pos(x,y)\\fad(300,300)}") — không bị escape."""
    return f"Dialogue: {layer},{_ass_time(start)},{_ass_time(end)},{style},,0,0,0,,{prefix}{_ass_escape(text)}\n"


def to_ass(width: int, height: int, styles: list[AssStyle], events: list[str], font_name: str = ASS_FONT) -> str:
    """File ASS (libass) từ các kiểu chữ + sự kiện đã dựng sẵn."""
    lines = [
        "[Script Info]", "ScriptType: v4.00+", "WrapStyle: 0", "ScaledBorderAndShadow: yes",
        f"PlayResX: {width}", f"PlayResY: {height}", "",
        "[V4+ Styles]",
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, "
        "StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    ]
    for s in styles:
        margin_h = s.margin_h or int(width * 0.08)
        lines.append(f"Style: {s.name},{font_name},{s.size},{s.primary},&H000000FF,{s.outline},{s.back},0,0,0,0,100,100,0,0,"
                     f"{s.border_style},{s.outline_px:g},{s.shadow_px:g},{s.alignment},{margin_h},{margin_h},{s.margin_v},1")
    lines += ["", "[Events]", "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text"]
    return "\n".join(lines) + "\n" + "".join(events)


def subtitle_events(cues: list[Cue], style: str = "Sub") -> list[str]:
    return [ass_event(c.start, c.end, style, c.text) for c in cues]


def cta_events(duration: float, text: str, *, style: str = "Cta", pos: tuple[int, int], first: float = 20.0,
               every: float = 150.0, show: float = 7.0) -> list[str]:
    """Lời nhắc đăng ký/thích hiện lặp lại (mờ vào/ra), không hiện sát cuối video."""
    events = []
    t = first
    while t + show < duration - 3:
        events.append(ass_event(t, t + show, style, text, prefix=f"{{\\an5\\pos({pos[0]},{pos[1]})\\fad(400,400)}}", layer=1))
        t += every
    return events


def label_events(marks: list[tuple[float, str]], duration: float, *, style: str = "Label", pos: tuple[int, int]) -> list[str]:
    """Nhãn "Chương N" cố định theo từng đoạn chương (đổi khi sang chương mới)."""
    events = []
    for index, (start, label) in enumerate(marks):
        end = marks[index + 1][0] if index + 1 < len(marks) else duration
        if end > start:
            events.append(ass_event(start, end, style, label, prefix=f"{{\\an5\\pos({pos[0]},{pos[1]})}}", layer=1))
    return events


def plan_parts(chapter_chars: list[int], max_seconds: float) -> list[list[int]]:
    """Chia các chương (theo thứ tự) thành các tập, mỗi tập ước ≤ max_seconds; một chương không bao giờ bị cắt đôi.

    Trả danh sách chỉ số chương cho từng tập. Tập cuối quá ngắn (< 1/4 ngưỡng) được gộp vào tập trước."""
    parts: list[list[int]] = []
    current: list[int] = []
    seconds = 0.0
    for index, chars in enumerate(chapter_chars):
        estimate = estimate_seconds(chars)
        if current and seconds + estimate > max_seconds:
            parts.append(current)
            current, seconds = [], 0.0
        current.append(index)
        seconds += estimate
    if current:
        if parts and seconds < max_seconds / 4:
            parts[-1].extend(current)
        else:
            parts.append(current)
    return parts


def chapter_timestamps(marks: list[tuple[float, str]]) -> str:
    """Mốc chương cho mô tả YouTube: "00:00 Chương 1". YouTube cần mốc đầu là 00:00."""
    lines = []
    for seconds, label in marks:
        s = int(seconds)
        stamp = f"{s // 3600}:{s % 3600 // 60:02d}:{s % 60:02d}" if s >= 3600 else f"{s // 60:02d}:{s % 60:02d}"
        lines.append(f"{stamp} {label}")
    return "\n".join(lines)

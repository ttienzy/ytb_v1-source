"""Đọc giọng theo dòng (mỗi dòng một item TTS) + cache theo nội dung.

- Mỗi đoạn (thường là một chương) → một file wav đã ghép (kèm khoảng lặng giữa dòng) + thời lượng từng dòng.
- Cache theo hash(dòng, giọng, nhiệt độ, phiên bản): đổi bố cục/phụ đề/nhạc rồi xuất lại thì không đọc lại; chạy lại sau khi
  backend khởi động lại cũng bỏ qua các chương đã đọc.
"""
from __future__ import annotations

import hashlib
import io
import json
import wave
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Awaitable, Callable

from app.media.story_text import LINE_GAP_SEC

CACHE_VERSION = 1
TTS_TEMPERATURE = 0.8
MAX_ITEMS_PER_BATCH = 200       # giới hạn TTSBatchRequest của voice-service
MAX_CHARS_PER_BATCH = 60_000    # voice-service chặn 100.000 ký tự / batch; giữ dư

TtsFn = Callable[[list[dict], str], Awaitable[bytes]]


@dataclass
class Narration:
    wav: Path
    lines: list[str]
    durations: list[float]   # thời lượng từng dòng (giây, chưa đổi tốc độ)
    gap: float
    cached: bool

    @property
    def duration(self) -> float:
        return sum(self.durations) + self.gap * max(0, len(self.durations) - 1)


def cache_key(lines: list[str], voice_id: str) -> str:
    payload = json.dumps({"v": CACHE_VERSION, "voice": voice_id, "t": TTS_TEMPERATURE, "lines": lines}, ensure_ascii=False)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:32]


def batches(lines: list[str]) -> list[list[str]]:
    """Chia dòng thành các lô hợp lệ cho /tts/batch (giữ thứ tự)."""
    out: list[list[str]] = []
    current: list[str] = []
    chars = 0
    for line in lines:
        if current and (len(current) >= MAX_ITEMS_PER_BATCH or chars + len(line) > MAX_CHARS_PER_BATCH):
            out.append(current)
            current, chars = [], 0
        current.append(line)
        chars += len(line)
    if current:
        out.append(current)
    return out


def _read_zip(payload: bytes, expected: int) -> list[tuple[bytes, float, tuple]]:
    """[(pcm frames, thời lượng, wav params)] theo đúng thứ tự item."""
    with zipfile.ZipFile(io.BytesIO(payload)) as zf:
        items = json.loads(zf.read("manifest.json"))["items"]
        if len(items) != expected:
            raise RuntimeError(f"Voice-service trả {len(items)} đoạn, cần {expected}.")
        out = []
        for item in sorted(items, key=lambda x: x["index"]):
            with wave.open(io.BytesIO(zf.read(item["filename"]))) as w:
                params = (w.getnchannels(), w.getsampwidth(), w.getframerate())
                frames = w.readframes(w.getnframes())
                out.append((frames, w.getnframes() / w.getframerate(), params))
        return out


def write_joined(parts: list[tuple[bytes, tuple]], gap: float, dest: Path) -> None:
    """Ghép các đoạn PCM cùng định dạng, chèn `gap` giây lặng giữa chúng."""
    if not parts:
        raise ValueError("Không có đoạn âm thanh nào để ghép.")
    params = parts[0][1]
    if any(p != params for _, p in parts):
        raise RuntimeError("Các đoạn giọng đọc khác định dạng (kênh/độ sâu/tần số), không ghép được.")
    channels, width, rate = params
    silence = b"\x00" * (int(round(gap * rate)) * width * channels)
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(".tmp")
    with wave.open(str(tmp), "wb") as out:
        out.setnchannels(channels)
        out.setsampwidth(width)
        out.setframerate(rate)
        for index, (frames, _) in enumerate(parts):
            if index:
                out.writeframes(silence)
            out.writeframes(frames)
    tmp.replace(dest)


async def narrate(lines: list[str], voice_id: str, tts: TtsFn, cache_dir: Path, *, gap: float = LINE_GAP_SEC,
                  on_batch: Callable[[int, int], None] | None = None) -> Narration:
    """Đọc các dòng (dùng cache nếu có). `tts(items, voice_id)` trả zip của voice-service (đã có retry khi bận)."""
    if not lines:
        raise ValueError("Không có dòng nào để đọc.")
    key = cache_key(lines, voice_id)
    wav, meta = cache_dir / f"{key}.wav", cache_dir / f"{key}.json"
    if wav.is_file() and meta.is_file():
        try:
            data = json.loads(meta.read_text(encoding="utf-8"))
            if data.get("lines") == lines and len(data.get("durations", [])) == len(lines) and data.get("gap") == gap:
                return Narration(wav, lines, data["durations"], gap, cached=True)
        except (OSError, ValueError):
            pass
    parts: list[tuple[bytes, tuple]] = []
    durations: list[float] = []
    groups = batches(lines)
    for index, group in enumerate(groups):
        if on_batch:
            on_batch(index, len(groups))
        for frames, seconds, params in _read_zip(await tts([{"text": line} for line in group], voice_id), len(group)):
            parts.append((frames, params))
            durations.append(round(seconds, 3))
    write_joined(parts, gap, wav)
    meta.write_text(json.dumps({"lines": lines, "durations": durations, "gap": gap, "voice": voice_id}, ensure_ascii=False), encoding="utf-8")
    return Narration(wav, lines, durations, gap, cached=False)


def concat_wavs(paths: list[Path], gap: float, dest: Path, chunk_frames: int = 48_000 * 10) -> None:
    """Nối các wav (cùng định dạng) với `gap` giây lặng giữa — dùng để nối các chương thành giọng cả truyện.

    Đọc/ghi theo khối: giọng cả truyện 40 phút ≈ 230 MB PCM, không nạp hết vào RAM."""
    if not paths:
        raise ValueError("Không có đoạn âm thanh nào để ghép.")
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(".tmp")
    params = None
    with wave.open(str(tmp), "wb") as out:
        for index, path in enumerate(paths):
            with wave.open(str(path)) as w:
                current = (w.getnchannels(), w.getsampwidth(), w.getframerate())
                if params is None:
                    params = current
                    out.setnchannels(current[0])
                    out.setsampwidth(current[1])
                    out.setframerate(current[2])
                elif current != params:
                    raise RuntimeError(f"Giọng đọc chương {index + 1} khác định dạng các chương trước, không ghép được.")
                if index:
                    out.writeframes(b"\x00" * (int(round(gap * params[2])) * params[1] * params[0]))
                while frames := w.readframes(chunk_frames):
                    out.writeframes(frames)
    tmp.replace(dest)

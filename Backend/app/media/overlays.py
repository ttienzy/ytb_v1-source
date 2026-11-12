"""Lớp phủ cho video Audio: làm tối nền, thẻ tiêu đề chương, waveform, logo.

Tất cả gộp trong MỘT lần ffmpeg (mã hóa lại video). Không bật lớp phủ nào thì bước này bị bỏ qua và video nền vẫn đi đường
stream copy nhanh. Mọi `drawtext` đều có `fontfile=` + đường dẫn tương đối với cwd=work (xem app/media/fonts.py).
"""
from __future__ import annotations

import subprocess
import textwrap
from pathlib import Path

from app.media.audio_options import AudioOptions
from app.media.backgrounds import ASPECTS, FPS
from app.media.fonts import stage_font

LOGO_MARGIN = 0.04  # lề logo theo bề rộng khung


def title_lines(story_name: str, chapter_number: int | None, chapter_title: str, aspect: str) -> list[str]:
    """Các dòng của thẻ tiêu đề: tên truyện (tối đa 3 dòng) + dòng "Chương N · tên chương" (1 dòng, cắt gọn)."""
    width = 22 if aspect == "9:16" else 40
    name = textwrap.wrap(story_name.strip(), width=width, break_long_words=False, break_on_hyphens=False)[:3] or [story_name.strip()]
    label = f"Chương {chapter_number}" if chapter_number is not None else ""
    title = (chapter_title or "").strip()
    if title and title.lower() != label.lower():
        label = f"{label} · {title}" if label else title
    if len(label) > width + 8:
        label = label[: width + 7].rstrip() + "…"
    return [*name, label] if label else name


def _logo_xy(position: str, margin: int) -> tuple[str, str]:
    x = f"{margin}" if position in ("tl", "bl") else f"W-w-{margin}"
    y = f"{margin}" if position in ("tl", "tr") else f"H-h-{margin}"
    return x, y


def build_filter_graph(options: AudioOptions, aspect: str, duration: float, *, has_title: bool, voice_index: int | None,
                       logo_index: int | None) -> tuple[str, str]:
    """Dựng filter_complex. Đầu vào 0 là video nền; `voice_index`/`logo_index` là chỉ số input của voice/logo (nếu có).

    Trả (filter_complex, nhãn_đầu_ra). Hàm thuần để test chuỗi filter."""
    w, h = ASPECTS[aspect]
    steps: list[str] = []
    label = "0:v"
    counter = 0

    def nxt() -> str:
        nonlocal counter
        counter += 1
        return f"v{counter}"

    if options.dim > 0:
        out = nxt()
        steps.append(f"[{label}]lutyuv=y='val*{1 - options.dim:.3f}'[{out}]")  # nhân độ sáng (luma) → tối đều, không đổi màu
        label = out

    if options.waveform and voice_index is not None:
        wave_h = int(h * (0.10 if aspect == "9:16" else 0.13))
        y = int(h * (0.80 if aspect == "9:16" else 0.78))
        steps.append(f"[{voice_index}:a]showwaves=s={w}x{wave_h}:mode=cline:scale=sqrt:rate={FPS}:colors=white@0.9,format=yuva420p[wave]")
        out = nxt()
        steps.append(f"[{label}][wave]overlay=x=0:y={y}:shortest=1[{out}]")
        label = out

    if has_title and options.title_card != "off":
        intro = options.title_card == "intro"
        font = int(h * (0.034 if intro else 0.021))
        box = max(8, int(font * 0.45))
        y_expr = f"(h-text_h)/2-{int(h * 0.10)}" if intro else f"{int(h * 0.045)}"
        alpha = ""
        if intro:
            d = options.title_seconds
            alpha = f":alpha='if(gt(t,{d}),0,if(lt(t,0.6),t/0.6,if(lt(t,{d}-0.6),1,({d}-t)/0.6)))'"
        out = nxt()
        steps.append(
            f"[{label}]drawtext=fontfile=font.ttf:textfile=title.txt:fontcolor=white:fontsize={font}:line_spacing={int(font * 0.3)}:"
            f"x=(w-text_w)/2:y={y_expr}:box=1:boxcolor=black@0.55:boxborderw={box}{alpha}[{out}]"
        )
        label = out

    if options.logo_id and logo_index is not None:
        margin = int(w * LOGO_MARGIN)
        x, y = _logo_xy(options.logo_position, margin)
        steps.append(f"[{logo_index}:v]scale={int(w * options.logo_size)}:-1,format=rgba,colorchannelmixer=aa={options.logo_opacity:.2f}[logo]")
        out = nxt()
        steps.append(f"[{label}][logo]overlay=x={x}:y={y}:shortest=1[{out}]")
        label = out

    if not steps:
        raise ValueError("Không có lớp phủ nào được bật.")
    return ";".join(steps), label


def render_overlays(video: Path, voice: Path | None, logo: Path | None, work: Path, *, aspect: str, duration: float,
                    options: AudioOptions, lines: list[str]) -> Path:
    """Phủ lớp phủ lên video nền → file mới (không tiếng, đúng `duration` giây). Chạy trong cwd=work để dùng đường dẫn tương đối."""
    work.mkdir(parents=True, exist_ok=True)
    font_ok = stage_font(work)
    has_title = options.title_card != "off" and font_ok and bool(lines)
    if has_title:
        (work / "title.txt").write_text("\n".join(lines), encoding="utf-8")
    use_wave = options.waveform and voice is not None
    use_logo = bool(options.logo_id) and logo is not None

    inputs = ["-i", str(video)]
    voice_index = logo_index = None
    if use_wave:
        voice_index = len(inputs) // 2
        inputs += ["-i", str(voice)]
    if use_logo:
        logo_index = len(inputs) // 2
        inputs += ["-loop", "1", "-i", str(logo)]

    effective = options.model_copy(update={"waveform": use_wave, "logo_id": options.logo_id if use_logo else None})
    graph, label = build_filter_graph(effective, aspect, duration, has_title=has_title, voice_index=voice_index, logo_index=logo_index)
    output = work / "overlay.mp4"
    cmd = ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", *inputs, "-filter_complex", graph, "-map", f"[{label}]", "-an",
           "-t", f"{duration:.3f}", "-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-g", str(FPS * 2), "-pix_fmt", "yuv420p",
           "-movflags", "+faststart", output.name]
    proc = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=3600, cwd=str(work))
    if proc.returncode != 0 or not output.is_file() or output.stat().st_size == 0:
        raise RuntimeError(f"Không áp dụng được lớp phủ (ffmpeg exit {proc.returncode}): {(proc.stderr or '').strip()[-700:]}")
    return output

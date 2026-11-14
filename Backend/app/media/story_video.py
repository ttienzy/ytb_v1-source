"""Workflow Audio v2: truyện → video có giọng đọc theo dòng, phụ đề khớp giọng, bố cục ảnh bìa, thumbnail + mô tả.

Đơn vị đầu ra (`unit`):
- "story": mỗi truyện một video FULL (truyện dài tự chia "Tập" theo ngưỡng phút, cắt ở ranh giới chương);
- "chapter": mỗi chương một video.

Các bước của MỘT video: prepare → voice (từng chương, có cache) → render (một lượt mã hóa) → mix (giọng + nhạc nền) → package
(thumbnail, tiêu đề/mô tả/mốc chương, lịch sử "đã làm" theo chương) → drive (tùy chọn).
Thiết kế: docs/PLAN_audio_story_v2.md.
"""
from __future__ import annotations

import asyncio
import logging
import math
import random
import re
import shutil
import subprocess
from dataclasses import dataclass, field
from datetime import datetime
from functools import partial
from pathlib import Path
from typing import Literal

from app.media import audio_workflow as aw
from app.media import backgrounds, overlays, story_art
from app.media import story_text as st
from app.media.audio_options import AudioOptions
from app.media.fonts import stage_font
from app.media.narration import Narration, concat_wavs, narrate
from app.recap.ffmpeg import ffprobe_duration

log = logging.getLogger(__name__)

Unit = Literal["story", "chapter"]
FPS = 25
MAX_CONSECUTIVE_FAILURES = 3

STEP_TITLES = {
    "prepare": "Chuẩn bị",
    "voice": "Giọng đọc",
    "render": "Dựng hình",
    "mix": "Ghép âm thanh",
    "package": "Thumbnail & mô tả",
    "drive": "Upload Drive",
    "done": "Hoàn tất",
}


def cover_dir() -> Path:
    return aw.AUDIO_DIR / "covers"


def voice_cache_dir() -> Path:
    return aw.AUDIO_DIR / ".cache" / "voice"


@dataclass
class ChapterInput:
    number: int
    title: str
    text: str


@dataclass
class StoryInput:
    slug: str | None
    name: str
    chapters: list[ChapterInput]
    image: Path | None = None          # ảnh upload tay (ưu tiên) — None thì tải ảnh bìa nguồn từ `image_url`
    image_url: str | None = None
    description: str = ""
    categories: list[str] = field(default_factory=list)


@dataclass
class VideoSpec:
    unit: Unit
    voice_id: str
    aspect: str
    bg_fit: str = "fill"
    options: AudioOptions = field(default_factory=AudioOptions)
    bgm_pool: list[Path] = field(default_factory=list)
    part_max_minutes: int = 120
    auto_upload_drive: bool = False
    delete_local_after_upload: bool = False


@dataclass
class VideoUnit:
    story: StoryInput
    chapters: list[ChapterInput]
    part: int | None = None      # số tập khi truyện bị chia (None = cả truyện / từng chương)
    parts: int = 1
    story_mode: bool = True      # False = video của MỘT chương (unit="chapter")

    @property
    def label(self) -> str:
        if not self.story_mode:
            return f"Chương {self.chapters[0].number}"
        return f"Tập {self.part}" if self.part is not None else "FULL"


def steps_for(spec: VideoSpec) -> list[dict]:
    keys = ["prepare", "voice", "render", "mix", "package", *(["drive"] if spec.auto_upload_drive else []), "done"]
    return [{"key": key, "title": STEP_TITLES[key]} for key in keys]


def plan_units(stories: list[StoryInput], spec: VideoSpec) -> list[VideoUnit]:
    units: list[VideoUnit] = []
    for story in stories:
        if spec.unit == "chapter":
            units += [VideoUnit(story, [chapter], story_mode=False) for chapter in story.chapters]
            continue
        groups = st.plan_parts([len(c.text) for c in story.chapters], spec.part_max_minutes * 60)
        for index, group in enumerate(groups):
            units.append(VideoUnit(story, [story.chapters[i] for i in group], part=index + 1 if len(groups) > 1 else None, parts=len(groups)))
    return units


# ── Văn bản đọc ──────────────────────────────────────────────────────────────

def chapter_lines(chapter: ChapterInput, with_heading: bool) -> list[str]:
    lines = st.clean_lines(chapter.text)
    if not lines:
        raise RuntimeError(f"Chương {chapter.number} không còn nội dung để đọc sau khi làm sạch.")
    return [f"Chương {chapter.number}.", *lines] if with_heading else lines


def video_title(unit: VideoUnit) -> str:
    name = st.clean_name(unit.story.name)
    if not unit.story_mode:
        return f"{name} - Chương {unit.chapters[0].number} | Truyện Audio"
    return f"[Truyện Audio Full] {name}" + (f" - Tập {unit.part}" if unit.part else "")


def _hashtag(text: str) -> str:
    import unicodedata
    plain = unicodedata.normalize("NFD", text.replace("đ", "d").replace("Đ", "D")).encode("ascii", "ignore").decode()  # Đ không tách dấu được
    return "#" + "".join(word.capitalize() for word in re.findall(r"[A-Za-z0-9]+", plain))


def video_description(unit: VideoUnit, marks: list[tuple[float, str]]) -> str:
    parts = []
    summary = (unit.story.description or "").strip()
    if summary:
        parts.append(summary[:700].rstrip() + ("…" if len(summary) > 700 else ""))
    if unit.story_mode and len(marks) > 1:
        parts.append(st.chapter_timestamps(marks))
    tags = ["#TruyenAudio", *(_hashtag(c) for c in unit.story.categories if c and c.upper() != "NULL")][:6]
    parts.append(" ".join(dict.fromkeys(tags)))
    return "\n\n".join(parts)


# ── Dựng ASS ─────────────────────────────────────────────────────────────────

def build_ass(cues: list[st.Cue], marks: list[tuple[float, str]], duration: float, aspect: str, options: AudioOptions) -> str:
    w, h = backgrounds.ASPECTS[aspect]
    if options.layout == "cover_center":
        geo = story_art.frame_layout(aspect)
        sub_size, label_size, margin_v = geo["sub_size"], geo["label_size"], geo["sub_margin_v"]
        label_pos, cta_pos = geo["label_pos"], geo["cta_pos"]
    else:
        sub_size, label_size, margin_v = int(h * (0.030 if aspect == "9:16" else 0.046)), int(h * (0.024 if aspect == "9:16" else 0.036)), int(h * 0.08)
        label_pos, cta_pos = (w // 2, int(h * 0.06)), (w // 2, int(h * 0.15))
    styles = [
        st.AssStyle("Sub", sub_size, alignment=2, margin_v=margin_v, outline_px=max(2, sub_size / 16), shadow_px=1),
        # Nhãn chương: chữ vàng trong hộp tối mờ (BorderStyle 3: OutlineColour là màu hộp, Outline là lề hộp).
        st.AssStyle("Label", label_size, alignment=5, primary="&H0000D6FF", outline="&H50000000", back="&H50000000", border_style=3,
                    outline_px=int(label_size * 0.35), shadow_px=0),
        st.AssStyle("Cta", int(label_size * 0.85), alignment=5, outline="&H00481DE1", back="&H00481DE1", border_style=3, outline_px=int(label_size * 0.4), shadow_px=0),
    ]
    events: list[str] = []
    if options.subtitles:
        events += st.subtitle_events(cues, "Sub")
    if options.chapter_label and len(marks) > 1 and not (options.layout == "classic" and options.title_card != "off"):
        events += st.label_events(marks, duration, pos=label_pos)
    if options.cta:
        events += st.cta_events(duration, options.cta_text.upper(), pos=cta_pos)
    return st.to_ass(w, h, styles, events)


# ── Dựng hình ────────────────────────────────────────────────────────────────

def _ffmpeg(args: list[str], cwd: Path, what: str, timeout: int = 4 * 3600) -> None:
    proc = subprocess.run(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", *args], cwd=str(cwd), capture_output=True,
                          text=True, encoding="utf-8", errors="replace", timeout=timeout)
    if proc.returncode != 0:
        raise RuntimeError(f"{what} lỗi (ffmpeg exit {proc.returncode}): {(proc.stderr or '').strip()[-700:]}")


def render_cover_center(frame: Path, logo: Path | None, work: Path, *, aspect: str, duration: float, options: AudioOptions,
                        has_ass: bool) -> Path:
    """Video câm từ khung tĩnh + logo + phụ đề/nhãn/CTA (ASS). Ảnh tĩnh nên mã hóa nhanh (-tune stillimage)."""
    w, _ = backgrounds.ASPECTS[aspect]
    shutil.copyfile(frame, work / "frame.png")
    inputs = ["-loop", "1", "-framerate", str(FPS), "-i", "frame.png"]
    steps: list[str] = []
    label = "0:v"
    if logo:
        shutil.copyfile(logo, work / f"logo{logo.suffix}")
        inputs += ["-loop", "1", "-i", f"logo{logo.suffix}"]
        margin = int(w * overlays.LOGO_MARGIN)
        x, y = overlays._logo_xy(options.logo_position, margin)
        steps.append(f"[1:v]scale={int(w * options.logo_size)}:-1,format=rgba,colorchannelmixer=aa={options.logo_opacity:.2f}[logo]")
        steps.append(f"[{label}][logo]overlay=x={x}:y={y}:shortest=1[v1]")
        label = "v1"
    if has_ass:
        steps.append(f"[{label}]subtitles=subs.ass:fontsdir=.[v2]")
        label = "v2"
    steps.append(f"[{label}]format=yuv420p[vout]")
    out = work / "video.mp4"
    _ffmpeg([*inputs, "-filter_complex", ";".join(steps), "-map", "[vout]", "-an", "-t", f"{duration:.3f}", "-r", str(FPS),
             "-c:v", "libx264", "-preset", "veryfast", "-tune", "stillimage", "-crf", "23", "-g", str(FPS * 4),
             "-movflags", "+faststart", out.name], work, "Dựng hình")
    return out


async def render_video(unit: VideoUnit, spec: VideoSpec, image: Path | None, voice: Path, duration: float, ass: str | None,
                       work: Path, on_status) -> tuple[Path, Path | None]:
    """→ (video câm, file nền tạm cần xóa)."""
    options = spec.options
    logo = aw.logo_path(options.logo_id)
    if options.logo_id and logo is None:
        raise RuntimeError("Không tìm thấy file logo đã chọn. Hãy chọn lại logo.")
    font_ok = await asyncio.to_thread(stage_font, work)
    if ass and not font_ok:
        ass = None  # thiếu font: libass sẽ dò Fontconfig và có thể làm crash ffmpeg Windows — bỏ phụ đề
    if ass:
        (work / "subs.ass").write_text(ass, encoding="utf-8")
    if options.layout == "cover_center":
        frame = await asyncio.to_thread(story_art.compose_frame, image, spec.aspect, st.clean_name(unit.story.name), work / "frame_src.png")
        return await asyncio.to_thread(partial(render_cover_center, frame, logo, work, aspect=spec.aspect, duration=duration,
                                               options=options, has_ass=bool(ass))), None
    seconds = max(1, math.ceil(duration))
    if options.bg_mode == "cover":
        if image is None:
            raise RuntimeError("Nền ảnh bìa cần truyện có ảnh bìa.")
        merged = await asyncio.to_thread(backgrounds.build_cover_background, image, seconds, spec.aspect, on_status)
    else:
        merged = await asyncio.to_thread(backgrounds.build_background, seconds, spec.aspect, spec.bg_fit, on_status)
    if not options.needs_overlay() and not ass:
        return merged, merged
    lines = overlays.title_lines(st.clean_name(unit.story.name), unit.chapters[0].number if not unit.story_mode else None,
                                 unit.chapters[0].title if not unit.story_mode else "", spec.aspect)
    video = await asyncio.to_thread(partial(overlays.render_overlays, merged, voice, logo, work, aspect=spec.aspect, duration=duration,
                                            options=options, lines=lines, ass_name="subs.ass" if ass else None))
    return video, merged


# ── Một video ────────────────────────────────────────────────────────────────

def _output_stem(unit: VideoUnit, job_id: str) -> str:
    safe = re.sub(r"[^\w-]+", "_", st.clean_name(unit.story.name), flags=re.UNICODE).strip("_")[:60] or "story"
    if not unit.story_mode:
        return f"{safe}_chuong_{unit.chapters[0].number}_{job_id[:8]}"
    return f"{safe}_{'tap_' + str(unit.part) if unit.part else 'FULL'}_{job_id[:8]}"


def resolve_image(story: StoryInput) -> tuple[Path | None, str | None]:
    """(ảnh dùng cho video, cảnh báo nếu phải bỏ ảnh bìa). Ảnh upload tay ưu tiên hơn ảnh bìa nguồn."""
    if story.image and story.image.is_file():
        return story.image, None
    if not story.slug:
        return None, None
    try:
        return story_art.download_cover(cover_dir(), story.slug, story.image_url), None
    except story_art.CoverError as error:
        log.warning("Ảnh bìa %s: %s", story.slug, error)
        return None, f"Không dùng được ảnh bìa ({error}) — dùng ảnh thay thế."


async def produce(job_id: str, unit: VideoUnit, spec: VideoSpec, *, start: int = 0, end: int = 100) -> dict:
    """Làm MỘT video. Trả bản ghi đầu ra (đã ghi manifest + lịch sử)."""
    options = spec.options
    work = aw.AUDIO_DIR / ".tmp" / f"{job_id}_{_output_stem(unit, job_id)[-24:]}"
    temp_background: Path | None = None

    def progress(value: float) -> int:
        return round(start + (end - start) * value / 100)

    def status(step: str | None = None, value: float | None = None, message: str | None = None) -> None:
        values: dict = {}
        if step:
            values["step"] = step
        if value is not None:
            values["progress"] = progress(value)
        if message:
            values["message"] = message
        aw._set(job_id, status="running", **values)

    name = st.clean_name(unit.story.name)
    try:
        work.mkdir(parents=True, exist_ok=True)
        # 1. Chuẩn bị — phần rẻ và dễ hỏng trước TTS (ảnh bìa, nội dung rỗng) để lỗi báo sớm.
        status("prepare", 2, f"{name} · {unit.label}: chuẩn bị văn bản và ảnh bìa…")
        heading = unit.story_mode and len(unit.chapters) > 1
        texts = [chapter_lines(chapter, heading) for chapter in unit.chapters]
        image, cover_warning = await asyncio.to_thread(resolve_image, unit.story)
        if cover_warning:
            status(message=f"{name}: {cover_warning}")
        if image is None and (options.layout == "cover_center" or options.bg_mode == "cover"):
            image = await asyncio.to_thread(story_art.placeholder_cover, cover_dir() / "_placeholder.png")

        # 2. Giọng đọc theo dòng — từng chương có cache (chạy lại / đổi bố cục không đọc lại).
        tts = lambda items, voice: aw._tts_with_retry(job_id, items, voice)  # noqa: E731
        narrations: list[Narration] = []
        intro: Narration | None = None
        if unit.story_mode:
            status("voice", 5, f"{name}: đọc lời giới thiệu…")
            intro_line = f"{st.spoken_name(unit.story.name)}." + (f" Tập {unit.part}." if unit.part else "")
            intro = await narrate([intro_line], spec.voice_id, tts, voice_cache_dir())
        for index, (chapter, lines) in enumerate(zip(unit.chapters, texts)):
            base = 5 + 65 * index / len(unit.chapters)
            status("voice", base, f"{name} · chương {chapter.number} ({index + 1}/{len(unit.chapters)}): đang đọc {len(lines)} câu…")
            narration = await narrate(lines, spec.voice_id, tts, voice_cache_dir(),
                                      on_batch=lambda i, n, c=chapter: status(message=f"{name} · chương {c.number}: đọc lô {i + 1}/{n}…"))
            if narration.cached:
                status(message=f"{name} · chương {chapter.number}: dùng lại giọng đã đọc trước đó.")
            narrations.append(narration)

        # Ghép giọng + mốc phụ đề/chương.
        status("voice", 71, f"{name}: ghép giọng {len(narrations)} chương…")
        speed = options.voice_speed if abs(options.voice_speed - 1.0) >= 0.01 else 1.0
        scale = 1.0 / speed
        pieces = ([intro] if intro else []) + narrations
        cues: list[st.Cue] = []
        marks: list[tuple[float, str]] = []
        t = 0.0
        for index, narration in enumerate(pieces):
            if narration is not intro:
                chapter = unit.chapters[index - (1 if intro else 0)]
                marks.append((0.0 if not marks else t, f"Chương {chapter.number}"))
            piece_cues, t_end = st.build_cues(narration.lines, narration.durations, offset=t, gap=narration.gap, speed=speed)
            cues += piece_cues
            t = t_end + st.CHAPTER_GAP_SEC * scale
        joined = work / "voice_joined.wav"
        await asyncio.to_thread(concat_wavs, [n.wav for n in pieces], st.CHAPTER_GAP_SEC, joined)
        voice = joined
        if speed != 1.0:
            voice = await asyncio.to_thread(aw.apply_voice_speed, joined, work / "voice_speed.wav", speed)
        duration = await asyncio.to_thread(ffprobe_duration, voice)
        if duration <= 0:
            raise RuntimeError("Không đọc được thời lượng giọng đọc.")

        # 3. Dựng hình — một lượt mã hóa.
        status("render", 74, f"{name}: dựng hình {aspect_label(spec.aspect)} ({_mmss(duration)})…")
        ass = build_ass(cues, marks, duration, spec.aspect, options) if (options.subtitles or options.cta or options.chapter_label) else None
        video, temp_background = await render_video(unit, spec, image, voice, duration, ass, work, lambda message: status(message=message))

        # 4. Ghép âm thanh (nhạc nền hạ theo giọng, chuẩn hóa âm lượng).
        stem = _output_stem(unit, job_id)
        output = aw.AUDIO_DIR / f"{stem}.mp4"
        bgm = random.choice(spec.bgm_pool) if spec.bgm_pool else None
        status("mix", 90, f"{name}: ghép giọng{' + nhạc nền' if bgm else ''}…")
        await asyncio.to_thread(partial(aw._mux, video, voice, output, bgm, options.bgm_volume, duck=options.bgm_duck,
                                        fade_out=options.fade_out_sec, loudnorm=options.loudnorm, duration=duration))

        # 5. Thumbnail + tiêu đề/mô tả + lịch sử.
        status("package", 95, f"{name}: thumbnail và mô tả…")
        thumbnail_name = None
        if image is not None:
            thumbnail_name = f"{stem}.jpg"
            badge = unit.label.upper()
            await asyncio.to_thread(story_art.compose_thumbnail, image, spec.aspect, name, badge, aw.AUDIO_THUMBNAIL_DIR / thumbnail_name)
        record = {
            "file_name": output.name, "name": output.name, "story_slug": unit.story.slug, "story_name": name,
            "chapter_number": unit.chapters[0].number if len(unit.chapters) == 1 else None,
            "chapter_title": unit.chapters[0].title if len(unit.chapters) == 1 else unit.label,
            "chapters": [c.number for c in unit.chapters], "unit": "story" if unit.story_mode else "chapter", "part": unit.part,
            "aspect": spec.aspect, "thumbnail_name": thumbnail_name, "duration_sec": round(duration, 2),
            "video_title": video_title(unit), "video_description": video_description(unit, marks),
            "chapter_marks": [{"start": round(s, 2), "label": label} for s, label in marks],
            "created_at": datetime.now().isoformat(),
            **({"warnings": [cover_warning]} if cover_warning else {}),
        }
        for chapter in unit.chapters:  # "đã làm" vẫn theo từng chương (danh sách truyện/chương dựa vào đây)
            aw.record_completion({**record, "chapter_number": chapter.number, "chapter_title": chapter.title}, unit.story.slug)

        # 6. Upload Drive (lỗi Drive không làm hỏng video đã tạo).
        if spec.auto_upload_drive:
            status("drive", 97, f"{name}: upload Google Drive…")
            try:
                result = await asyncio.to_thread(partial(aw._upload_audio_output, output, name, None, unit.story.slug, drive_label=unit.label))
                record.update({"drive_file_id": result.get("file_id"), "drive_url": result.get("web_view_link"),
                               "drive_name": result.get("file_name"), "drive_uploaded": True})
                aw.mark_drive_uploaded(output.name, result)
                if spec.delete_local_after_upload:
                    output.unlink(missing_ok=True)
            except Exception as error:  # noqa: BLE001
                record["drive_error"] = str(error)
        aw._append_manifest(record)
        return record
    finally:
        if temp_background:
            temp_background.unlink(missing_ok=True)
        shutil.rmtree(work, ignore_errors=True)


def aspect_label(aspect: str) -> str:
    return "dọc 9:16" if aspect == "9:16" else "ngang 16:9"


def _mmss(seconds: float) -> str:
    s = int(seconds)
    return f"{s // 3600}:{s % 3600 // 60:02d}:{s % 60:02d}" if s >= 3600 else f"{s // 60}:{s % 60:02d}"


# ── Hàng đợi nhiều video ─────────────────────────────────────────────────────

async def run_videos(job_id: str, stories: list[StoryInput], spec: VideoSpec) -> None:
    """Làm lần lượt mọi video của các truyện đã chọn. Một video lỗi không chặn video sau (trừ khi lỗi liên tiếp)."""
    units = plan_units(stories, spec)
    total = len(units)
    done: list[str] = []
    warnings: list[str] = []
    failures: list[dict] = []
    consecutive = 0
    aw._set(job_id, steps=steps_for(spec), total_videos=total, completed_videos=0, total_chapters=total, completed_chapters=0, failed_chapters=[])
    for index, unit in enumerate(units):
        aw._set(job_id, current_story=st.clean_name(unit.story.name), current_label=unit.label,
                current_chapter=unit.chapters[0].number if len(unit.chapters) == 1 else None, video_index=index + 1)
        try:
            record = await produce(job_id, unit, spec, start=round(index * 100 / total), end=round((index + 1) * 100 / total))
            done.append(record["file_name"])
            warnings += [f"{st.clean_name(unit.story.name)}: {w}" for w in record.get("warnings", [])]
            consecutive = 0
            if warnings:
                aw._set(job_id, warnings=list(warnings))
            aw._set(job_id, completed_videos=len(done), completed_chapters=len(done), output_name=record["file_name"])
        except Exception as error:  # noqa: BLE001
            failures.append({"story_name": st.clean_name(unit.story.name), "chapter_number": unit.chapters[0].number if len(unit.chapters) == 1 else None,
                             "label": unit.label, "chapters": [c.number for c in unit.chapters], "error": str(error)})
            consecutive += 1
            aw._set(job_id, failed_chapters=list(failures))
            if consecutive >= MAX_CONSECUTIVE_FAILURES:
                break
    if not failures:
        aw._set(job_id, status="completed", step="done", progress=100, message=f"Đã hoàn thành {len(done)} video.")
    elif not done:
        first = failures[0]
        aw._set(job_id, status="error", error=f"{first['story_name']} · {first['label']}: {first['error']}", message=f"Tất cả {len(failures)} video đều lỗi.")
    elif consecutive >= MAX_CONSECUTIVE_FAILURES:
        aw._set(job_id, status="error", error=f"Dừng sớm vì {MAX_CONSECUTIVE_FAILURES} video liên tiếp lỗi (xong {len(done)}/{total}).",
                message=f"Dừng sớm vì {MAX_CONSECUTIVE_FAILURES} video liên tiếp lỗi (xong {len(done)}/{total}).")
    else:
        aw._set(job_id, status="completed", step="done", progress=100, message=f"Xong {len(done)}/{total} video, {len(failures)} video lỗi (xem danh sách bên dưới).")

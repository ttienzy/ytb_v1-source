"""Executor `assemble` (Khối 8): các clip đã duyệt + giọng đọc + chữ trên màn hình (+ nhạc nền) -> MỘT video hoàn chỉnh (mp4). 0 credit.

Mỗi shot thành một đoạn: nhịp `beat_seconds` (clip dài hơn nhịp thì TĂNG TỐC tối đa 1,5x để trọn cả chuyển động rồi mới cắt đuôi), kéo dài
nếu giọng đọc dài hơn, chữ trên màn hình, tiếng đọc. Các đoạn nối bằng concat demuxer (cắt cứng, copy luồng) hoặc xfade/acrossfade
(chuyển cảnh, mã hóa lại một lần). Chữ dùng drawtext với đường dẫn TƯƠNG ĐỐI và cwd là thư mục tạm (dấu ':' và khoảng trắng của
đường dẫn Windows làm gãy bộ phân tích filter của ffmpeg).
"""
from __future__ import annotations

import shutil
import subprocess
import sys
import uuid
from pathlib import Path
from typing import Any

from ..runner import ArtifactSpec, ExecContext, ExecResult
from . import edit_plan
from .planning import load_input

FPS = 30
VOICE_LEAD = 0.15           # giọng vào chậm một nhịp ngắn cho tự nhiên
VOICE_TAIL = 0.35           # chừa đuôi sau câu cuối
MAX_ATEMPO = 1.3            # đọc nhanh hơn tối đa 30% khi lời dài hơn clip; quá mức này thì cắt đuôi
MAX_SPEED = 1.5             # tăng tốc clip tối đa khi nhịp ngắn hơn clip
FONT_FILE = "BeVietnamPro-ExtraBold.ttf"          # OFL, kèm trong Backend/resources/fonts; hỗ trợ đủ dấu tiếng Việt
FONT_CANDIDATES = (r"C:\Windows\Fonts\arialbd.ttf", r"C:\Windows\Fonts\arial.ttf", r"C:\Windows\Fonts\segoeui.ttf",
                   "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf")
TIMEOUT = 300
BGM_DEFAULT_VOLUME = 0.12   # nhạc nền nhỏ hơn giọng; còn tự hạ thêm khi giọng đang nói (sidechain)
BGM_FADE_OUT = 1.5
CAPTION_STYLES = ("pop", "box", "none")           # pop: chữ viền + đổ bóng (mặc định); box: hộp đen kiểu cũ; none: không chữ
CAPTION_COLORS = {"white": "white", "yellow": "#FFE600"}
CAPTION_SAFE_BOTTOM = 0.83  # đáy khối chữ ở 83% chiều cao: sát đáy nhất mà vẫn trên thanh giao diện TikTok/Reels (khoảng 17% dưới cùng)
TRANSITIONS = {"cut": None, "fade": "fade", "slide": "slideleft", "zoom": "zoomin"}
TRANSITION_SECONDS = 0.3
EDIT_STYLES = ("shots", "micro")                  # shots: giữ trọn clip đúng thời lượng đã chọn (mặc định); micro: nhiều cú cắt ngắn theo nhịp nhạc


class AssembleError(RuntimeError):
    pass


def probe(path: Path) -> dict[str, float]:
    """Đo chiều rộng, cao, thời lượng bằng ffprobe."""
    proc = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height:format=duration",
                           "-of", "default=noprint_wrappers=1", str(path)], capture_output=True, text=True, encoding="utf-8",
                          errors="replace", timeout=30)
    info = dict(line.split("=", 1) for line in proc.stdout.splitlines() if "=" in line)
    try:
        return {"width": float(info["width"]), "height": float(info["height"]), "duration": float(info["duration"])}
    except (KeyError, ValueError) as exc:
        raise AssembleError(f"Không đọc được thông tin video: {path.name}") from exc


def audio_seconds(path: Path) -> float:
    proc = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", str(path)],
                          capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=30)
    try:
        return float((proc.stdout or "").strip())
    except ValueError:
        return 0.0


def bundled_font() -> Path | None:
    """Font kèm theo ứng dụng, ở cả cây mã nguồn lẫn thư mục bundle PyInstaller."""
    roots = [Path(__file__).resolve().parents[3] / "resources" / "fonts"]
    bundle = getattr(sys, "_MEIPASS", None)
    if bundle:
        roots.insert(0, Path(bundle) / "resources" / "fonts")
    return next((r / FONT_FILE for r in roots if (r / FONT_FILE).is_file()), None)


def find_font() -> Path | None:
    return bundled_font() or next((Path(f) for f in FONT_CANDIDATES if Path(f).is_file()), None)


def clean_caption(text: str) -> str:
    """Bỏ mũi tên kiểu lập trình (Gemini hay sinh '->') và khoảng trắng thừa: font quảng cáo không có glyph mũi tên."""
    for arrow in ("->", "=>", "→", "➜", "➡"):
        text = text.replace(arrow, ": ")
    return " ".join(text.split()).replace(" :", ":")


def wrap_caption(text: str, width: int) -> str:
    """Ngắt dòng theo chiều rộng (số ký tự) để chữ không tràn khung dọc."""
    words, lines, cur = text.split(), [], ""
    for w in words:
        if cur and len(cur) + 1 + len(w) > width:
            lines.append(cur)
            cur = w
        else:
            cur = f"{cur} {w}".strip()
    if cur:
        lines.append(cur)
    return chr(10).join(lines)


def plan_segment(clip_seconds: float, beat: float | None, voice_seconds: float) -> tuple[float, float]:
    """(thời lượng đoạn, hệ số atempo cho tiếng). Đoạn không bao giờ dài hơn clip; lời dài hơn thì nới đoạn rồi mới tăng tốc đọc."""
    beat = clip_seconds if not beat or beat <= 0 else min(beat, clip_seconds)
    if voice_seconds <= 0:
        return beat, 1.0
    need = VOICE_LEAD + voice_seconds + VOICE_TAIL
    seconds = min(clip_seconds, max(beat, need))
    if need <= seconds:
        return seconds, 1.0
    return seconds, min(MAX_ATEMPO, max(1.0, (VOICE_LEAD + voice_seconds) / max(seconds - VOICE_TAIL, 0.5)))


def plan_speed(clip_seconds: float, seconds: float) -> float:
    """Nhịp ngắn hơn clip: tăng tốc cho trọn chuyển động trong nhịp (tối đa MAX_SPEED), phần dư (nếu có) bị cắt đuôi."""
    if seconds <= 0 or seconds >= clip_seconds - 0.05:
        return 1.0
    return min(MAX_SPEED, clip_seconds / seconds)


def resolve_bgm(track_ids: Any) -> list[tuple[str, Path]]:
    """[(tên, đường dẫn file)] của các bài trong Thư viện nhạc. Bài không còn trong thư viện/mất file thì báo lỗi rõ (không bỏ qua im lặng)."""
    ids = ([track_ids] if track_ids else []) if isinstance(track_ids, str) else [t for t in (track_ids or []) if t]
    if not ids:
        return []
    from app.db import SessionLocal
    from app.media import service as media
    out: list[tuple[str, Path]] = []
    db = SessionLocal()
    try:
        for tid in ids:
            track = media.get_track(db, str(tid))
            if track is None:
                raise AssembleError(f"Bài nhạc '{tid}' không còn trong Thư viện nhạc. Chọn bài khác hoặc bỏ nhạc nền.")
            path = Path(track.file_path)
            if not path.is_file() or not path.stat().st_size:
                raise AssembleError(f"File nhạc '{track.name}' không còn trên đĩa. Chọn bài khác hoặc bỏ nhạc nền.")
            out.append((track.name, path))
    finally:
        db.close()
    return out


def bgm_volume(params: dict[str, Any]) -> float:
    try:
        v = float(params.get("bgm_volume"))
    except (TypeError, ValueError):
        v = BGM_DEFAULT_VOLUME
    return max(0.02, min(0.6, v))


def mix_bgm(video: Path, tracks: list[Path], volume: float, total: float, work: Path) -> Path:
    """Trộn nhạc nền dưới tiếng đọc: nhạc lặp/nối cho đủ độ dài, hạ âm lượng, TỰ HẠ THÊM khi giọng đang nói (sidechain), fade vào và ra.
    Luồng hình giữ nguyên (copy), chỉ mã hóa lại âm thanh."""
    from app.recap.ffmpeg import build_smart_bgm_chain
    music = build_smart_bgm_chain(tracks, total, work / "bgm_chain.mp3", work) if len(tracks) > 1 else tracks[0]
    fade_start = max(0.0, total - BGM_FADE_OUT)
    graph = (f"[0:a]asplit=2[voice][sc];"
             f"[1:a]volume={volume:.3f},afade=t=in:d=1,afade=t=out:st={fade_start:.2f}:d={BGM_FADE_OUT}[bg];"
             f"[bg][sc]sidechaincompress=threshold=0.03:ratio=10:attack=15:release=350[duck];"
             f"[voice][duck]amix=inputs=2:duration=first:dropout_transition=0,volume=1.8,alimiter=limit=0.95[a]")
    out = work / "mixed.mp4"
    _run(["ffmpeg", "-y", "-i", video.name, "-stream_loop", "-1", "-i", str(music.resolve()), "-filter_complex", graph,
          "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-t", f"{total:.3f}",
          "-movflags", "+faststart", out.name], work)
    return out


def _run(cmd: list[str], cwd: Path) -> None:
    proc = subprocess.run(cmd, cwd=str(cwd), capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=TIMEOUT)
    if proc.returncode != 0:
        raise AssembleError(f"ffmpeg lỗi: {(proc.stderr or '')[-500:]}")


def caption_filters(work: Path, index: int, caption: str, size: tuple[int, int], style: str, color: str,
                    window: tuple[float, float] | None = None) -> list[str]:
    """Các filter drawtext cho một chú thích. File chữ ghi bằng write_bytes: write_text trên Windows đổi LF thành CRLF và drawtext coi CR là dòng trống."""
    w, h = size
    text = clean_caption(caption)
    if not text or style == "none":
        return []
    enable = f":enable='between(t,{window[0]:.3f},{window[1]:.3f})'" if window else ""
    t0 = f"(t-{window[0]:.3f})" if window else "t"
    lines = wrap_caption(text, 18 if w < h else 34).split(chr(10))
    if style == "box":                                       # kiểu cũ: một khối hộp đen (giữ làm tùy chọn)
        (work / f"cap_{index}.txt").write_bytes(chr(10).join(lines).encode("utf-8"))
        return [f"drawtext=fontfile=font.ttf:textfile=cap_{index}.txt:fontcolor=white:fontsize={max(18, round(w / 15))}"
                f":box=1:boxcolor=black@0.55:boxborderw={max(8, round(w / 45))}:line_spacing=8:x=(w-text_w)/2:y=h*{CAPTION_SAFE_BOTTOM}-text_h{enable}"]
    fs = max(18, round(w / 13))
    border = max(2, round(fs * 0.09))
    shadow = max(1, round(fs * 0.05))
    line_h = round(fs * 1.28)
    top = round(h * CAPTION_SAFE_BOTTOM) - len(lines) * line_h
    fill = CAPTION_COLORS.get(color, "white")
    out = []
    for k, line in enumerate(lines):                         # mỗi dòng một drawtext tự căn giữa (không phụ thuộc text_align của bản ffmpeg)
        (work / f"cap_{index}_{k}.txt").write_bytes(line.encode("utf-8"))
        out.append(f"drawtext=fontfile=font.ttf:textfile=cap_{index}_{k}.txt:fontcolor={fill}:fontsize={fs}:borderw={border}:bordercolor=black"
                   f":shadowcolor=black@0.6:shadowx={shadow}:shadowy={shadow + 1}:x=(w-text_w)/2:y={top + k * line_h}"
                   f":alpha='if(lt({t0},0.25),{t0}/0.25,1)'{enable}")
    return out


def build_segment(work: Path, index: int, clip: Path, seconds: float, atempo: float, voice: Path | None, caption: str,
                  size: tuple[int, int], has_font: bool, speed: float = 1.0, style: str = "pop", color: str = "white") -> Path:
    out = work / f"seg_{index}.mp4"
    w, h = size
    vf = [f"setpts=PTS/{speed:.4f}"] if speed > 1.001 else []
    vf += [f"scale={w}:{h}:force_original_aspect_ratio=decrease", f"pad={w}:{h}:(ow-iw)/2:(oh-ih)/2", "setsar=1", f"fps={FPS}", "format=yuv420p"]
    if has_font:
        vf += caption_filters(work, index, caption, size, style, color)
    cmd = ["ffmpeg", "-y", "-i", str(clip)]
    if voice is not None:
        cmd += ["-i", str(voice)]
        af = f"atempo={atempo:.3f}," if atempo > 1.001 else ""
        cmd += ["-filter_complex", f"[0:v]{','.join(vf)}[v];[1:a]{af}adelay={int(VOICE_LEAD * 1000)}|{int(VOICE_LEAD * 1000)},apad[a]",
                "-map", "[v]", "-map", "[a]"]
    else:
        cmd += ["-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo", "-filter_complex", f"[0:v]{','.join(vf)}[v]", "-map", "[v]", "-map", "1:a"]
    cmd += ["-t", f"{seconds:.3f}", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-r", str(FPS), "-c:a", "aac", "-ar", "48000", "-ac", "2",
            "-shortest", out.name]
    _run(cmd, work)
    return out


def join_segments(work: Path, segments: list[Path], transition: str) -> Path:
    """Nối các đoạn: cắt cứng (concat, copy luồng) hoặc chuyển cảnh xfade + acrossfade (mã hóa lại một lần)."""
    final = work / "final.mp4"
    name = TRANSITIONS.get(transition)
    if name is None or len(segments) < 2:
        (work / "list.txt").write_bytes("".join(f"file '{s.name}'" + chr(10) for s in segments).encode("utf-8"))
        _run(["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", "list.txt", "-c", "copy", "-movflags", "+faststart", final.name], work)
        return final
    td = TRANSITION_SECONDS
    durations = [probe(s)["duration"] for s in segments]
    parts, cur_v, cur_a, running = [], "[0:v]", "[0:a]", durations[0]
    for i in range(1, len(segments)):
        parts.append(f"{cur_v}[{i}:v]xfade=transition={name}:duration={td}:offset={running - td:.3f}[v{i}]")
        parts.append(f"{cur_a}[{i}:a]acrossfade=d={td}[a{i}]")
        cur_v, cur_a = f"[v{i}]", f"[a{i}]"
        running += durations[i] - td
    cmd = ["ffmpeg", "-y"]
    for s in segments:
        cmd += ["-i", s.name]
    cmd += ["-filter_complex", ";".join(parts), "-map", cur_v, "-map", cur_a, "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
            "-pix_fmt", "yuv420p", "-c:a", "aac", "-ar", "48000", "-ac", "2", "-movflags", "+faststart", final.name]
    _run(cmd, work)
    return final


def render_cut(work: Path, name: str, clip: Path, src_start: float, seconds: float, speed: float, punch: float, focus: float, size: tuple[int, int]) -> Path:
    """Một cú cắt câm: lấy đoạn nguồn, phát nhanh theo `speed`, phóng số `punch` quanh vùng `focus`."""
    w, h = size
    out = work / name
    vf = [f"setpts=PTS/{speed:.4f}", f"scale={w}:{h}:force_original_aspect_ratio=decrease", f"pad={w}:{h}:(ow-iw)/2:(oh-ih)/2"]
    if punch > 1.001:
        vf += [f"crop=iw/{punch:.3f}:ih/{punch:.3f}:(iw-iw/{punch:.3f})/2:(ih-ih/{punch:.3f})*{focus:.2f}", f"scale={w}:{h}:flags=lanczos"]
    vf += ["setsar=1", f"fps={FPS}", "format=yuv420p"]
    _run(["ffmpeg", "-y", "-ss", f"{src_start:.3f}", "-i", str(clip), "-vf", ",".join(vf), "-t", f"{seconds:.3f}", "-an", "-c:v", "libx264", "-preset", "veryfast",
          "-crf", "18", "-r", str(FPS), out.name], work)
    return out


def finish_micro(work: Path, cuts: list[Path], slots: list[dict[str, Any]], size: tuple[int, int], style: str, color: str, has_font: bool) -> Path:
    """Nối các cú cắt, đặt lời thoại từng shot vào đúng khoảng của nó và in chữ theo thời gian."""
    (work / "cuts.txt").write_bytes("".join(f"file '{c.name}'" + chr(10) for c in cuts).encode("utf-8"))
    _run(["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", "cuts.txt", "-c", "copy", "visual.mp4"], work)
    final = work / "final.mp4"
    cmd = ["ffmpeg", "-y", "-i", "visual.mp4"]
    graph, labels, next_input = [], [], 1
    lead = int(VOICE_LEAD * 1000)
    fmt = "aformat=sample_rates=48000:channel_layouts=stereo"
    for i, slot in enumerate(slots):
        length = slot["end"] - slot["start"]
        if slot["voice"] is not None:
            cmd += ["-i", str(slot["voice"])]
            tempo = f"atempo={slot['atempo']:.3f}," if slot["atempo"] > 1.001 else ""
            graph.append(f"[{next_input}:a]{tempo}adelay={lead}|{lead},apad,atrim=0:{length:.3f},asetpts=PTS-STARTPTS,{fmt}[a{i}]")
            next_input += 1
        else:
            graph.append(f"anullsrc=r=48000:cl=stereo,atrim=0:{length:.3f},{fmt}[a{i}]")
        labels.append(f"[a{i}]")
    graph.append("".join(labels) + f"concat=n={len(labels)}:v=0:a=1[a]")
    drawn: list[str] = []
    if has_font:
        for i, slot in enumerate(slots):
            drawn += caption_filters(work, i, slot["text"], size, style, color, (slot["start"], slot["end"]))
    graph.append(f"[0:v]{','.join(drawn) if drawn else 'null'}[v]")
    cmd += ["-filter_complex", ";".join(graph), "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-preset", "veryfast", "-crf", "19", "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-ar", "48000", "-ac", "2", "-movflags", "+faststart", final.name]
    _run(cmd, work)
    return final


def build_micro(ctx: ExecContext, work: Path, shots: list[dict[str, Any]], script: dict[str, Any], clips: dict[str, Any], voices: dict[str, Any],
                bgm: list[tuple[str, Path]], size: tuple[int, int], style: str, color: str, has_font: bool) -> tuple[Path, list[dict[str, Any]], dict[str, Any]]:
    """Kiểu dựng micro-cut: hình cắt ngắn theo nhịp nhạc nhưng lời thoại và chữ của mỗi shot vẫn nằm trọn trong khoảng của shot đó."""
    target = edit_plan.clamp_cut(ctx.params.get("cut_seconds"))
    rough = sum(probe(Path(clips[s["key"]]["path"]))["duration"] for s in shots)
    grid = edit_plan.detect_beats(bgm[0][1], rough) if bgm else None
    beats = grid.times(rough) if grid else []
    if grid:                                               # cắt mỗi N phách, N chọn để cú cắt gần độ dài mong muốn nhất
        step = max(1, round(target / grid.period))
        beats = beats[::step]
    cuts: list[Path] = []
    slots: list[dict[str, Any]] = []
    report: list[dict[str, Any]] = []
    cursor = 0.0
    for i, shot in enumerate(shots):
        if ctx.cancelled():
            raise AssembleError("Đã hủy.")
        key = shot["key"]
        clip_path = Path(clips[key]["path"])
        clip_seconds = probe(clip_path)["duration"]
        voice_ref = voices.get(key)
        voice_path = Path(voice_ref["path"]) if voice_ref else None
        seconds, atempo = plan_segment(clip_seconds, target * 2, audio_seconds(voice_path) if voice_path else 0.0)
        end = edit_plan.snap_up(cursor + seconds, beats, cursor + clip_seconds)
        speed = max(1.0, min(edit_plan.PLAY_SPEED, clip_seconds / max(end - cursor, 0.1)))
        parts = edit_plan.split_slot(cursor, end, target, beats)
        curve, dt = edit_plan.motion_curve(clip_path)
        lengths = [(b - a) * speed for a, b in parts]
        starts = edit_plan.pick_windows(curve, dt, clip_seconds, lengths)
        ctx.report(f"Đang dựng {key}: {len(parts)} cú cắt…")
        archetype, framing = str(shot.get("archetype") or "hero"), str(shot.get("framing") or "medium")
        for k, ((a, b), src) in enumerate(zip(parts, starts)):
            cuts.append(render_cut(work, f"cut_{i}_{k}.mp4", clip_path, src, b - a, speed, edit_plan.punch_for(archetype, k),
                                   edit_plan.focus_for(archetype, framing), size))
        text = str((script.get(key) or {}).get("on_screen_text") or shot.get("on_screen_text") or "")
        slots.append({"start": cursor, "end": end, "voice": voice_path, "atempo": atempo, "text": text})
        report.append({"shot": key, "seconds": round(end - cursor, 2), "atempo": round(atempo, 3), "speed": round(speed, 3), "cuts": len(parts),
                       "voice": voice_path is not None, "caption": bool(clean_caption(text) and has_font and style != "none")})
        cursor = end
    ctx.report("Đang nối các cú cắt, đặt lời thoại và chữ…")
    final = finish_micro(work, cuts, slots, size, style, color, has_font)
    return final, report, {"cuts": len(cuts), "cut_seconds": target, "beat_period": round(grid.period, 3) if grid else None}


# Cờ nội bộ chỉ do campaign/exports.py đặt khi tạo bản tải phụ (không phải tham số người dùng lưu ở bước ghép):
EXPORT_CLEAN = "_export_clean"        # xóa watermark trên từng clip gốc trước khi dựng
EXPORT_NO_BGM = "_export_no_bgm"      # bỏ nhạc nền, giữ tiếng đọc và phụ đề


def clean_clips(ctx: ExecContext, shots: list[dict[str, Any]], clips: dict[str, Any]) -> tuple[dict[str, Any], dict[str, int]]:
    """Xóa watermark Gemini/Veo trên TỪNG clip gốc trước khi dựng (gwr chỉ nhận ra watermark ở khung hình gốc của Flow;
    trên video đã ghép, crop/phóng làm nó dừng vì độ tin cậy thấp). Bản sạch lưu đệm theo mã nội dung clip: ghép lại
    (đổi phụ đề, nhạc...) không phải xóa lại. Clip nào lỗi thì dừng hẳn, không lặng lẽ ghép bản còn watermark."""
    from app.watermark import service as wm

    cache = ctx.store.campaign_dir(ctx.campaign_id) / "cache" / "watermark"
    out: dict[str, Any] = {}
    stats = {"removed": 0, "cached": 0}
    for i, shot in enumerate(shots):
        if ctx.cancelled():
            raise AssembleError("Đã hủy.")
        key = shot["key"]
        ref = clips[key]
        src = Path(ref["path"])
        digest = str(ref.get("content_hash") or "") or uuid.uuid4().hex
        target = cache / f"{digest}.mp4"
        if target.is_file() and target.stat().st_size > 0:
            stats["cached"] += 1
        else:
            label = f"Đang xóa watermark {key} ({i + 1}/{len(shots)})"
            ctx.report(label + "…")
            try:
                wm.remove_video_watermark_sync(
                    src, target,
                    on_progress=lambda done, total, _l=label: ctx.report(f"{_l}: {round(100 * done / total) if total else done}%"),
                    cancelled=ctx.cancelled)
            except (wm.WatermarkVideoError, wm.WatermarkRuntimeUnavailableError, FileNotFoundError) as exc:
                raise AssembleError(f"Xóa watermark {key} lỗi: {exc}. Bản gốc (còn watermark) vẫn tải được bình thường.") from exc
            stats["removed"] += 1
        out[key] = {**ref, "path": str(target)}
    return {**clips, **out}, stats


def run_assemble(ctx: ExecContext) -> ExecResult:
    shots = [s for s in (load_input(ctx.inputs, "shot_plan").get("items") or []) if s.get("key")]
    script = {str(i.get("shot")): i for i in (load_input(ctx.inputs, "script").get("items") or [])}
    clips = {r.get("element_key"): r for r in (ctx.inputs.get("clip") or [])}
    voices = {r.get("role"): r for r in (ctx.inputs.get("voice") or [])}
    if not shots:
        raise AssembleError("Chưa có danh sách shot.")
    missing = [s["key"] for s in shots if s["key"] not in clips]
    if missing:
        raise AssembleError("Thiếu clip đã duyệt cho: " + ", ".join(missing))

    bgm = resolve_bgm(ctx.params.get("bgm"))            # kiểm tra nhạc nền TRƯỚC khi ghép: lỗi thì dừng sớm, không tốn công
    volume = bgm_volume(ctx.params)
    style = str(ctx.params.get("caption_style") or "pop")
    style = style if style in CAPTION_STYLES else "pop"
    color = str(ctx.params.get("caption_color") or "white")
    color = color if color in CAPTION_COLORS else "white"
    transition = str(ctx.params.get("transition") or "cut")
    transition = transition if transition in TRANSITIONS else "cut"
    edit_style = str(ctx.params.get("edit_style") or "shots")
    edit_style = edit_style if edit_style in EDIT_STYLES else "shots"
    extra: dict[str, Any] = {}
    if ctx.params.get(EXPORT_NO_BGM):
        bgm = []
        extra["no_bgm"] = True
    if ctx.params.get(EXPORT_CLEAN):
        clips, wm_stats = clean_clips(ctx, shots, clips)
        extra["watermark_removed"] = True
        extra["watermark"] = wm_stats
    work = ctx.store.campaign_dir(ctx.campaign_id) / "tmp" / f"asm_{uuid.uuid4().hex[:10]}"
    work.mkdir(parents=True, exist_ok=True)
    try:
        font = find_font()
        if font is not None:
            shutil.copyfile(font, work / "font.ttf")
        # Clip có thể lẫn 360p và 720p (user tự chọn từng shot): ghép theo clip lớn nhất để không thu nhỏ bản 720p.
        biggest = max((probe(Path(clips[sh["key"]]["path"])) for sh in shots), key=lambda i: i["width"] * i["height"])
        size = (int(biggest["width"]) // 2 * 2, int(biggest["height"]) // 2 * 2)
        if edit_style == "micro":
            final, report, extra = build_micro(ctx, work, shots, script, clips, voices, bgm, size, style, color, font is not None)
        else:
            segments, report = [], []
            for i, shot in enumerate(shots):
                if ctx.cancelled():
                    raise AssembleError("Đã hủy.")
                key = shot["key"]
                clip_path = Path(clips[key]["path"])
                clip_seconds = probe(clip_path)["duration"]
                voice_ref = voices.get(key)
                voice_path = Path(voice_ref["path"]) if voice_ref else None
                seconds, atempo = plan_segment(clip_seconds, shot.get("beat_seconds"), audio_seconds(voice_path) if voice_path else 0.0)
                speed = plan_speed(clip_seconds, seconds)
                text = str((script.get(key) or {}).get("on_screen_text") or shot.get("on_screen_text") or "")
                ctx.report(f"Đang ghép {key} ({i + 1}/{len(shots)})…")
                segments.append(build_segment(work, i, clip_path, seconds, atempo, voice_path, text, size, font is not None, speed, style, color))
                report.append({"shot": key, "seconds": round(seconds, 2), "atempo": round(atempo, 3), "speed": round(speed, 3),
                               "voice": voice_path is not None, "caption": bool(clean_caption(text) and font is not None and style != "none")})
            ctx.report("Đang nối các đoạn thành video hoàn chỉnh…" if transition == "cut" else "Đang nối các đoạn với chuyển cảnh…")
            final = join_segments(work, segments, transition)
        total = probe(final)["duration"]
        if bgm:
            ctx.report("Đang trộn nhạc nền dưới tiếng đọc…")
            final = mix_bgm(final, [p for _, p in bgm], volume, total, work)
        data = final.read_bytes()
    finally:
        shutil.rmtree(work, ignore_errors=True)
    return ExecResult([ArtifactSpec("video", ext="mp4", data=data, meta={
        "seconds": round(total, 2), "size": f"{size[0]}x{size[1]}", "shots": report, "with_voice": any(r["voice"] for r in report),
        "font": font.name if font else None, "caption_style": style, "caption_color": color, "transition": transition, "edit_style": edit_style, **extra,
        "bgm": [n for n, _ in bgm], "bgm_volume": volume if bgm else None})])

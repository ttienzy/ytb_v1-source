"""FFmpeg helpers — Phase R2 cut (stream-copy) + Phase R4 mux/concat.

R2 ``cut_segment``: ``-ss`` trước ``-i`` (input seek, nhanh — nhảy tới keyframe gần nhất)
+ ``-t`` (output duration) + ``-c copy``: cắt gần như tức thì (<1s/đoạn). Tradeoff: điểm
bắt đầu lệch tối đa ~2-5s do keyframe spacing YouTube DASH — chấp nhận vì R4 thay audio gốc.

R3 voice: VO TTS ghi thô ``voice_i.wav`` ở tốc độ tự nhiên (KHÔNG atempo kéo giãn — giọng
nghe mượt). R4 merge dùng ``ffprobe_duration`` lấy voice_dur thật → re-cut ``clip_i`` theo
``[start, start+voice_dur]`` từ source (mở rộng cho intro/outro, lược bớt khi VO ngắn) →
``mux_segment`` (``-shortest`` vô hại vì clip đã khớp voice) → concat. Idempotent.
"""
from __future__ import annotations

import random
import subprocess
import threading
from pathlib import Path

TIMEOUT = 120  # mỗi đoạn — stream-copy rất nhanh; atempo re-encode audio WAV cũng chỉ vài giây.
TIMEOUT_MUX = 300  # mux 1 segment: video copy + audio aac, nhanh.
TIMEOUT_CONCAT = 1800  # concat 25 segment (stream-copy) — có thể chậm với file lớn.
TIMEOUT_PROBE = 30
TIMEOUT_POLISH = 1800  # polish: BGM amix + video copy (KHÔNG re-encode video) — nhanh, vài giây.


def ffprobe_duration(path: Path) -> float:
    """Đo duration (giây) của media file bằng ffprobe (đi kèm ffmpeg).

    Dùng trong R4 merge để lấy voice_dur thật → re-cut clip đúng khung (VO drives
    duration). Trả 0.0 nếu ffprobe không đọc được.
    """
    cmd = [
        "ffprobe", "-v", "error",
        "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1",
        str(path),
    ]
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=TIMEOUT_PROBE)
    except (subprocess.SubprocessError, FileNotFoundError):
        return 0.0
    out = (proc.stdout or "").strip()
    try:
        return float(out) if out else 0.0
    except ValueError:
        return 0.0


def cut_segment(video: Path, start_sec: float, end_sec: float, out: Path) -> Path:
    """Cắt [start, end] giây từ video → out (mp4, frame-accurate libx264). Skip nếu đã có."""
    if out.exists() and out.stat().st_size:
        return out
    out.parent.mkdir(parents=True, exist_ok=True)
    dur = max(0.0, end_sec - start_sec)
    cmd = [
        "ffmpeg", "-y",
        "-ss", f"{start_sec:.3f}",
        "-i", str(video),
        "-t", f"{dur:.3f}",
        "-vf", "setpts=PTS-STARTPTS",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
        "-an",
        str(out),
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=TIMEOUT)
    if proc.returncode != 0 or not out.exists() or not out.stat().st_size:
        raise RuntimeError(f"ffmpeg cut thất bại [{out.name}]: {(proc.stderr or '')[-400:]}")
    return out


def _atempo_chain(factor: float) -> list[float]:
    """[deprecated] Giữ lại cho test/forward-compat — không còn dùng trong R3 (voice
    chạy tốc độ tự nhiên, không kéo giãn). Phân rã factor về list atempo ∈ [0.5, 2.0]."""
    factors: list[float] = []
    f = factor
    while f > 2.0:
        factors.append(2.0)
        f /= 2.0
    while f < 0.5:
        factors.append(0.5)
        f /= 0.5
    factors.append(round(f, 4))
    return factors


def mux_segment(clip: Path, voice: Path, out: Path) -> Path:
    """Ghép clip (video-only) + VO (wav) → mp4 có cả video+audio (R4).

    Audio encode aac, tự động pad audio (apad) nếu clip dài hơn VO để giữ trọn vẹn cảnh quay.
    """
    if out.exists() and out.stat().st_size:
        return out
    out.parent.mkdir(parents=True, exist_ok=True)
    clip_dur = ffprobe_duration(clip)
    cmd = [
        "ffmpeg", "-y",
        "-i", str(clip), "-i", str(voice),
        "-map", "0:v:0", "-map", "1:a:0",
        "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
        "-af", "apad",
        "-t", f"{clip_dur:.3f}",
        str(out),
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=TIMEOUT_MUX)
    if proc.returncode != 0 or not out.exists() or not out.stat().st_size:
        raise RuntimeError(f"ffmpeg mux thất bại [{out.name}]: {(proc.stderr or '')[-400:]}")
    return out


def cut_and_mux_segment(
    source_video: Path,
    start_sec: float,
    end_sec: float,
    voice_wav: Path,
    out_seg: Path,
) -> Path:
    """Cắt trực tiếp từ source video theo [start, end] và mux với voice_wav (Frame-accurate, 1 pass duy nhất)."""
    if out_seg.exists() and out_seg.stat().st_size:
        return out_seg
    out_seg.parent.mkdir(parents=True, exist_ok=True)
    dur = max(0.1, end_sec - start_sec)
    cmd = [
        "ffmpeg", "-y",
        "-ss", f"{start_sec:.3f}",
        "-i", str(source_video),
        "-i", str(voice_wav),
        "-t", f"{dur:.3f}",
        "-map", "0:v:0", "-map", "1:a:0",
        "-vf", "setpts=PTS-STARTPTS",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
        "-c:a", "aac", "-b:a", "192k",
        "-af", "apad",
        str(out_seg),
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=TIMEOUT_MUX)
    if proc.returncode != 0 or not out_seg.exists() or not out_seg.stat().st_size:
        raise RuntimeError(f"ffmpeg cut_and_mux thất bại [{out_seg.name}]: {(proc.stderr or '')[-400:]}")
    return out_seg


def concat_segments(segments: list[Path], out: Path, work_dir: Path) -> Path:
    """Concat list seg_i.mp4 → final mp4 (concat demuxer + stream-copy).

    Dùng path dạng POSIX (forward-slash) trong concat list để ffmpeg Windows đọc ổn.
    Idempotent: đã có final → skip.
    """
    if out.exists() and out.stat().st_size:
        return out
    out.parent.mkdir(parents=True, exist_ok=True)
    work_dir.mkdir(parents=True, exist_ok=True)
    lst = work_dir / "concat_list.txt"
    # concat demuxer: mỗi dòng "file 'path'" — escape dấu nháy đơn.
    lines = []
    for p in segments:
        posix = p.as_posix().replace("'", "'\\''")
        lines.append(f"file '{posix}'")
    lst.write_text("\n".join(lines), encoding="utf-8")
    cmd = [
        "ffmpeg", "-y",
        "-f", "concat", "-safe", "0",
        "-i", str(lst),
        "-c", "copy",
        str(out),
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=TIMEOUT_CONCAT)
    if proc.returncode != 0 or not out.exists() or not out.stat().st_size:
        raise RuntimeError(f"ffmpeg concat thất bại: {(proc.stderr or '')[-500:]}")
    return out


def build_smart_bgm_chain(
    bgm_paths: list[Path],
    target_duration: float,
    out_chain: Path,
    work_dir: Path,
) -> Path:
    """Xây dựng chuỗi BGM phủ kín target_duration từ danh sách bgm_paths do user chọn.

    Nếu tổng thời lượng các bài đã chọn < target_duration:
      - Bắt đầu chuỗi bằng danh sách user chọn theo thứ tự.
      - Tiếp tục switch ngẫu nhiên (chọn từ pool bgm_paths, tránh lặp bài liền kề nếu >1 bài)
        cho đến khi tổng thời lượng chuỗi >= target_duration + 10s.
      - Concat lại thành 1 file out_chain (mp3, stream-copy).
    """
    if not bgm_paths:
        raise ValueError("bgm_paths không được rỗng.")

    if out_chain.exists() and out_chain.stat().st_size > 0:
        return out_chain

    # Đo thời lượng từng bài
    track_durs = {p: ffprobe_duration(p) for p in bgm_paths}

    # Bắt đầu chuỗi với danh sách ban đầu
    playlist = list(bgm_paths)
    current_dur = sum(track_durs.get(p, 0.0) for p in playlist)

    if len(bgm_paths) > 1 and current_dur < target_duration + 10.0:
        while current_dur < target_duration + 10.0:
            # Chọn ngẫu nhiên trong pool bgm_paths, ưu tiên bài khác bài vừa phát
            candidates = [p for p in bgm_paths if p != playlist[-1]] or bgm_paths
            next_p = random.choice(candidates)
            playlist.append(next_p)
            current_dur += track_durs.get(next_p, 0.0)

    work_dir.mkdir(parents=True, exist_ok=True)
    out_chain.parent.mkdir(parents=True, exist_ok=True)

    lst = work_dir / "bgm_concat_list.txt"
    lines = [f"file '{p.as_posix().replace(chr(39), chr(39) + chr(92) + chr(39) + chr(39))}'" for p in playlist]
    lst.write_text("\n".join(lines), encoding="utf-8")

    cmd_chain = [
        "ffmpeg", "-y",
        "-f", "concat", "-safe", "0",
        "-i", str(lst),
        "-c", "copy",
        str(out_chain),
    ]
    proc = subprocess.run(
        cmd_chain,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=TIMEOUT_CONCAT,
    )
    if proc.returncode != 0 or not out_chain.exists() or not out_chain.stat().st_size:
        raise RuntimeError(f"ffmpeg BGM concat thất bại: {(proc.stderr or '')[-400:]}")
    return out_chain


def polish_final(
    src: Path,
    out: Path,
    bgm_paths: list[Path] | None = None,
    volume: float = 0.10,
    work_dir: Path | None = None,
    progress_cb: Callable[[float, float], None] | None = None,
) -> Path:
    """Hậu xử lý R5 (Polish): amix BGM dưới VO (ducked) + copy video stream (nhanh).

    Xử lý:
    1. Nếu có >1 track BGM: xây dựng chuỗi BGM thông minh tự switch ngẫu nhiên (build_smart_bgm_chain).
    2. Nếu 1 track BGM: loop liên tục bài đó qua -stream_loop -1.
    3. Mix pass: amix BGM (volume=0.10) dưới VO + copy video stream -> final_studio.mp4.
    """
    if out.exists() and out.stat().st_size:
        return out
    if not bgm_paths:
        raise RuntimeError("polish_final: cần bgm_paths (ít nhất 1 track).")
    # Resolve tuyệt đối (tránh phụ thuộc cwd của caller).
    src = src.resolve()
    out = out.resolve()
    bgm_paths = [p.resolve() for p in bgm_paths]
    out.parent.mkdir(parents=True, exist_ok=True)
    if work_dir:
        work_dir.mkdir(parents=True, exist_ok=True)
    wd = work_dir or out.parent

    total_dur = ffprobe_duration(src)

    # 1. Pre-concat / Smart switch BGM chain
    if len(bgm_paths) > 1:
        bgm_chain = wd / "bgm_chain.mp3"
        bgm_input = build_smart_bgm_chain(bgm_paths, total_dur, bgm_chain, wd)
    else:
        bgm_input = bgm_paths[0]

    # 2. Mix pass: video copy + audio amix (BGM ducked dưới VO).
    filter_complex = (
        f"[1:a]volume={volume:.3f}[bg];"
        "[0:a][bg]amix=inputs=2:duration=first:dropout_transition=0[a]"
    )
    cmd = [
        "ffmpeg", "-y",
        "-i", str(src),
        "-stream_loop", "-1", "-i", str(bgm_input),
        "-filter_complex", filter_complex,
        "-map", "0:v", "-map", "[a]",
        "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest",
        "-progress", "pipe:1",
        "-nostats",
        str(out),
    ]
    proc = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",
        errors="replace",
    )

    # Drain stderr trong thread riêng để tránh deadlock khi pipe buffer đầy.
    # (for loop đọc hết stdout rồi mới gọi proc.wait() — nếu stderr không được drain
    # thì ffmpeg block khi ghi stderr → toàn bộ treo vĩnh viễn).
    stderr_lines: list[str] = []
    def _drain_stderr() -> None:
        if proc.stderr:
            for ln in proc.stderr:
                stderr_lines.append(ln)
    t_err = threading.Thread(target=_drain_stderr, daemon=True)
    t_err.start()

    last_update = 0.0
    if proc.stdout:
        for line in proc.stdout:
            line = line.strip()
            if line.startswith("out_time_us=") or line.startswith("out_time_ms="):
                try:
                    us_val = int(line.split("=")[1])
                    cur_sec = us_val / 1_000_000 if line.startswith("out_time_us=") else us_val / 1_000
                    if progress_cb and total_dur > 0:
                        if abs(cur_sec - last_update) >= 0.25:
                            last_update = cur_sec
                            progress_cb(min(cur_sec, total_dur), total_dur)
                except (ValueError, IndexError):
                    pass

    # Chờ FFmpeg thoát và thread drain stderr xong.
    proc.wait(timeout=TIMEOUT_POLISH)
    t_err.join(timeout=5)
    stderr_text = "".join(stderr_lines)

    if proc.returncode != 0 or not out.exists() or not out.stat().st_size:
        raise RuntimeError(f"ffmpeg polish thất bại: {stderr_text[-500:]}")

    if progress_cb and total_dur > 0:
        progress_cb(total_dur, total_dur)

    return out

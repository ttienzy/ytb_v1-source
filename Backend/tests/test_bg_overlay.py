"""
test_bg_overlay.py — Test ghep video len background image (letterbox style).

Layout:
    OUTPUT: 1920 x 1080 (same as clip)
    BG    : bg_demo.png scale + crop to 1920x1080
    VIDEO : scale to 1920 x 810 (75% height), overlay centered (y=135)
    Bars  : top 135px + bottom 135px = background show-through

Chay:
    .venv\Scripts\python tests\test_bg_overlay.py
Output:
    D:\GOOGLE SEARCH\tools\test_bg_overlay_out.mp4
"""

import subprocess
import sys
from pathlib import Path

# --- Paths ---
BG    = Path(r"D:\GOOGLE SEARCH\tools\bg_demo.png")
CLIP  = Path(r"D:\GOOGLE SEARCH\tools\Backend\Data\Downloads\32da1e3e5751\clips\clip_0.mp4")
OUT   = Path(r"D:\GOOGLE SEARCH\tools\test_bg_overlay_out.mp4")

# --- Output config ---
OUT_W = 1920
OUT_H = 1080
BAR_H = 135          # top & bottom bar height (px)
VID_H = OUT_H - BAR_H * 2   # 810px — video height after scale
VID_Y = BAR_H               # overlay Y position

def probe_video(path: Path) -> dict:
    import json
    r = subprocess.run(
        ["ffprobe", "-v", "quiet", "-print_format", "json", "-show_streams", str(path)],
        capture_output=True, text=True
    )
    d = json.loads(r.stdout)
    v = next(s for s in d["streams"] if s["codec_type"] == "video")
    return {"w": int(v["width"]), "h": int(v["height"]), "dur": float(v.get("duration", 0))}


def build_filter(out_w: int, out_h: int, vid_h: int, vid_y: int) -> str:
    """
    Filter graph:
      [0:v] = background image (loop)
      [1:v] = video clip

    Steps:
      1. bg  → scale+crop to out_w x out_h
      2. vid → scale to out_w x vid_h (keep aspect, pad if needed)
      3. overlay vid on bg at y=vid_y
    """
    return (
        # Step 1: BG scale to fill, then crop center
        f"[0:v]scale={out_w}:{out_h}:force_original_aspect_ratio=increase,"
        f"crop={out_w}:{out_h}[bg];"

        # Step 2: Video scale to fit width, keep aspect ratio
        f"[1:v]scale={out_w}:{vid_h}:force_original_aspect_ratio=decrease,"
        f"pad={out_w}:{vid_h}:(ow-iw)/2:(oh-ih)/2[fg];"

        # Step 3: Overlay fg on bg at center vertically
        f"[bg][fg]overlay=0:{vid_y}"
    )


def run_ffmpeg(bg: Path, clip: Path, out: Path, out_w: int, out_h: int, vid_h: int, vid_y: int):
    filt = build_filter(out_w, out_h, vid_h, vid_y)

    cmd = [
        "ffmpeg", "-y",
        "-loop", "1", "-i", str(bg),   # input 0: background (loop)
        "-i", str(clip),               # input 1: video clip
        "-filter_complex", filt,
        "-map", "0:v",                 # dummy - actually remapped by filter
        "-filter_complex", filt,
        "-map", "[out]" if "[out]" in filt else None,
        "-map", "1:a?",                # audio from clip (optional)
        "-c:v", "libx264",
        "-preset", "fast",
        "-crf", "23",
        "-c:a", "aac",
        "-shortest",
        str(out),
    ]

    # Build clean command (remove None)
    cmd = [
        "ffmpeg", "-y",
        "-loop", "1", "-framerate", "30", "-i", str(bg),
        "-i", str(clip),
        "-filter_complex", filt,
        "-map", "1:a?",
        "-c:v", "libx264", "-preset", "fast", "-crf", "23",
        "-c:a", "aac",
        "-shortest",
        str(out),
    ]

    print("\nFFmpeg command:")
    print(" ".join(f'"{x}"' if " " in str(x) else str(x) for x in cmd))
    print()

    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        print("STDERR:", result.stderr[-2000:])
        raise RuntimeError(f"FFmpeg failed (exit {result.returncode})")
    return result


def main():
    # --- Verify inputs ---
    assert BG.exists(),   f"BG not found: {BG}"
    assert CLIP.exists(), f"Clip not found: {CLIP}"
    print(f"BG   : {BG}")
    print(f"Clip : {CLIP}")
    print(f"Out  : {OUT}")

    info = probe_video(CLIP)
    print(f"\nClip info: {info['w']}x{info['h']}, duration={info['dur']:.1f}s")
    print(f"Layout   : {OUT_W}x{OUT_H}, video area={OUT_W}x{VID_H} at y={VID_Y}")
    print(f"Bars     : top={BAR_H}px, bottom={BAR_H}px")

    OUT.parent.mkdir(parents=True, exist_ok=True)

    import time
    t0 = time.time()
    print("\nRunning FFmpeg...")
    run_ffmpeg(BG, CLIP, OUT, OUT_W, OUT_H, VID_H, VID_Y)
    elapsed = time.time() - t0

    assert OUT.exists() and OUT.stat().st_size > 0, "Output file empty!"
    size_mb = OUT.stat().st_size / 1024 / 1024

    print(f"\n=== DONE ===")
    print(f"Output : {OUT}")
    print(f"Size   : {size_mb:.1f} MB")
    print(f"Time   : {elapsed:.1f}s")
    print(f"\nMo file kiem tra: start {OUT}")


if __name__ == "__main__":
    try:
        main()
        sys.exit(0)
    except Exception as e:
        print(f"\nFAIL: {e}")
        sys.exit(1)

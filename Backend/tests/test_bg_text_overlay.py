"""
test_bg_text_overlay.py
BG + video overlay + drawtext top/bottom (scene_title & vietnamese_vo)
Uses textfile= to avoid shell encoding issues with Vietnamese text.
"""
import json, subprocess, sys, tempfile, os
from pathlib import Path

JOB_ID  = "d70078a320a5"
JOB_DIR = Path(r"D:\GOOGLE SEARCH\tools\Backend\Data\Downloads") / JOB_ID
FINAL   = JOB_DIR / "final_recap.mp4"
RECAP   = JOB_DIR / "recap.json"
BG      = Path(r"D:\GOOGLE SEARCH\tools\bg_demo.png")
OUT     = Path(r"D:\GOOGLE SEARCH\tools\test_bg_text_out.mp4")

OUT_W, OUT_H = 1920, 1080
BAR_H = 130
VID_H = OUT_H - BAR_H * 2   # 820

def load_texts():
    recap  = json.loads(RECAP.read_text("utf-8"))
    scene  = recap["scenes"][0]
    seg    = scene["segments"][0]
    title  = scene.get("scene_title", "Scene 1")
    vo     = seg.get("vietnamese_vo", "")
    return title, vo

def truncate(t: str, n: int = 60) -> str:
    return t if len(t) <= n else t[:n-1] + "..."

def write_tmp(text: str) -> str:
    f = tempfile.NamedTemporaryFile(mode="w", encoding="utf-8",
                                    suffix=".txt", delete=False)
    f.write(text); f.close()
    return f.name

def build_filter(top_file: str, bot_file: str) -> str:
    top_y = BAR_H // 2          # center of top bar = 65
    bot_y = OUT_H - BAR_H // 2  # center of bot bar = 1015

    return (
        # 1. BG scale+crop
        f"[1:v]scale={OUT_W}:{OUT_H}:force_original_aspect_ratio=increase,"
        f"crop={OUT_W}:{OUT_H}[bg];"

        # 2. Video scale fit + pad
        f"[0:v]scale={OUT_W}:{VID_H}:force_original_aspect_ratio=decrease,"
        f"pad={OUT_W}:{VID_H}:(ow-iw)/2:(oh-ih)/2[fg];"

        # 3. Overlay
        f"[bg][fg]overlay=0:{BAR_H},"

        # 4. Top text: scene_title, yellow, 46px
        f"drawtext="
        f"textfile='{top_file.replace(chr(92), '/')}'"
        f":x=(w-tw)/2:y={top_y}-(th/2)"
        f":fontsize=46:fontcolor=FFD700:borderw=3:bordercolor=000000,"

        # 5. Bottom text: vo, white, 36px
        f"drawtext="
        f"textfile='{bot_file.replace(chr(92), '/')}'"
        f":x=(w-tw)/2:y={bot_y}-(th/2)"
        f":fontsize=36:fontcolor=FFFFFF:borderw=2:bordercolor=000000"
    )

def run():
    assert BG.exists(),    f"BG missing: {BG}"
    assert FINAL.exists(), f"Final missing: {FINAL}"

    title, vo = load_texts()
    title_t = truncate(title, 55)
    vo_t    = truncate(vo, 70)

    print(f"Title : {title_t}")
    print(f"VO    : {vo_t}")

    top_f = write_tmp(title_t)
    bot_f = write_tmp(vo_t)

    try:
        filt = build_filter(top_f, bot_f)
        cmd = [
            "ffmpeg", "-y",
            "-i", str(FINAL),
            "-i", str(BG),
            "-filter_complex", filt,
            "-map", "0:a?",
            "-c:v", "libx264", "-preset", "fast", "-crf", "22",
            "-c:a", "aac",
            str(OUT),
        ]

        import time; t0 = time.time()
        r = subprocess.run(cmd, capture_output=True, text=True)
        elapsed = time.time() - t0

        if r.returncode != 0:
            print("STDERR:\n", r.stderr[-3000:])
            raise RuntimeError(f"FFmpeg exit {r.returncode}")

        mb = OUT.stat().st_size / 1024 / 1024
        print(f"\nDONE in {elapsed:.1f}s — {mb:.1f} MB")
        print(f"Output: {OUT}")
    finally:
        os.unlink(top_f)
        os.unlink(bot_f)

if __name__ == "__main__":
    try:
        run()
    except Exception as e:
        print(f"FAIL: {e}")
        sys.exit(1)

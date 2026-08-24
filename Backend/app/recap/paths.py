"""Layout thư mục media theo job — Phase R2 trở đi.

Mỗi job 1 thư mục riêng dưới ``Data/Downloads/{job_id}/`` — "folder chung" cho toàn bộ
media của video đó, chia subfolder theo loại (scale cho hàng trăm video):
  source/  — file nguồn: video.mp4 tải từ YouTube (giữ để re-cut/re-merge khỏi re-download).
  clips/   — đoạn cắt theo segment (clip_i.mp4) — input R4 merge.
  voice/   — VO Việt đã atempo sync (voice_i.wav) — input R4 merge.
  merge/   — seg_i.mp4 (clip+VO đã mux) — intermediate R4, giữ để retry.
  final_recap.mp4 — video cuối (deliverable) ở job root.

Tách ra module riêng để ytdlp/ffmpeg/service/router cùng chia sẻ layout nhất quán.
Idempotent: mọi hàm tạo file đều mkdir parents → có thể gọi song song an toàn.
"""
from __future__ import annotations

from app.core.config import TOOLS_DIR

DOWNLOADS_DIR = TOOLS_DIR / "Backend" / "Data" / "Downloads"


def job_dir_of(job_id: str):
    """Folder chung cho 1 job — chứa 3 subfolder source/clips/voice."""
    return DOWNLOADS_DIR / job_id


def source_dir(job_id: str):
    """File nguồn (bản tải YouTube) — giữ lại sau cut để re-merge khỏi re-download."""
    return job_dir_of(job_id) / "source"


def clips_dir(job_id: str):
    return job_dir_of(job_id) / "clips"


def voice_dir(job_id: str):
    return job_dir_of(job_id) / "voice"


def video_path(job_id: str):
    """File nguồn — video.mp4 trong source/."""
    return source_dir(job_id) / "video.mp4"


def clip_path(job_id: str, idx: int):
    return clips_dir(job_id) / f"clip_{idx}.mp4"


def voice_path(job_id: str, idx: int):
    """VO Việt đã sync (voice_i.wav) — ghép với clip_i.mp4 ở R4 merge."""
    return voice_dir(job_id) / f"voice_{idx}.wav"


def merge_dir(job_id: str):
    """Intermediate R4: seg_i.mp4 (clip+VO đã mux) — input cho concat."""
    return job_dir_of(job_id) / "merge"


def segment_path(job_id: str, idx: int):
    """Segment đã mux video+VO — intermediate, giữ để retry concat khỏi re-mux."""
    return merge_dir(job_id) / f"seg_{idx}.mp4"


def final_path(job_id: str):
    """Video cuối — final_recap.mp4 (deliverable) ở job root."""
    return job_dir_of(job_id) / "final_recap.mp4"


def final_studio_path(job_id: str):
    """Video đã polish (BGM/watermark) — final_studio.mp4 ở job root (Phase R5)."""
    return job_dir_of(job_id) / "final_studio.mp4"


def polish_dir(job_id: str):
    """Intermediate R5: bgm chain concat list — job root / polish."""
    return job_dir_of(job_id) / "polish"


def recap_path(job_id: str):
    """recap.json — lưu recap khi generate, để rehydrate job sau restart server."""
    return job_dir_of(job_id) / "recap.json"


def raw_path(job_id: str):
    """raw.txt — transcript gốc (user dán/đính kèm hoặc auto-fetch) đã chuẩn hoá,
    persisted ra file để upload file đó đi (không giữ raw lớn trong memory)."""
    return job_dir_of(job_id) / "raw.txt"

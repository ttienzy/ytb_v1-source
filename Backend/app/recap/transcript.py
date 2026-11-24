"""Lấy phụ đề YouTube công khai qua HTTP và định dạng cho bộ chia cảnh Recap."""
from __future__ import annotations

import re
import sys
from pathlib import Path

from requests import Session
from requests.exceptions import RequestException, Timeout
from youtube_transcript_api import (
    AgeRestricted,
    CouldNotRetrieveTranscript,
    NoTranscriptFound,
    PoTokenRequired,
    RequestBlocked,
    TranscriptsDisabled,
    VideoUnavailable,
    VideoUnplayable,
    YouTubeRequestFailed,
    YouTubeTranscriptApi,
)

from app.discover.history import extract_youtube_video_id


class TranscriptFetchError(RuntimeError):
    """Lỗi lấy transcript có thông tin để người dùng xử lý."""


class _TranscriptSession(Session):
    def request(self, method, url, **kwargs):
        kwargs.setdefault("timeout", 15)
        return super().request(method, url, **kwargs)


def get_transcript(url: str) -> str:
    """Ưu tiên phụ đề Việt/Anh, rồi dùng phụ đề có sẵn nếu video dùng ngôn ngữ khác."""
    video_id = extract_youtube_video_id(url)
    if not re.fullmatch(r"[A-Za-z0-9_-]{11}", video_id):
        raise TranscriptFetchError("Link YouTube không có mã video hợp lệ.")

    try:
        with _TranscriptSession() as session:
            tracks = YouTubeTranscriptApi(http_client=session).list(video_id)
            try:
                track = tracks.find_transcript(["vi", "en"])
            except NoTranscriptFound:
                track = next(iter(tracks), None)
                if track is None:
                    raise
            segments = track.fetch()
    except (TranscriptsDisabled, NoTranscriptFound) as exc:
        raise TranscriptFetchError("Video không có phụ đề công khai để lấy.") from exc
    except (RequestBlocked, PoTokenRequired) as exc:
        raise TranscriptFetchError("YouTube đang giới hạn truy cập phụ đề. Hãy thử lại sau hoặc cung cấp transcript.") from exc
    except (AgeRestricted, VideoUnavailable, VideoUnplayable) as exc:
        raise TranscriptFetchError("Video không phát được ở chế độ khách. Kiểm tra lại link hoặc quyền truy cập.") from exc
    except Timeout as exc:
        raise TranscriptFetchError("Kết nối đến YouTube quá thời gian khi lấy phụ đề.") from exc
    except (RequestException, YouTubeRequestFailed) as exc:
        raise TranscriptFetchError("Không nhận được phụ đề từ YouTube do lỗi kết nối hoặc phản hồi HTTP.") from exc
    except (CouldNotRetrieveTranscript, ValueError) as exc:
        raise TranscriptFetchError("Không đọc được phản hồi phụ đề của YouTube.") from exc

    lines = []
    for segment in segments:
        text = " ".join(segment.text.split())
        if text:
            minute, second = divmod(int(segment.start), 60)
            lines.append(f"[{minute}:{second:02d}] {text}")
    if not lines:
        raise TranscriptFetchError("YouTube trả về phụ đề rỗng.")
    return "\n".join(lines)


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        print("Cách dùng: python -m app.recap.transcript <YouTube_URL> [out_path]")
        return 2
    try:
        transcript = get_transcript(argv[1])
    except TranscriptFetchError as exc:
        print(str(exc), file=sys.stderr)
        return 1
    out = Path(argv[2]) if len(argv) > 2 else Path(__file__).resolve().parents[3] / "raw.txt"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(transcript, encoding="utf-8")
    print(f"[transcript] OK -> {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))

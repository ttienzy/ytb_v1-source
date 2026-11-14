"""Tùy chọn "âm thanh & hiệu ứng" của Workflow Audio (một đối tượng gửi kèm mỗi lần chạy / xem thử)."""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class AudioOptions(BaseModel):
    # ── Âm thanh ─────────────────────────────────────────────────────────────
    voice_speed: float = Field(1.0, ge=0.7, le=1.5, description="Tốc độ đọc (atempo, giữ nguyên cao độ)")
    bgm_volume: float = Field(0.22, ge=0.0, le=1.0, description="Âm lượng nhạc nền trước khi hạ theo giọng đọc")
    bgm_duck: Literal["off", "normal", "strong"] = "normal"  # tự hạ nhạc khi giọng đọc đang nói
    bgm_track_id: str | None = Field(None, description="None = chọn ngẫu nhiên trong Thư viện nhạc")
    fade_out_sec: float = Field(1.5, ge=0.0, le=6.0, description="Nhỏ dần âm thanh ở cuối video")
    loudnorm: bool = Field(True, description="Chuẩn hóa âm lượng (~-16 LUFS) để các video đồng đều")

    # ── Bố cục + chữ trên video ──────────────────────────────────────────────
    # cover_center: nền mờ + thẻ ảnh bìa giữa khung + tên truyện + phụ đề (kiểu kênh "Truyện Audio Full"); không cần video nền.
    # classic: nền toàn khung (video thư viện hoặc ảnh bìa zoom, xem bg_mode) + các lớp phủ bên dưới.
    layout: Literal["cover_center", "classic"] = "cover_center"
    subtitles: bool = Field(True, description="Phụ đề chạy theo từng câu đọc")
    chapter_label: bool = Field(True, description="Nhãn 'Chương N' đổi theo đoạn đang đọc")
    cta: bool = Field(True, description="Lời nhắc đăng ký/thích hiện định kỳ")
    cta_text: str = Field("Đăng ký kênh · Bấm thích · Chia sẻ", min_length=1, max_length=60)

    # ── Nền (bố cục classic) ─────────────────────────────────────────────────
    bg_mode: Literal["library", "cover"] = "library"  # library: video trong thư viện nền; cover: ảnh bìa truyện zoom chậm

    # ── Lớp phủ (chỉ khi bật mới phải mã hóa lại video, còn không vẫn nối stream copy) ──
    dim: float = Field(0.0, ge=0.0, le=0.7, description="Làm tối nền để chữ/waveform dễ đọc")
    title_card: Literal["off", "intro", "always"] = "off"
    title_seconds: float = Field(6.0, ge=2.0, le=20.0)
    waveform: bool = False
    logo_id: str | None = Field(None, pattern=r"^[a-f0-9]{12}$")
    logo_position: Literal["tl", "tr", "bl", "br"] = "tr"
    logo_size: float = Field(0.14, ge=0.05, le=0.4, description="Bề rộng logo theo tỉ lệ bề rộng khung")
    logo_opacity: float = Field(0.9, ge=0.1, le=1.0)

    def needs_overlay(self) -> bool:
        return self.dim > 0 or self.title_card != "off" or self.waveform or bool(self.logo_id)

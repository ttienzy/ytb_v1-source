"""Đồ thị bước của chiến dịch thời trang (docs/PLAN §3.1). 8 khối hiển thị, bước nội bộ cho engine.

STEPS đã được sắp theo thứ tự tô-pô (mọi dep đứng trước bước dùng nó); kiểm tra lúc import.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Callable

TIERS = ("draft", "final")

# Số việc chạy song song tối đa mỗi làn tài nguyên.
LANE_LIMITS = {"llm": 2, "chatgpt-image": 2, "flow": 3, "local": 2}

BLOCKS = {
    1: "Sản phẩm", 2: "Người mẫu", 3: "Kế hoạch", 4: "Ảnh mẫu",
    5: "Storyboard", 6: "Clip", 7: "Kiểm tra", 8: "Ghép & Xuất",
}

# Đơn giá credit Flow ĐÃ XÁC MINH live (docs/PLAN_flow_http_submit.md): Omni 1.2 t2v 10 giây.
# Khóa: (độ phân giải, giây). Chưa biết i2v -> trả None (kế hoạch báo "chưa rõ chi phí", không đoán).
FLOW_CREDIT = {("360p", 10): 10, ("720p", 10): 30}
# i2v (khung đầu + cuối): HAR gd_7 (6s 720p = 18) và HAR v2 (10s 720p = 30, 10s 360p = 10). 360p 6s CHƯA có số liệu -> None.
FLOW_CREDIT_I2V = {("720p", 6): 18, ("720p", 10): 30, ("360p", 10): 10}
# Ingredients (r2v, Omni 1.2): chỉ các mốc đã đo (HAR gd_7: 13s 720p = 48; credit_check v2: 15s 360p = 20). Mốc khác: xem clip_cost_estimate.
FLOW_CREDIT_R2V = {("720p", 13): 48, ("360p", 15): 20}
R2V_DURATIONS = tuple(range(3, 16))          # Google: Ingredients của Omni 1.2 nhận 3-15 giây (tài khoản không có gói Google AI: tối đa 10)
TIER_RESOLUTION = {"draft": "360p", "final": "720p"}
R2V_BASE_RATE = {"360p": 1, "720p": 3}       # credit/giây tới 10 giây; từ giây thứ 11 gấp đôi. Khớp 13s 720p = 48, 15s 360p = 20, 15s 720p = 60 (giao diện Flow).


def clip_duration(params: dict) -> int | None:
    try:
        n = int(params.get("duration") or 0)
    except (TypeError, ValueError):
        return None
    return n if n in R2V_DURATIONS else None


def clip_cost(params: dict, tier: str) -> int | None:
    """Giá ĐÃ XÁC MINH của một clip Ingredients; chưa đo thì None (kế hoạch báo "chưa rõ giá", không đoán)."""
    n = clip_duration(params)
    return None if n is None else FLOW_CREDIT_R2V.get((TIER_RESOLUTION.get(tier, "360p"), n))


def clip_cost_estimate(params: dict, tier: str) -> int | None:
    """Giá DỰ KIẾN theo công thức, chỉ để hiển thị; không dùng thay giá đã xác minh."""
    n = clip_duration(params)
    if n is None:
        return None
    rate = R2V_BASE_RATE[TIER_RESOLUTION.get(tier, "360p")]
    return rate * min(n, 10) + 2 * rate * max(n - 10, 0)


@dataclass(frozen=True)
class StepDef:
    key: str
    block: int
    title: str
    kind: str                       # input_files | input_params | compute
    deps: tuple[str, ...] = ()
    lane: str = "local"             # llm | chatgpt-image | flow | local
    paid: bool = False              # tốn credit thật -> không bao giờ tự gửi lại
    map_from: str | None = None     # bước (không map) có artifact JSON {"items":[{"key":...}]} xác định phần tử
    gate: bool = False              # đầu ra phải được duyệt trước khi bước sau dùng
    advisory: bool = False          # kết quả chỉ để cảnh báo
    uses_tier: bool = False         # draft/final nằm trong vân tay
    param_keys: tuple[str, ...] = ()
    logic: int = 1                  # tăng khi đổi logic bước để vô hiệu cache
    output: str = "json"
    default_template: str | None = None
    cost: Callable[[dict, str], int | None] | None = None
    cost_estimate: Callable[[dict, str], int | None] | None = None   # giá dự kiến khi `cost` chưa có số đo
    images_fixed: int = 0           # số ảnh ChatGPT cố định mỗi lần chạy một phần tử (0 = theo tham số count)
    # Bước map: chỉ các trường này của phần tử nguồn (vd. shot) vào vân tay. None = băm cả phần tử. Nhờ vậy sửa lời thoại
    # không làm "cũ" storyboard/clip vốn không dùng lời thoại.
    item_fields: tuple[str, ...] | None = None
    # Chỉ chạy chính bước này: dùng kết quả ĐÃ CÓ / ĐÃ DUYỆT của bước trước, không bao giờ kéo bước trước (có thể tốn credit) chạy lại.
    # Dành cho bước hậu kỳ cục bộ: sau khi nâng prompt, clip đã duyệt có thể bị đánh dấu "cũ" nhưng vẫn ghép được.
    isolated: bool = False


STEPS: tuple[StepDef, ...] = (
    # 1. Sản phẩm
    StepDef("garment_source", 1, "Ảnh sản phẩm", "input_files", output="bundle"),
    StepDef("fact_sheet", 1, "Hồ sơ áo", "compute", ("garment_source",), lane="llm", param_keys=("prompt",),
            default_template="system:fact_sheet"),
    # 2. Người mẫu
    StepDef("cast", 2, "Nhân vật", "input_files", output="bundle"),
    StepDef("style", 2, "Phong cách", "input_params"),
    # 3. Kế hoạch
    StepDef("brief", 3, "Brief", "input_params"),
    # 4. Ảnh mẫu mặc áo (đứng trước Kế hoạch: nhà dựng cảnh cần nhìn thấy người mẫu và áo thật đã duyệt)
    StepDef("look", 4, "Ảnh mẫu mặc áo", "compute", ("garment_source", "cast"), lane="chatgpt-image", gate=True,
            param_keys=("prompt", "count", "aspect"), output="image", default_template="system:look_sheet"),
    StepDef("look_check", 4, "Kiểm tra ảnh mẫu", "compute", ("look", "garment_source"), lane="llm", advisory=True,
            param_keys=("prompt",)),
    StepDef("angle", 3, "Góc kể", "compute", ("fact_sheet", "brief"), lane="llm", param_keys=("prompt",),
            default_template="system:angle"),
    StepDef("hook", 3, "Hook", "compute", ("angle", "fact_sheet", "brief"), lane="llm", param_keys=("prompt", "count"),
            default_template="system:hook"),
    StepDef("shot_plan", 3, "Danh sách shot", "compute", ("angle", "hook", "look", "fact_sheet", "style", "brief"), lane="llm",
            param_keys=("prompt", "shots", "total_seconds", "motion_limit"), default_template="system:shot_plan"),
    StepDef("script", 3, "Lời thoại & caption", "compute", ("shot_plan", "brief", "fact_sheet"), lane="llm",
            param_keys=("prompt",), default_template="system:script"),
    # Khung mẫu: MỘT ảnh chốt khuôn mặt + áo + bối cảnh + ánh sáng; mọi storyboard và clip tham chiếu nó nên các shot liền mạch như cùng một buổi quay.
    StepDef("anchor_frame", 4, "Khung mẫu bối cảnh", "compute", ("look", "cast", "garment_source", "fact_sheet", "style"),
            lane="chatgpt-image", gate=True, param_keys=("prompt", "aspect"), output="image",
            default_template="system:anchor_frame", images_fixed=1),
    # 5. Storyboard: mỗi shot một ảnh gồm 2-4 khung
    StepDef("storyboard", 5, "Storyboard", "compute", ("anchor_frame", "shot_plan", "fact_sheet", "style", "garment_source"),
            lane="chatgpt-image", map_from="shot_plan", gate=True, param_keys=("prompt", "aspect"),
            output="image", default_template="system:storyboard", images_fixed=1,
            item_fields=("board_type", "framing", "panels", "face_policy", "expression", "duration")),
    # 6. Clip: Ingredients (khung mẫu + storyboard + ảnh áo thật)
    StepDef("clip", 6, "Clip", "compute", ("storyboard", "anchor_frame", "garment_source", "shot_plan", "fact_sheet", "style"),
            lane="flow", paid=True, map_from="shot_plan", gate=True, uses_tier=True,
            param_keys=("prompt", "duration", "aspect", "model"),
            output="video", default_template="system:clip_ingredients", cost=clip_cost, cost_estimate=clip_cost_estimate,
            item_fields=("role", "duration", "motion", "board_type", "panels", "camera_move")),
    # 7. Kiểm tra
    StepDef("clip_check", 7, "Kiểm tra clip", "compute", ("clip", "garment_source", "shot_plan"), lane="llm",
            map_from="shot_plan", advisory=True, param_keys=("prompt",)),
    StepDef("compliance", 7, "Tuân thủ nền tảng", "compute", ("script", "brief"), lane="local", advisory=True,
            param_keys=("platform",)),
    # 8. Ghép & Xuất
    StepDef("voice", 8, "Giọng đọc", "compute", ("script",), lane="local", param_keys=("voice_id",), output="bundle", isolated=True),
    StepDef("assemble", 8, "Ghép video", "compute", ("clip", "voice", "script", "shot_plan"), lane="local",
            param_keys=("bgm", "bgm_volume", "caption_style", "caption_color", "transition", "edit_style", "cut_seconds"), output="video", isolated=True),
    StepDef("export_pack", 8, "Gói xuất", "compute", ("assemble", "compliance", "script", "brief"), lane="local",
            param_keys=("platforms",), output="bundle"),
)

STEP_BY_KEY: dict[str, StepDef] = {s.key: s for s in STEPS}


def _validate() -> None:
    seen: set[str] = set()
    for s in STEPS:
        assert s.key not in seen, f"trùng khóa bước {s.key}"
        for d in s.deps:
            assert d in seen, f"{s.key} phụ thuộc {d} nhưng {d} chưa đứng trước (sai thứ tự tô-pô)"
        if s.map_from:
            assert s.map_from in s.deps, f"{s.key}: map_from {s.map_from} phải nằm trong deps"
        assert s.lane in LANE_LIMITS, f"{s.key}: làn {s.lane} không hợp lệ"
        seen.add(s.key)
    for s in STEPS:
        if s.map_from:
            assert not STEP_BY_KEY[s.map_from].map_from, f"{s.key}: map_from phải là bước không map"


_validate()


def get_step(key: str) -> StepDef:
    try:
        return STEP_BY_KEY[key]
    except KeyError:
        raise KeyError(f"Bước không tồn tại: {key}") from None


def ancestors(key: str) -> set[str]:
    out: set[str] = set()
    stack = list(get_step(key).deps)
    while stack:
        k = stack.pop()
        if k not in out:
            out.add(k)
            stack.extend(get_step(k).deps)
    return out


def needed_for(target: str | None) -> set[str]:
    """Các bước cần xét khi chạy/lập kế hoạch cho `target` (None = tất cả). Bước `isolated` chỉ gồm chính nó."""
    if not target:
        return {s.key for s in STEPS}
    return {target} if get_step(target).isolated else ancestors(target) | {target}


def descendants(key: str) -> set[str]:
    return {s.key for s in STEPS if key in ancestors(s.key)}

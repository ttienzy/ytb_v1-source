"""Đồ thị bước của chiến dịch thời trang v3 (docs/PLAN_campaign_v3_format_director.md §5): 6 khối, "format + đạo diễn theo cảnh".

STEPS đã được sắp theo thứ tự tô-pô (mọi dep đứng trước bước dùng nó); kiểm tra lúc import.

Ba kiểu phụ thuộc giữa bước map (engine.py):
  * cùng `map_from` (vd. scene_anchor -> scene_plate, đều theo cảnh): phần tử nào dùng phần tử ấy;
  * `dep_element` (vd. clip theo shot -> scene_anchor theo cảnh): phần tử đích = trường `scene` của shot;
  * khác map và không khai báo: gom TOÀN BỘ phần tử của bước trước (đổi một phần tử là cũ tất cả) — tránh dùng cho bước paid.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Callable

TIERS = ("draft", "final")

# Số việc chạy song song tối đa mỗi làn tài nguyên.
LANE_LIMITS = {"llm": 2, "chatgpt-image": 2, "flow": 3, "local": 2}

BLOCKS = {
    1: "Sản phẩm", 2: "Nhân vật & Cảnh", 3: "Format & Kịch bản",
    4: "Khung chốt cảnh", 5: "Clip", 6: "Ghép & Xuất",
}

# Đơn giá credit Flow ĐÃ XÁC MINH live (docs/PLAN_flow_http_submit.md): Omni 1.2 t2v 10 giây.
FLOW_CREDIT = {("360p", 10): 10, ("720p", 10): 30}
# i2v (khung đầu + cuối): HAR gd_7 (6s 720p = 18) và HAR v2 (10s 720p = 30, 10s 360p = 10).
FLOW_CREDIT_I2V = {("720p", 6): 18, ("720p", 10): 30, ("360p", 10): 10}
# Ingredients (r2v, Omni 1.2): CHỈ các mốc đã đo. HAR gd_7: 13s 720p = 48; credit_check v2: 15s 360p = 20;
# chiến dịch 5d27a03c3a42 (2026-11-10, credit_actual của 4 clip): 6s 720p = 18, 8s 720p = 24, 10s 720p = 30.
FLOW_CREDIT_R2V = {("720p", 6): 18, ("720p", 8): 24, ("720p", 10): 30, ("720p", 13): 48, ("360p", 15): 20}
R2V_DURATIONS = tuple(range(3, 16))          # Google: Ingredients của Omni 1.2 nhận 3-15 giây (không gói Google AI: tối đa 10)
TIER_RESOLUTION = {"draft": "360p", "final": "720p"}
R2V_BASE_RATE = {"360p": 1, "720p": 3}       # credit/giây tới 10 giây; từ giây thứ 11 gấp đôi. Khớp mọi mốc đã đo ở trên.


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
    """Giá DỰ KIẾN theo công thức, chỉ để hiển thị và tính trần ngân sách; không thay giá đã xác minh."""
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
    # Bước nguồn phần tử: bước compute có artifact JSON {"items":[{"key":...}]} HOẶC bước input_params có params["items"].
    map_from: str | None = None
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
    # Bước map: chỉ các trường này của phần tử nguồn vào vân tay. None = băm cả phần tử. Nhờ vậy sửa lời thoại
    # không làm "cũ" clip vốn không dùng lời thoại.
    item_fields: tuple[str, ...] | None = None
    # Chỉ chạy chính bước này trên kết quả ĐÃ CÓ / ĐÃ DUYỆT của bước trước, không bao giờ kéo bước trước (có thể tốn credit) chạy lại.
    isolated: bool = False
    # (dep, trường của phần tử): bước map này dùng ĐÚNG MỘT phần tử của `dep` (bước map theo danh sách khác), chọn theo trường đó.
    # vd. clip (theo shot) dùng scene_anchor (theo cảnh) có khóa = shot["scene"]. Đổi cảnh khác không làm cũ clip này.
    dep_element: tuple[tuple[str, str], ...] = ()

    @property
    def dep_elements(self) -> dict[str, str]:
        return dict(self.dep_element)


SCENE_FIELDS = ("name", "place", "time", "light", "mood", "action")
SHOT_CLIP_FIELDS = ("scene", "duration", "camera", "beats", "expression", "needs_face", "garment_ref", "motion")

STEPS: tuple[StepDef, ...] = (
    # 1. Sản phẩm
    StepDef("garment_source", 1, "Ảnh sản phẩm", "input_files", output="bundle"),
    StepDef("fact_sheet", 1, "Hồ sơ áo", "compute", ("garment_source",), lane="llm", param_keys=("prompt",),
            default_template="system:fact_sheet"),
    # 2. Nhân vật & Cảnh
    StepDef("cast", 2, "Ảnh nhân vật", "input_files", output="bundle"),
    StepDef("cast_profile", 2, "Hồ sơ nhân vật", "input_params"),
    # Cast sheet: nhân dạng + trang phục trên nền trơn (Flow Help: ảnh chủ thể nên nền trơn). Mọi khối sau chỉ dùng bản đã duyệt.
    StepDef("cast_sheet", 2, "Cast sheet", "compute", ("garment_source", "cast", "cast_profile"), lane="chatgpt-image", gate=True,
            param_keys=("prompt", "count", "aspect"), output="image", default_template="system:cast_sheet"),
    StepDef("scene_set", 2, "Các cảnh", "input_params"),
    StepDef("style", 2, "Phong cách chung", "input_params"),
    # Scene plate: ảnh bối cảnh KHÔNG người, một ảnh mỗi cảnh (Flow Help: ảnh bối cảnh không có chủ thể).
    StepDef("scene_plate", 2, "Ảnh bối cảnh", "compute", ("scene_set", "style"), lane="chatgpt-image", map_from="scene_set",
            param_keys=("prompt", "aspect"), output="image", default_template="system:scene_plate", images_fixed=1,
            item_fields=SCENE_FIELDS),
    # 3. Format & Kịch bản
    StepDef("brief", 3, "Brief", "input_params"),
    StepDef("format", 3, "Format quảng cáo", "input_params"),
    # Một lượt LLM điền nội dung vào khung format: hook, beat từng shot, lời thoại, chữ, caption. Nhìn cast sheet đã duyệt.
    StepDef("script", 3, "Kịch bản", "compute", ("fact_sheet", "cast_sheet", "scene_set", "brief", "format", "cast_profile"), lane="llm",
            param_keys=("prompt",), default_template="system:script_v3"),
    # 4. Khung chốt cảnh: MỘT ảnh người-trong-cảnh cho mỗi cảnh (cast sheet + ảnh áo + scene plate), duyệt một lần mỗi cảnh.
    StepDef("scene_anchor", 4, "Khung chốt cảnh", "compute", ("scene_set", "style", "scene_plate", "cast_sheet", "garment_source", "fact_sheet", "cast_profile"),
            lane="chatgpt-image", map_from="scene_set", gate=True, param_keys=("prompt", "aspect"), output="image",
            default_template="system:scene_anchor", images_fixed=1, item_fields=SCENE_FIELDS),
    # 5. Clip: Ingredients 3 ảnh theo vai (khung chốt cảnh của shot, cast sheet, ảnh áo thật), prompt theo công thức Google.
    StepDef("clip", 5, "Clip", "compute", ("script", "scene_anchor", "cast_sheet", "garment_source", "fact_sheet", "scene_set", "style", "cast_profile"),
            lane="flow", paid=True, map_from="script", gate=True, uses_tier=True,
            param_keys=("prompt", "duration", "aspect", "model"),
            output="video", default_template="system:clip_v3", cost=clip_cost, cost_estimate=clip_cost_estimate,
            item_fields=SHOT_CLIP_FIELDS, dep_element=(("scene_anchor", "scene"), ("scene_set", "scene"))),
    # 6. Ghép & Xuất
    StepDef("voice", 6, "Giọng đọc", "compute", ("script",), lane="local", param_keys=("voice_id",), output="bundle", isolated=True),
    StepDef("assemble", 6, "Ghép video", "compute", ("clip", "voice", "script"), lane="local",
            param_keys=("bgm", "bgm_volume", "caption_style", "caption_color", "transition", "edit_style", "cut_seconds",
                         "opening_text", "end_card", "ai_label"),
            output="video", isolated=True),
    StepDef("export_pack", 6, "Gói xuất", "compute", ("assemble", "script", "brief"), lane="local", param_keys=("platforms",),
            isolated=True),
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
        for dep, _field in s.dep_element:
            assert dep in s.deps, f"{s.key}: dep_element {dep} phải nằm trong deps"
            assert s.map_from, f"{s.key}: dep_element chỉ dành cho bước map"
            dd = STEP_BY_KEY[dep]
            assert dd.map_from or dd.kind == "input_params", f"{s.key}: dep_element {dep} phải là bước map hoặc input_params"
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

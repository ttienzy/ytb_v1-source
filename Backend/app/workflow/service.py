from __future__ import annotations

import base64
import copy
from datetime import datetime, timezone
import json
import logging
import re
import urllib.parse
from pathlib import Path
from typing import Any

import httpx
import subprocess

import uuid

from app.ai.gemini.recap import (
    _fresh_tokens,
    _gemini_config,
    _upload_file,
    _auto_refresh_cookies,
    RecapConfigError,
)
from app.core.config import TOOLS_DIR, DATA_DIR
from app.core.storage import read_config, write_config
from app.ai.chatgpt.service import (
    chat_completion,
    ensure_9router_running,
    get_local_cli_secret,
    is_9router_running,
    normalize_endpoint,
)
from app.recap.ffmpeg import concat_segments, ffprobe_duration
from app.workflow.schemas import (
    GeminiAnalysisResponse,
    GeminiProductClassification,
    GptScriptItem,
    GptScriptResponse,
    WorkflowAssetUploadResponse,
    WorkflowExportResponse,
    WorkflowVoiceoverItem,
    WorkflowVoiceoverResponse,
    PromptPresetItem,
    PromptPresetCreateRequest,
    PromptPresetUpdateRequest,
    PromptPresetListResponse,
    WorkflowConfigResponse,
    MotionWorkflowConfig,
    MotionPresetItem,
    MotionPresetListResponse,
)
from app.workflow.config import (
    resolve_default_script_model,
    resolve_default_voice_id,
    workflow_settings,
)

logger = logging.getLogger("workflow.service")

PROMPT_FILE = TOOLS_DIR / "Backend" / "prompts" / "workflow" / "gemini_product_analysis.txt"


def get_workflow_config() -> WorkflowConfigResponse:
    """Return the single runtime policy consumed by the workflow API and UI.

    Keeping this mapping at the backend boundary prevents the generation code and
    the frontend from drifting apart when a policy value is changed by env/config.
    """
    saved_config = read_config() or {}
    router_config = saved_config.get("chatgpt_9router", {})
    return WorkflowConfigResponse(
        defaultClipDurationSeconds=workflow_settings.clip_duration_seconds,
        voiceoverWordsPerSecond={
            "min": workflow_settings.voiceover_words_per_second_min,
            "max": workflow_settings.voiceover_words_per_second_max,
        },
        polling={
            "intervalMs": workflow_settings.polling_interval_ms,
            "timeoutMs": workflow_settings.polling_timeout_ms,
            "requestTimeoutMs": workflow_settings.polling_request_timeout_ms,
            "maxConsecutiveErrors": workflow_settings.polling_max_consecutive_errors,
        },
        defaultScriptModel=resolve_default_script_model(router_config),
        defaultVoiceId=resolve_default_voice_id(saved_config),
        defaultVeoModel=workflow_settings.default_veo_model,
        defaultAspectRatio=workflow_settings.default_aspect_ratio,
        defaultResolution=workflow_settings.default_resolution,
        defaultVariations=workflow_settings.default_variations,
    )


def get_default_gemini_prompt() -> str:
    """Đọc prompt mặc định từ Backend/prompts/workflow/gemini_product_analysis.txt."""
    if PROMPT_FILE.exists():
        try:
            return PROMPT_FILE.read_text(encoding="utf-8").strip()
        except Exception as e:
            logger.error(f"Không thể đọc file prompt {PROMPT_FILE}: {e}")
    return (
        "Dựa vào hình ảnh đính kèm, hãy tra cứu và phân tích dòng sản phẩm này. Trình bày ngắn gọn, trực diện theo cấu trúc sau:\n\n"
        "Điểm 'ăn tiền' và yếu tố thu hút chung (USP, thiết kế, công nghệ nổi bật).\n"
        "Phân loại chi tiết từng sản phẩm trong hình (Tên/màu sắc, Thành phần chính, Công dụng cốt lõi, Trải nghiệm/Mùi hương).\n"
        "Vui lòng sử dụng gạch đầu dòng súc tích, không viết lan man."
    )


def _parse_image_data(img_str: str, index: int = 0) -> tuple[bytes, str, str]:
    """Parse base64 data URL, workflow asset URL hoặc đường dẫn file cục bộ thành (bytes, filename, mime_type)."""
    # 1. Base64 Data URL: data:image/jpeg;base64,....
    if img_str.startswith("data:image/"):
        match = re.match(r"data:(image\/[a-zA-Z0-9\-\+\.]+);base64,(.+)", img_str)
        if match:
            mime = match.group(1)
            b64_data = match.group(2)
            ext = mime.split("/")[-1]
            if ext == "jpeg":
                ext = "jpg"
            filename = f"product_{index + 1}.{ext}"
            return base64.b64decode(b64_data), filename, mime

    # 2. Workflow Asset URL: /api/workflow/assets/{asset_id} hoặc http://.../api/workflow/assets/{asset_id}
    asset_match = re.search(r"/api/workflow/assets/([a-zA-Z0-9_-]+)", img_str)
    if asset_match:
        asset_id = asset_match.group(1)
        asset_p = get_workflow_asset_path(asset_id)
        if asset_p and asset_p.exists() and asset_p.is_file():
            mime = "image/jpeg" if asset_p.suffix.lower() in [".jpg", ".jpeg"] else "image/png"
            return asset_p.read_bytes(), asset_p.name, mime

    # 3. File path cục bộ (tuyệt đối hoặc tương đối)
    p = Path(img_str)
    if not (p.exists() and p.is_file()):
        for candidate_dir in [DATA_DIR, DATA_DIR / "media" / "veo_images", WORKFLOW_ASSETS_DIR]:
            test_p = candidate_dir / img_str
            if test_p.exists() and test_p.is_file():
                p = test_p
                break
    if p.exists() and p.is_file():
        mime = "image/jpeg" if p.suffix.lower() in [".jpg", ".jpeg"] else "image/png"
        return p.read_bytes(), p.name, mime

    # Fallback nếu là chuỗi base64 thuần
    try:
        decoded = base64.b64decode(img_str)
        return decoded, f"product_{index + 1}.jpg", "image/jpeg"
    except Exception:
        raise ValueError(f"Không thể nhận diện định dạng ảnh đầu vào: {img_str[:50]}...")


def _parse_stream_frames(raw: str) -> list[Any]:
    payloads = []
    for line in raw.split("\n"):
        line = line.strip()
        if not line.startswith("[["):
            continue
        try:
            frame = json.loads(line)
        except json.JSONDecodeError:
            continue
        for item in frame:
            if isinstance(item, list) and len(item) >= 3 and item[0] == "wrb.fr" and isinstance(item[2], str):
                try:
                    payloads.append(json.loads(item[2]))
                except json.JSONDecodeError:
                    pass
    return payloads


def _extract_answer_text(raw: str) -> str | None:
    payloads = _parse_stream_frames(raw)
    texts = []
    for p in payloads:
        try:
            rc_block = p[4]
        except (IndexError, TypeError):
            continue
        if not isinstance(rc_block, list):
            continue
        for rc in rc_block:
            if isinstance(rc, list) and len(rc) >= 2 and isinstance(rc[1], list) and rc[1]:
                txt = rc[1][0]
                if isinstance(txt, str):
                    texts.append(txt)
    return max(texts, key=len) if texts else None


def execute_9router_vision_analysis(
    prompt: str,
    images: list[str],
    model: str | None = None,
) -> str:
    """Sử dụng 9Router (OpenAI-compatible Vision endpoint) để phân tích ảnh sản phẩm bằng AI Vision."""
    cfg = read_config().get("chatgpt_9router", {})
    endpoint = cfg.get("endpoint", "http://localhost:20128/v1")
    api_key = cfg.get("api_key", "").strip() or get_local_cli_secret()
    target_model = model or resolve_default_script_model(cfg)

    if "20128" in endpoint and not is_9router_running(20128):
        logger.info("[Workflow] 9Router chưa chạy, tiến hành khởi động trên port 20128...")
        ensure_9router_running(20128)

    valid_images = []
    for img in images:
        if not img or not img.strip():
            continue
        s = img.strip()
        if s.startswith("data:") or s.startswith("http://") or s.startswith("https://"):
            valid_images.append(s)
        else:
            # File path cục bộ: Đọc và chuyển sang Data URL base64
            p = Path(s)
            if p.exists() and p.is_file():
                ext = p.suffix.lower().lstrip(".") or "jpeg"
                if ext == "jpg":
                    ext = "jpeg"
                b64 = base64.b64encode(p.read_bytes()).decode("ascii")
                valid_images.append(f"data:image/{ext};base64,{b64}")
            else:
                valid_images.append(s)

    res = chat_completion(
        endpoint=endpoint,
        api_key=api_key,
        model=target_model,
        prompt=prompt,
        images=valid_images,
        timeout=75.0,
    )
    if not res.get("ok"):
        raise RuntimeError(f"Lỗi khi gọi 9Router Vision: {res.get('error', 'Không xác định')}")
    content = res.get("content", "").strip()
    if not content:
        raise RuntimeError("9Router Vision không trả về nội dung phân tích.")
    return content


def execute_gemini_analysis(
    prompt: str,
    images: list[str],
    allow_refresh: bool = True,
    fallback_to_9router: bool = False,
) -> tuple[str, str]:
    """Gọi Google Gemini Web để phân tích hình ảnh, hỗ trợ auto-refresh siêu tốc và fallback 9Router.

    Trả về tuple: (raw_markdown_text, provider_used)
    """
    cfg = _gemini_config()
    cookies, ua, inner_template = cfg["cookies"], cfg["user_agent"], cfg["inner_template"]

    with httpx.Client(http2=False, timeout=120, follow_redirects=True) as client:
        # Lấy fresh tokens
        try:
            at_val, bl_val, fsid_val = _fresh_tokens(client, cookies, ua)
        except Exception as exc:
            if allow_refresh:
                logger.warning(f"[Gemini Workflow] Token hết hạn: {exc}. Đang tự động làm mới ngầm siêu tốc qua Chrome...")
                try:
                    _auto_refresh_cookies()
                    return execute_gemini_analysis(prompt, images, allow_refresh=False, fallback_to_9router=fallback_to_9router)
                except Exception as refresh_err:
                    logger.warning(f"[Gemini Workflow] Tự động làm mới cookie thất bại: {refresh_err}")
            if fallback_to_9router:
                logger.info("[Gemini Workflow] Chuyển hướng phân tích qua 9Router Vision AI...")
                text = execute_9router_vision_analysis(prompt, images)
                return text, "9router"
            raise

        # Upload ảnh
        attachments = []
        for i, img_data in enumerate(images):
            if not img_data:
                continue
            try:
                img_bytes, filename, mime = _parse_image_data(img_data, i)
                gcs_path = _upload_file(client, img_bytes, filename, cookies, ua)
                # Attachment structure cho image: [gcs_path, 1, None, mime]
                attachments.append(
                    [[gcs_path, 1, None, mime], filename, None, None, None, None, None, None, [0]]
                )
            except Exception as e:
                logger.warning(f"Lỗi khi upload ảnh {i}: {e}")

        # Dựng f.req
        inner = copy.deepcopy(inner_template)
        inner[0] = [prompt, 0, None, attachments if attachments else None, None, None, 0]
        nj = json.dumps(
            [None, json.dumps(inner, ensure_ascii=False, separators=(",", ":"))],
            ensure_ascii=False,
            separators=(",", ":"),
        )
        enc = urllib.parse.quote(nj, safe="")
        body = "f.req=" + enc + "&at=" + urllib.parse.quote_plus(at_val) + "&"

        url = (
            "https://gemini.google.com/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate"
            f"?bl={bl_val}&f.sid={fsid_val}&hl=vi&_reqid=100000&rt=c"
        )

        resp = client.post(
            url,
            content=body,
            headers={
                "User-Agent": ua,
                "Cookie": cookies,
                "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
                "Origin": "https://gemini.google.com",
                "Referer": "https://gemini.google.com/",
                "X-Same-Domain": "1",
            },
            timeout=180,
        )

        if resp.status_code != 200 or '"er"' in resp.text[:200]:
            if allow_refresh and (resp.status_code in (401, 403) or "unauthenticated" in resp.text.lower()):
                logger.warning("[Gemini Workflow] Session hết hạn trong lúc gọi StreamGenerate. Tự động làm mới cookie...")
                try:
                    _auto_refresh_cookies()
                    return execute_gemini_analysis(prompt, images, allow_refresh=False, fallback_to_9router=fallback_to_9router)
                except Exception as refresh_err:
                    logger.warning(f"[Gemini Workflow] Tự động làm mới cookie thất bại: {refresh_err}")
            if fallback_to_9router:
                logger.info("[Gemini Workflow] Gemini StreamGenerate lỗi, chuyển hướng sang 9Router Vision...")
                text = execute_9router_vision_analysis(prompt, images)
                return text, "9router"
            raise RuntimeError(f"Gemini Web API error: HTTP {resp.status_code} — {resp.text[:300]}")

        answer = _extract_answer_text(resp.text)
        if not answer:
            if fallback_to_9router:
                logger.info("[Gemini Workflow] Không trích xuất được text Gemini, chuyển sang 9Router...")
                text = execute_9router_vision_analysis(prompt, images)
                return text, "9router"
            raise RuntimeError("Không thể trích xuất nội dung trả lời từ luồng phản hồi của Gemini.")

        return answer, "gemini"


def parse_analysis_to_structured(raw_text: str, provider_used: str = "gemini") -> GeminiAnalysisResponse:
    """Tách câu trả lời text Markdown của Gemini thành các trường có cấu trúc."""
    # Làm sạch citation tags [cite: 1] nếu có
    cleaned = re.sub(r"\[cite:\s*[\d,\s]+\]", "", raw_text).strip()

    lines = [line.strip() for line in cleaned.split("\n") if line.strip()]
    usp_bullets: list[str] = []
    classifications: list[GeminiProductClassification] = []

    current_section = "usp"  # Mặc định phần đầu là thông tin chung / USP nếu chưa có heading
    curr_class: dict[str, str] = {}

    def commit_curr_class():
        nonlocal curr_class
        if curr_class and curr_class.get("name"):
            name_clean = curr_class["name"].strip("*# :")
            if name_clean:
                classifications.append(
                    GeminiProductClassification(
                        name=name_clean,
                        color_variant=curr_class.get("color_variant"),
                        main_ingredients=curr_class.get("main_ingredients"),
                        core_benefits=curr_class.get("core_benefits"),
                        experience_scent=curr_class.get("experience_scent"),
                    )
                )
        curr_class = {}

    attribute_keywords = ["thành phần", "công dụng", "trải nghiệm", "mùi", "hương", "màu sắc", "phiên bản", "lợi ích"]

    for line in lines:
        lower = line.lower()
        # 1. Phát hiện chuyển section USP / Thu hút chung
        if any(kw in lower for kw in ["ăn tiền", "thu hút", "usp", "điểm nổi bật", "tổng quan"]):
            if any(mark in line for mark in ["#", "*", ":"]) or len(line) < 80:
                commit_curr_class()
                current_section = "usp"
                continue

        # 2. Phát hiện chuyển section Phân loại chi tiết sản phẩm
        if any(kw in lower for kw in ["phân loại", "từng sản phẩm", "danh sách sản phẩm", "chi tiết sản phẩm"]):
            if any(mark in line for mark in ["#", "*", ":"]) or len(line) < 80:
                commit_curr_class()
                current_section = "classification"
                continue

        if current_section == "usp":
            # Bóc tách các gạch đầu dòng USP
            if line.startswith(("-", "*", "•", "+")) or re.match(r"^\d+[\.\)]", line):
                clean_bullet = re.sub(r"^(?:[-*•+]|\d+[\.\)])\s*", "", line).strip()
                if clean_bullet:
                    usp_bullets.append(clean_bullet)

        elif current_section == "classification":
            # Kiểm tra xem đây có phải là dòng thuộc tính (Thành phần / Công dụng / Mùi hương / Màu) không
            is_attr_line = False
            if ":" in line:
                key_part, val_part = line.split(":", 1)
                key_lower = key_part.lower()
                val_clean = val_part.strip().strip("* ")
                if any(attr_kw in key_lower for attr_kw in attribute_keywords) or "tên" in key_lower:
                    is_attr_line = True
                    if "thành phần" in key_lower:
                        curr_class["main_ingredients"] = val_clean
                    elif "công dụng" in key_lower or "lợi ích" in key_lower:
                        curr_class["core_benefits"] = val_clean
                    elif "mùi" in key_lower or "trải nghiệm" in key_lower or "hương" in key_lower:
                        curr_class["experience_scent"] = val_clean
                    elif "màu" in key_lower or "phiên bản" in key_lower:
                        curr_class["color_variant"] = val_clean
                        if not curr_class.get("name"):
                            curr_class["name"] = val_clean
                    elif "tên" in key_lower:
                        curr_class["name"] = val_clean

            if not is_attr_line:
                # Tiêu đề sản phẩm mới: ví dụ "1. **Chai màu hồng (Rose)**:" hoặc "### 1. Nước hoa..."
                header_match = re.match(r"^(?:#{1,4}\s*|\d+[\.\)]\s*|[-*•]\s*|\*\*\s*|\d+[\.\)]\s*\*\*)([^\n]+)", line)
                if header_match:
                    raw_title = header_match.group(1).strip().strip("*# :")
                    # Bỏ tiền tố đánh số thừa nếu có
                    cleaned_title = re.sub(r"^(?:Sản phẩm\s*\d+[:\s\-]*|Chai\s*\d+[:\s\-]*)", "", raw_title, flags=re.IGNORECASE).strip()
                    cand_title = cleaned_title if cleaned_title else raw_title
                    if cand_title and not any(cand_title.lower().startswith(attr_kw) for attr_kw in attribute_keywords):
                        commit_curr_class()
                        curr_class["name"] = cand_title

    commit_curr_class()

    feature_bullets = [b for b in usp_bullets]
    if not feature_bullets:
        feature_bullets = [l.lstrip("-*• ") for l in lines if l.startswith(("-", "*", "•"))][:6]

    feature_summary = "; ".join(feature_bullets[:3]) if feature_bullets else (lines[0] if lines else "Đặc tính sản phẩm")

    return GeminiAnalysisResponse(
        raw_text=cleaned,
        product_features=feature_summary,
        features=feature_bullets,
        classifications=classifications,
        key_selling_points=feature_bullets,
        suggested_angles=[
            "Cận cảnh chi tiết bao bì & kết cấu sản phẩm",
            "Góc nghiêng 45 độ làm nổi bật logo & thành phần",
            "Cảnh tương tác thực tế / sử dụng trên tay nhân vật",
        ],
        provider_used=provider_used,
    )


GPT_PROMPT_FILE = TOOLS_DIR / "Backend" / "prompts" / "workflow" / "gpt_sales_script.txt"


def get_default_gpt_prompt() -> str:
    """Đọc prompt mẫu tạo kịch bản bán hàng từ Backend/prompts/workflow/gpt_sales_script.txt."""
    if GPT_PROMPT_FILE.exists():
        try:
            return GPT_PROMPT_FILE.read_text(encoding="utf-8").strip()
        except Exception as e:
            logger.error(f"Không thể đọc file prompt {GPT_PROMPT_FILE}: {e}")
    return (
        "Hãy phân tích dữ liệu sản phẩm và tạo đúng {{SCRIPT_COUNT}} kịch bản video độc lập.\n"
        "Mỗi kịch bản tương ứng với một clip Google Flow dài {{CLIP_DURATION}} giây, "
        "có {{MIN_WORDS}}-{{MAX_WORDS}} từ lời thoại và không bị chia thành nhiều cảnh.\n"
        "Tự chọn góc tiếp cận phù hợp với sản phẩm và chế độ {{CONTENT_MODE}}; "
        "chỉ dùng dữ liệu đầu vào, không phóng đại hoặc tự bịa.\n"
        "Chỉ trả về JSON object có key scripts. Mỗi phần tử phải có angle, title, hook, "
        "visual_direction, voiceover, on_screen_text và cta. Voiceover là toàn bộ lời đọc "
        "hoàn chỉnh từ hook đến CTA.\n\n"
        "Dữ liệu sản phẩm:\n"
        "{{PRODUCT_DATA}}"
    )


MOTION_PROMPT_FILE = TOOLS_DIR / "Backend" / "prompts" / "workflow" / "motion_control_prompt.txt"


def get_default_motion_prompt() -> str:
    """Đọc prompt mẫu Motion Control từ Backend/prompts/workflow/motion_control_prompt.txt."""
    if MOTION_PROMPT_FILE.exists():
        try:
            return MOTION_PROMPT_FILE.read_text(encoding="utf-8").strip()
        except Exception as e:
            logger.error(f"Không thể đọc file prompt {MOTION_PROMPT_FILE}: {e}")
    return (
        "The subject from the image reference is the sole character in the video, performing the exact choreography from the motion reference video. "
        "Preserve the subject's complete identity, facial features, hair, glasses, clothing, and distinctive details consistently throughout. "
        "Transfer the choreography, poses, gestures, rhythm, camera angle, framing, and composition seamlessly from the motion video. "
        "Natural biomechanics, fluid body movement, photorealistic cinematic lighting."
    )


MOTION_PRESETS_FILE = TOOLS_DIR / "Backend" / "prompts" / "workflow" / "motion_prompt_presets.json"
MOTION_PRESETS_DATA_FILE = DATA_DIR / "motion_prompt_presets.json"


def get_motion_workflow_config() -> MotionWorkflowConfig:
    """Đọc cấu hình lưu trữ bền vững cho Motion Control từ config.json."""
    saved_config = read_config() or {}
    motion_data = saved_config.get("motion_workflow") or {}
    return MotionWorkflowConfig(
        aspect_ratio=motion_data.get("aspect_ratio", "9:16"),
        resolution=motion_data.get("resolution", "720p"),
        duration_seconds=int(motion_data.get("duration_seconds", 10)),
        project_mode=motion_data.get("project_mode", "selected"),
        project_name_prefix=motion_data.get("project_name_prefix", "Motion Control"),
        fresh_assets=bool(motion_data.get("fresh_assets", False)),
        show_reference_comparison=bool(motion_data.get("show_reference_comparison", True)),
        active_preset_id=motion_data.get("active_preset_id", "choreography"),
        num_outputs=max(1, min(4, int(motion_data.get("num_outputs", 1)))),
        creative=motion_data.get("creative"),
    )


def save_motion_workflow_config(req: MotionWorkflowConfig) -> MotionWorkflowConfig:
    """Lưu cấu hình Motion Control vào config.json."""
    saved_config = read_config() or {}
    saved_config["motion_workflow"] = req.model_dump(mode="json")
    write_config(saved_config)
    logger.info("Đã lưu cấu hình Motion Workflow vào config.json: %s", req.model_dump(mode="json"))
    return req


def get_motion_presets() -> list[dict[str, Any]]:
    """Đọc danh sách mẫu phong cách chuyển động từ motion_prompt_presets.json."""
    target_file = MOTION_PRESETS_FILE if MOTION_PRESETS_FILE.exists() else MOTION_PRESETS_DATA_FILE
    if not target_file.exists():
        return []
    try:
        data = json.loads(target_file.read_text(encoding="utf-8"))
        if isinstance(data, list):
            return data
    except Exception as e:
        logger.error(f"Lỗi đọc motion presets {target_file}: {e}")
    return []


PROMPT_PRESETS_FILE = DATA_DIR / "workflow_prompt_presets.json"


def get_all_prompt_presets() -> list[dict[str, Any]]:
    """Đọc danh sách preset từ Backend/data/workflow_prompt_presets.json."""
    if not PROMPT_PRESETS_FILE.exists():
        return []
    try:
        data = json.loads(PROMPT_PRESETS_FILE.read_text(encoding="utf-8"))
        if isinstance(data, list):
            return data
    except Exception as e:
        logger.error(f"Lỗi đọc prompt presets {PROMPT_PRESETS_FILE}: {e}")
    return []


def save_prompt_presets(presets: list[dict[str, Any]]) -> None:
    """Ghi danh sách preset vào Backend/data/workflow_prompt_presets.json."""
    PROMPT_PRESETS_FILE.parent.mkdir(parents=True, exist_ok=True)
    PROMPT_PRESETS_FILE.write_text(json.dumps(presets, ensure_ascii=False, indent=2), encoding="utf-8")


def create_prompt_preset(
    name: str,
    prompt: str,
    content_mode: str = "custom",
    description: str | None = None,
) -> dict[str, Any]:
    """Tạo mới một preset thể loại nội dung kèm prompt tùy chỉnh."""
    from datetime import datetime, timezone
    presets = get_all_prompt_presets()
    preset_id = f"custom_{uuid.uuid4().hex[:8]}"
    now_iso = datetime.now(timezone.utc).isoformat()
    new_item = {
        "id": preset_id,
        "name": name.strip(),
        "content_mode": content_mode or "custom",
        "description": description.strip() if description else f"Mẫu {name.strip()} do người dùng tạo",
        "prompt": prompt.strip(),
        "is_system": False,
        "updated_at": now_iso,
    }
    presets.append(new_item)
    save_prompt_presets(presets)
    return new_item


def update_prompt_preset(
    preset_id: str,
    name: str | None = None,
    prompt: str | None = None,
    description: str | None = None,
) -> dict[str, Any]:
    """Cập nhật tên, prompt hoặc mô tả của một preset."""
    from datetime import datetime, timezone
    presets = get_all_prompt_presets()
    found = None
    for p in presets:
        if p["id"] == preset_id:
            found = p
            break
    if not found:
        raise ValueError(f"Không tìm thấy preset có ID '{preset_id}'")
    if name is not None and name.strip():
        found["name"] = name.strip()
    if prompt is not None and prompt.strip():
        found["prompt"] = prompt.strip()
    if description is not None:
        found["description"] = description.strip()
    found["updated_at"] = datetime.now(timezone.utc).isoformat()
    save_prompt_presets(presets)
    return found


def delete_prompt_preset(preset_id: str) -> bool:
    """Xóa một preset tùy chỉnh (mẫu hệ thống is_system=True không được xóa)."""
    presets = get_all_prompt_presets()
    for p in presets:
        if p["id"] == preset_id:
            if p.get("is_system"):
                raise ValueError("Không thể xóa mẫu kịch bản mặc định của hệ thống!")
            presets.remove(p)
            save_prompt_presets(presets)
            return True
    raise ValueError(f"Không tìm thấy preset có ID '{preset_id}'")


def calculate_voiceover_word_range(
    clip_duration_seconds: int | float,
    min_words: int | None = None,
    max_words: int | None = None,
) -> tuple[int, int]:
    """Tính ngân sách lời thoại theo nhịp bán hàng chuẩn 2.0-2.4 từ/giây."""
    duration = max(1, round(float(clip_duration_seconds)))
    resolved_min = int(min_words) if min_words is not None else max(
        1, round(duration * workflow_settings.voiceover_words_per_second_min)
    )
    resolved_max = int(max_words) if max_words is not None else max(
        resolved_min, round(duration * workflow_settings.voiceover_words_per_second_max)
    )
    if resolved_min > resolved_max:
        raise ValueError("min_words không được lớn hơn max_words")
    return resolved_min, resolved_max


def extract_gemini_analysis_text(product_analysis: dict[str, Any] | None) -> str:
    """Trích xuất TOÀN BỘ nội dung phản hồi từ Gemini AI (rawText + cấu trúc bóc tách USPs)."""
    if not product_analysis or not isinstance(product_analysis, dict):
        return ""

    parts: list[str] = []

    # 1. Trích xuất các USPs và đặc điểm nổi bật
    selling_points = product_analysis.get("sellingPoints") or product_analysis.get("key_selling_points") or []
    if isinstance(selling_points, list) and selling_points:
        parts.append("Key Selling Points (USPs):\n" + "\n".join(f"- {usp}" for usp in selling_points if usp))

    features = product_analysis.get("features") or []
    if isinstance(features, list) and features:
        parts.append("Đặc điểm sản phẩm:\n" + "\n".join(f"- {f}" for f in features if f))

    classifications = product_analysis.get("classifications") or []
    if isinstance(classifications, list) and classifications:
        c_lines = ["Phân loại chi tiết:"]
        for c in classifications:
            if isinstance(c, dict):
                c_str = f"- Tên: {c.get('name', '')}"
                core_ben = c.get("coreBenefits") or c.get("core_benefits")
                if core_ben:
                    c_str += f" | Công dụng: {core_ben}"
                main_ing = c.get("mainIngredients") or c.get("main_ingredients")
                if main_ing:
                    c_str += f" | Thành phần: {main_ing}"
                c_lines.append(c_str)
        if len(c_lines) > 1:
            parts.append("\n".join(c_lines))

    # 2. TOÀN BỘ PHẢN HỒI GỐC DẠNG VĂN BẢN TỪ GEMINI (rawText)
    raw_text = (
        product_analysis.get("rawText")
        or product_analysis.get("raw_text")
        or product_analysis.get("product_features")
        or ""
    )
    if isinstance(raw_text, str) and raw_text.strip():
        parts.append(f"Toàn bộ phân tích chi tiết từ Gemini AI:\n{raw_text.strip()}")

    return "\n\n".join(parts)


def extract_usp_text(product_analysis: dict[str, Any] | None) -> str:
    """Trích xuất riêng danh sách Key Selling Points (USP) từ kết quả Gemini."""
    if not product_analysis or not isinstance(product_analysis, dict):
        return ""
    selling_points = product_analysis.get("sellingPoints") or product_analysis.get("key_selling_points") or []
    if isinstance(selling_points, list) and selling_points:
        return "\n".join(f"- {usp}" for usp in selling_points if usp)
    return ""


def format_product_data_from_structured(
    product_data: str,
    product_analysis: dict[str, Any] | None = None,
    assets: dict[str, Any] | None = None,
    scene_config: dict[str, Any] | None = None,
    script_config: dict[str, Any] | None = None,
) -> str:
    """Định dạng dữ liệu sản phẩm từ Object sang văn bản chi tiết cho ChatGPT, lưu toàn bộ phản hồi Gemini."""
    sections: list[str] = []

    # 1. Văn bản mô tả sản phẩm ban đầu từ người dùng (nếu có)
    user_desc = (product_data or "").strip()
    if user_desc:
        sections.append(f"Mô tả sản phẩm:\n{user_desc}")

    # 2. TOÀN BỘ PHẢN HỒI TỪ GEMINI AI (Không dùng elif để không bị nuốt mất dữ liệu)
    gemini_text = extract_gemini_analysis_text(product_analysis)
    if gemini_text:
        sections.append(f"Phân tích chuyên sâu từ Gemini AI:\n{gemini_text}")

    # 3. Tài nguyên hình ảnh đính kèm
    if assets:
        prods = assets.get("products", [])
        prod_count = len(prods) if isinstance(prods, list) else 0
        has_model = bool(assets.get("model"))
        has_scene = bool(assets.get("scene"))
        asset_notes = []
        if prod_count > 0:
            asset_notes.append(f"{prod_count} ảnh sản phẩm thực tế")
        if has_model:
            asset_notes.append("Có ảnh người mẫu / KOL tham chiếu")
        if has_scene:
            asset_notes.append("Có ảnh bối cảnh / không gian quay")
        if asset_notes:
            sections.append("Tài nguyên hình ảnh đính kèm: " + ", ".join(asset_notes))

    # 4. Canonical Character & Scene Profile (English)
    if script_config:
        char_profile = script_config.get("character_profile", "") or ""
        scene_profile_text = script_config.get("scene_profile", "") or ""
        if char_profile.strip():
            sections.append(f"Character Profile (English — inject into visual_direction):\n{char_profile.strip()}")
        if scene_profile_text.strip():
            sections.append(f"Scene / Environment Profile (English — inject into visual_direction):\n{scene_profile_text.strip()}")

    target_count = None
    if script_config and script_config.get("count"):
        target_count = script_config.get("count")
    elif scene_config and scene_config.get("count"):
        target_count = scene_config.get("count")

    if target_count:
        story_mode = (script_config or {}).get("story_mode", "sequential")
        mode_label = "liên hoàn theo phễu bán hàng" if story_mode == "sequential" else "độc lập"
        sections.append(f"Yêu cầu kịch bản: Tạo đúng {target_count} phân cảnh {mode_label}.")

    if script_config:
        clip_duration = script_config.get("clip_duration_seconds")
        if clip_duration:
            sections.append(
                f"Đầu ra Google Flow: Mỗi phân cảnh tạo một clip dài {clip_duration} giây."
            )

    return "\n\n".join(sections) if sections else "Chưa có văn bản mô tả, hãy quan sát kỹ ảnh sản phẩm đính kèm để trích xuất USP."


def execute_gpt_script_generation(
    product_data: str,
    images: list[str] | None = None,
    product_analysis: dict[str, Any] | None = None,
    assets: dict[str, Any] | None = None,
    scene_config: dict[str, Any] | None = None,
    script_config: dict[str, Any] | None = None,
    prompt_template: str | None = None,
    model: str | None = None,
) -> tuple[str, str]:
    """Gọi 9Router / ChatGPT để sinh kịch bản video bán hàng từ Object có cấu trúc."""
    cfg = read_config().get("chatgpt_9router", {})
    endpoint = cfg.get("endpoint", "http://localhost:20128/v1")
    api_key = cfg.get("api_key", "").strip() or get_local_cli_secret()
    target_model = model or resolve_default_script_model(cfg)

    # Đảm bảo 9Router đang chạy nếu dùng endpoint 20128
    if "20128" in endpoint and not is_9router_running(20128):
        logger.info("[Workflow] 9Router chưa chạy, tiến hành khởi động trên port 20128...")
        ensure_9router_running(20128)

    target_count = 3
    if script_config and script_config.get("count"):
        target_count = int(script_config["count"])
    elif scene_config and scene_config.get("count"):
        target_count = int(scene_config["count"])

    content_mode = "sales"
    if script_config and script_config.get("content_mode"):
        content_mode = str(script_config["content_mode"])

    platform = "auto"
    if script_config and script_config.get("platform"):
        platform = str(script_config["platform"])

    clip_duration_seconds = workflow_settings.clip_duration_seconds
    if script_config and script_config.get("clip_duration_seconds"):
        clip_duration_seconds = int(script_config["clip_duration_seconds"])

    min_words, max_words = calculate_voiceover_word_range(
        clip_duration_seconds,
        script_config.get("min_words") if script_config else None,
        script_config.get("max_words") if script_config else None,
    )

    template = (prompt_template or "").strip() or get_default_gpt_prompt()
    user_desc = (product_data or "").strip()
    gemini_text = extract_gemini_analysis_text(product_analysis)
    usp_text = extract_usp_text(product_analysis)

    unified_data_str = format_product_data_from_structured(
        product_data,
        product_analysis,
        assets,
        scene_config,
        script_config,
    )

    # 1. Thay thế các biến mở rộng tường minh
    filled_prompt = template
    # Nếu template có {{GEMINI_ANALYSIS}} hoặc {{PRODUCT_ANALYSIS}}
    filled_prompt = re.sub(
        r"\{\{\s*(?:GEMINI_ANALYSIS|PRODUCT_ANALYSIS)\s*\}\}",
        gemini_text or "Đã phân tích từ hình ảnh sản phẩm đính kèm.",
        filled_prompt,
        flags=re.IGNORECASE,
    )
    # Thay thế {{USP}} hoặc {{SELLING_POINTS}}
    filled_prompt = re.sub(
        r"\{\{\s*(?:USP|SELLING_POINTS)\s*\}\}",
        usp_text or "Tập trung vào công năng nổi bật của sản phẩm.",
        filled_prompt,
        flags=re.IGNORECASE,
    )

    # Nếu template có cả {{PRODUCT_DATA}} và {{GEMINI_ANALYSIS}}, thì {{PRODUCT_DATA}} chỉ chứa mô tả gốc
    # Nếu template chỉ dùng {{PRODUCT_DATA}}, thì điền unified_data_str (gộp cả 2 để tương thích ngược)
    has_explicit_gemini_var = bool(
        re.search(r"\{\{\s*(?:GEMINI_ANALYSIS|PRODUCT_ANALYSIS)\s*\}\}", template, flags=re.IGNORECASE)
    )
    product_data_replacement = user_desc if (has_explicit_gemini_var and user_desc) else unified_data_str
    filled_prompt = re.sub(r"\{\{\s*PRODUCT_DATA\s*\}\}", product_data_replacement, filled_prompt, flags=re.IGNORECASE)

    # Thay thế các biến tham số kỹ thuật
    filled_prompt = re.sub(r"\{\{\s*SCRIPT_COUNT\s*\}\}", str(target_count), filled_prompt, flags=re.IGNORECASE)
    filled_prompt = re.sub(r"\{\{\s*CONTENT_MODE\s*\}\}", content_mode, filled_prompt, flags=re.IGNORECASE)
    filled_prompt = re.sub(r"\{\{\s*PLATFORM\s*\}\}", platform, filled_prompt, flags=re.IGNORECASE)
    filled_prompt = re.sub(r"\{\{\s*CLIP_DURATION\s*\}\}", str(clip_duration_seconds), filled_prompt, flags=re.IGNORECASE)
    filled_prompt = re.sub(r"\{\{\s*MIN_WORDS\s*\}\}", str(min_words), filled_prompt, flags=re.IGNORECASE)
    filled_prompt = re.sub(r"\{\{\s*MAX_WORDS\s*\}\}", str(max_words), filled_prompt, flags=re.IGNORECASE)

    # 2. Tự động gắn Dữ liệu sản phẩm & Phân tích Gemini nếu prompt chưa có bất kỳ biến nào
    has_any_data_var = bool(
        re.search(r"\{\{\s*(?:PRODUCT_DATA|GEMINI_ANALYSIS|PRODUCT_ANALYSIS|USP|SELLING_POINTS)\s*\}\}", template, flags=re.IGNORECASE)
    )
    if not has_any_data_var:
        filled_prompt = f"{filled_prompt}\n\n[Dữ liệu sản phẩm & Toàn bộ phân tích từ Gemini AI]:\n{unified_data_str}"

    # 3. Tự động bù đắp (Auto-Injection) cấu trúc JSON & Quy tắc song ngữ nếu prompt người dùng thiếu
    has_json_contract = bool(
        re.search(r'["\']scripts["\']\s*:', template)
        and re.search(r'visual_direction', template, flags=re.IGNORECASE)
    )
    if not has_json_contract:
        auto_json_contract = (
            f"\n\n--- ĐỊNH DẠNG ĐẦU RA BẮT BUỘC (MANDATORY OUTPUT FORMAT) ---\n"
            f"Chỉ trả về DUY NHẤT một JSON object hợp lệ, tuyệt đối không dùng Markdown (không viết ```json) và không giải thích ngoài JSON:\n"
            f'{{\n'
            f'  "scripts": [\n'
            f'    {{\n'
            f'      "phase": "Hook | Reveal | Demo | CTA",\n'
            f'      "angle": "Tên góc tiếp cận phân cảnh",\n'
            f'      "title": "Tên phân cảnh ngắn",\n'
            f'      "visual_direction": "Cinematic visual direction in English for Google Veo, including camera motion, lighting, character action and product details",\n'
            f'      "voiceover": "Toàn bộ lời thoại tiếng Việt liền mạch từ {min_words} đến {max_words} từ",\n'
            f'      "on_screen_text": "Text ngắn tiếng Việt hiển thị trên màn hình (3-6 từ)",\n'
            f'      "hook": "Câu mở đầu của phân cảnh",\n'
            f'      "cta": "Kêu gọi hành động (chỉ có ở phân cảnh cuối, các phân cảnh trước để trống \'\')"\n'
            f'    }}\n'
            f'  ]\n'
            f'}}\n\n'
            f"QUY TẮC BẮT BUỘC VỀ NGÔN NGỮ & ĐỘ DÀI:\n"
            f'1. Mảng "scripts" phải có CHÍNH XÁC {target_count} phần tử tương ứng {target_count} clip {clip_duration_seconds} giây.\n'
            f'2. visual_direction: 100% TIẾNG ANH điện ảnh cho Google Veo. Tuyệt đối không để Veo tự nói lời thoại.\n'
            f'3. voiceover: 100% TIẾNG VIỆT tự nhiên bắt tai, chuẩn xác {min_words}-{max_words} từ/phân cảnh.\n'
            f'4. on_screen_text: Text tiếng Việt ngắn gọn 3-6 từ.'
        )
        filled_prompt = f"{filled_prompt}\n{auto_json_contract}"

    # Các bất biến của pipeline nằm ở system prompt để prompt người dùng vẫn tùy biến được.
    story_mode = (script_config or {}).get("story_mode", "sequential") if script_config else "sequential"
    if story_mode == "sequential":
        mode_instruction = (
            f"Tạo chính xác {target_count} phân cảnh liên hoàn theo phễu bán hàng video ngắn TikTok: "
            f"Hook → Reveal → Demo → CTA. Tất cả phân cảnh tạo thành 1 cốt truyện duy nhất xuyên suốt. "
            f"CHỈ đặt CTA ở phân cảnh cuối cùng, các phân cảnh trước KHÔNG có CTA. "
        )
    else:
        mode_instruction = f"Tạo chính xác {target_count} kịch bản độc lập, mỗi kịch bản có CTA riêng. "

    system_instruction = (
        f"{mode_instruction}"
        f"Mỗi phân cảnh tương ứng với đúng một clip Google Flow dài {clip_duration_seconds} giây. "
        f"Lời thoại mỗi phân cảnh từ {min_words} đến {max_words} từ tiếng Việt. "
        "QUY TẮC NGÔN NGỮ BẮT BUỘC: "
        "1) visual_direction PHẢI viết 100% TIẾNG ANH dùng thuật ngữ điện ảnh (camera motion, lighting, character action). "
        "2) voiceover PHẢI viết 100% TIẾNG VIỆT nhịp nhanh bắt tai. "
        "3) Nếu có Character Profile, bắt buộc lồng mô tả nhân vật vào visual_direction bằng tiếng Anh. "
        "4) Cuối visual_direction bắt buộc có dòng: 'The narrator speaks naturally in Vietnamese: \"[trích voiceover]\"'. "
        "Chỉ sử dụng dữ liệu đầu vào; không tự tạo claim. "
        "Chỉ trả về JSON object hợp lệ theo dạng {\"scripts\": [...]}, không dùng Markdown."
    )

    # Lọc ảnh hợp lệ
    valid_images = [img for img in (images or []) if img and img.strip()]

    # Gọi chat_completion
    res = chat_completion(
        endpoint=endpoint,
        api_key=api_key,
        model=target_model,
        prompt=filled_prompt,
        system_prompt=system_instruction,
        images=valid_images if valid_images else None,
        timeout=120.0,
    )

    if not res.get("ok"):
        # Fallback model nếu model chỉ định gặp lỗi
        fallback_models = ["cx/gpt-5.4", "ag/gemini-3-flash", "gh/gpt-4o", "ag/gemini-pro-agent"]
        for fb in fallback_models:
            if fb != target_model:
                logger.warning(f"[Workflow] Thử lại kịch bản với model fallback: {fb}")
                res = chat_completion(
                    endpoint=endpoint,
                    api_key=api_key,
                    model=fb,
                    prompt=filled_prompt,
                    system_prompt=system_instruction,
                    images=valid_images if valid_images else None,
                    timeout=120.0,
                )
                if res.get("ok"):
                    target_model = fb
                    break

    if not res.get("ok"):
        raise RuntimeError(f"Lỗi khi gọi ChatGPT qua 9Router: {res.get('error', 'Không xác định')}")

    return res.get("content", ""), target_model


def parse_gpt_scripts(raw_text: str, expected_count: int = 3) -> list[GptScriptItem]:
    """Tách kịch bản theo số lượng expected_count từ phản hồi JSON hoặc Markdown của GPT."""
    scripts: list[GptScriptItem] = []

    # 1. Thử phân giải JSON (nếu model trả về dạng JSON block)
    json_match = re.search(r"```(?:json)?\s*(.*?)\s*```", raw_text, re.DOTALL | re.IGNORECASE)
    candidate_json = json_match.group(1).strip() if json_match else raw_text.strip()
    if not (candidate_json.startswith("{") and candidate_json.endswith("}")):
        object_start = candidate_json.find("{")
        object_end = candidate_json.rfind("}")
        if object_start >= 0 and object_end > object_start:
            candidate_json = candidate_json[object_start:object_end + 1]

    if candidate_json.startswith("{") and candidate_json.endswith("}"):
        try:
            data = json.loads(candidate_json)
            raw_items = data.get("scripts") or data.get("items") or []
            if isinstance(raw_items, list) and len(raw_items) > 0:
                for idx, item in enumerate(raw_items):
                    if not isinstance(item, dict):
                        continue
                    phase = item.get("phase") or None
                    angle = item.get("angle") or ""
                    title = item.get("title") or ""
                    voiceover = item.get("voiceover") or item.get("voice_over")
                    visual = item.get("visual_direction") or item.get("visualDirection") or item.get("visual")
                    on_screen = item.get("on_screen_text") or item.get("onScreenText")
                    content = item.get("content") or voiceover or ""
                    hook = item.get("hook")
                    problem = item.get("problem")
                    prod = item.get("product")
                    benefits = item.get("benefits")
                    cta = item.get("cta")

                    scripts.append(
                        GptScriptItem(
                            phase=phase,
                            angle=angle,
                            title=title,
                            content=content,
                            voiceover=voiceover,
                            visual_direction=visual,
                            on_screen_text=on_screen,
                            hook=hook,
                            problem=problem,
                            product=prod,
                            benefits=benefits,
                            cta=cta,
                            word_count=len(content.split()),
                        )
                    )
                # Không cắt bớt output JSON ở tầng parser. Tầng validation cần
                # nhìn thấy số lượng thực để phát hiện model trả thừa/thiếu và
                # kích hoạt đúng một lượt repair.
                return scripts
        except Exception:
            pass  # Nếu JSON parse lỗi, tiếp tục fallback sang Markdown bên dưới

    # 2. Markdown Parser (Hỗ trợ số lượng động bất kỳ)
    # Tìm các vị trí xuất hiện của từng Góc / Kịch bản / Phân cảnh / Heading
    pattern = r"(?:^|\n)(?:#{1,4}\s*|\*{1,2}|)(?:[0-9]+[\.\)]\s*)?(Góc\s*\d+[^\n]*|Kịch\s*bản\s*\d+[^\n]*|Phân\s*cảnh\s*\d+[^\n]*|Cảnh\s*\d+[^\n]*|Option\s*\d+[^\n]*|Script\s*\d+[^\n]*)"
    matches = list(re.finditer(pattern, raw_text, re.IGNORECASE))

    # Nếu không tìm thấy bằng regex góc, thử tìm theo số thứ tự ### 1. / ### 2. / ### 3.
    if len(matches) < expected_count:
        alt_pattern = r"(?:^|\n)(?:#{1,4}\s*|\*{1,2})([0-9]+[\.\)]\s*[^\n]+)"
        alt_matches = list(re.finditer(alt_pattern, raw_text))
        if len(alt_matches) >= 2:
            matches = alt_matches

    if len(matches) >= 1:
        for idx, m in enumerate(matches):
            header = m.group(1).strip("*# :")
            start_pos = m.end()
            end_pos = matches[idx + 1].start() if idx + 1 < len(matches) else len(raw_text)
            chunk = raw_text[start_pos:end_pos].strip()

            def extract_section_text(keywords: list[str], text_block: str) -> str | None:
                kw_pattern = r"(?:^|\n)[-*•\d\.\s]*\*{0,2}(?:" + "|".join(keywords) + r")\*{0,2}[:\s\-]+"
                match = re.search(kw_pattern, text_block, re.IGNORECASE)
                if not match:
                    return None
                start = match.end()
                next_kw_pattern = r"(?:^|\n)[-*•\d\.\s]*\*{0,2}(?:Hook|Mở đầu|Vấn đề|Nhu cầu|Sản phẩm|Lợi ích|CTA|Kêu gọi|Góc|Kịch bản|Phân cảnh|Cảnh|Visual|Hình ảnh|Gợi ý hình ảnh|Voiceover|Lời thoại|Thoại|Text|Chữ)\*{0,2}[:\s\-]+"
                next_match = re.search(next_kw_pattern, text_block[start:], re.IGNORECASE)
                if next_match:
                    val = text_block[start:start + next_match.start()].strip()
                else:
                    val = text_block[start:].strip()
                return val if val else None

            hook_val = extract_section_text([r"Hook", r"Mở đầu"], chunk)
            problem_val = extract_section_text([r"Vấn đề(?:/nhu cầu)?", r"Vấn đề", r"Nhu cầu"], chunk)
            prod_val = extract_section_text([r"Sản phẩm"], chunk)
            benefit_val = extract_section_text([r"Lợi ích(?: chính)?", r"Lợi ích", r"Điểm nổi bật"], chunk)
            cta_val = extract_section_text([r"CTA", r"Kêu gọi(?: hành động)?", r"Kêu gọi"], chunk)
            visual_val = extract_section_text([r"Visual(?: direction)?", r"Gợi ý hình ảnh", r"Hình ảnh", r"Góc quay"], chunk)
            voice_val = extract_section_text([r"Voiceover", r"Lời thoại", r"Thoại", r"Kịch bản đọc"], chunk)
            on_screen_val = extract_section_text([r"Text trên màn hình", r"Chữ trên màn hình", r"On-screen text", r"Text"], chunk)
            angle_val = extract_section_text([r"Góc tiếp cận", r"Angle"], chunk)

            # Ưu tiên angle do model tự đề xuất, không gán ba angle cố định theo vị trí.
            angle_name = angle_val or ""
            if not angle_name and ("Góc" in header or "Angle" in header):
                angle_match = re.search(r"(?:Góc|Angle)\s*[:\-]?\s*([^\-\n]+)", header, re.IGNORECASE)
                if angle_match:
                    angle_name = angle_match.group(1).strip()
                else:
                    angle_name = header
            elif not angle_name and " - " in header:
                parts = header.split(" - ")
                angle_name = parts[-1].strip()
            elif not angle_name:
                angle_name = re.sub(
                    r"^(?:Kịch\s*bản|Script|Option|Góc)\s*\d+\s*[:\-]?\s*",
                    "",
                    header,
                    flags=re.IGNORECASE,
                ).strip() or f"Kịch bản {idx + 1}"

            main_content = voice_val if voice_val else chunk

            scripts.append(
                GptScriptItem(
                    angle=angle_name,
                    title=header,
                    content=main_content,
                    voiceover=voice_val,
                    visual_direction=visual_val,
                    on_screen_text=on_screen_val,
                    hook=hook_val,
                    problem=problem_val,
                    product=prod_val,
                    benefits=benefit_val,
                    cta=cta_val,
                    word_count=len(main_content.split()),
                )
            )

    if len(scripts) < expected_count:
        raise ValueError(
            f"Không thể phân tách đủ {expected_count} kịch bản từ kết quả phản hồi của mô hình GPT (tìm thấy {len(scripts)}/{expected_count}). "
            f"Vui lòng đảm bảo prompt yêu cầu rõ {expected_count} kịch bản riêng biệt."
        )

    return scripts[:expected_count]


def validate_gpt_scripts(
    scripts: list[GptScriptItem],
    expected_count: int,
    min_words: int,
    max_words: int,
) -> None:
    """Kiểm tra contract trước khi dữ liệu được phép đi tiếp sang Google Flow."""
    errors: list[str] = []
    if len(scripts) != expected_count:
        errors.append(f"Cần đúng {expected_count} kịch bản, nhận được {len(scripts)}")

    seen_angles: set[str] = set()
    # CTA chỉ bắt buộc ở phân cảnh cuối (sequential mode)
    base_required_fields = (
        ("angle", "góc tiếp cận"),
        ("title", "tiêu đề"),
        ("hook", "hook"),
        ("visual_direction", "gợi ý hình ảnh"),
        ("voiceover", "lời thoại"),
        ("on_screen_text", "chữ trên màn hình"),
    )

    for index, script in enumerate(scripts, start=1):
        for field_name, label in base_required_fields:
            value = getattr(script, field_name, None)
            if not isinstance(value, str) or not value.strip():
                errors.append(f"Kịch bản {index} thiếu {label}")

        # CTA chỉ bắt buộc ở phân cảnh cuối cùng
        is_last = (index == expected_count)
        if is_last:
            cta_val = getattr(script, "cta", None)
            if not isinstance(cta_val, str) or not cta_val.strip():
                errors.append(f"Kịch bản {index} (phân cảnh cuối) thiếu CTA")

        voiceover = (script.voiceover or script.content or "").strip()
        word_count = len(voiceover.split())
        script.word_count = word_count
        if word_count < min_words or word_count > max_words:
            errors.append(
                f"Kịch bản {index} có {word_count} từ lời thoại; yêu cầu {min_words}-{max_words} từ"
            )

        normalized_angle = re.sub(r"\s+", " ", (script.angle or "").strip().casefold())
        if normalized_angle:
            if normalized_angle in seen_angles:
                errors.append(f"Kịch bản {index} trùng góc tiếp cận với kịch bản trước")
            seen_angles.add(normalized_angle)

    if errors:
        raise ValueError("; ".join(errors))


def generate_validated_gpt_scripts(
    product_data: str,
    images: list[str] | None = None,
    product_analysis: dict[str, Any] | None = None,
    assets: dict[str, Any] | None = None,
    scene_config: dict[str, Any] | None = None,
    script_config: dict[str, Any] | None = None,
    prompt_template: str | None = None,
    model: str | None = None,
) -> tuple[str, str, list[GptScriptItem], bool, int, int, int]:
    """Sinh, parse và validate; nếu sai contract thì yêu cầu model tự sửa đúng một lần."""
    config = script_config or {}
    expected_count = int(config.get("count") or (scene_config or {}).get("count") or 3)
    clip_duration = int(config.get("clip_duration_seconds") or workflow_settings.clip_duration_seconds)
    min_words, max_words = calculate_voiceover_word_range(
        clip_duration,
        config.get("min_words"),
        config.get("max_words"),
    )

    raw_text, used_model = execute_gpt_script_generation(
        product_data=product_data,
        images=images,
        product_analysis=product_analysis,
        assets=assets,
        scene_config=scene_config,
        script_config=script_config,
        prompt_template=prompt_template,
        model=model,
    )

    try:
        scripts = parse_gpt_scripts(raw_text, expected_count=expected_count)
        validate_gpt_scripts(scripts, expected_count, min_words, max_words)
        return raw_text, used_model, scripts, False, clip_duration, min_words, max_words
    except ValueError as first_error:
        repair_prompt = (
            "Hãy sửa kết quả không hợp lệ bên dưới. Chỉ trả về một JSON object hợp lệ có key "
            f"\"scripts\" chứa đúng {expected_count} phần tử. Mỗi phần tử bắt buộc có angle, title, "
            "hook, visual_direction, voiceover, on_screen_text và cta. "
            f"Voiceover phải là toàn bộ lời đọc từ hook đến CTA và có {min_words}-{max_words} từ. "
            "Các angle phải khác nhau.\n\n"
            f"Lỗi cần sửa:\n{first_error}\n\n"
            f"Kết quả cũ:\n{raw_text[:12000]}"
        )
        repaired_raw, repaired_model = execute_gpt_script_generation(
            product_data=product_data,
            images=images,
            product_analysis=product_analysis,
            assets=assets,
            scene_config=scene_config,
            script_config=script_config,
            prompt_template=repair_prompt,
            model=used_model,
        )
        scripts = parse_gpt_scripts(repaired_raw, expected_count=expected_count)
        validate_gpt_scripts(scripts, expected_count, min_words, max_words)
        return repaired_raw, repaired_model, scripts, True, clip_duration, min_words, max_words


# ─────────────────────────────────────────────────────────────────────────────
# Asset Storage & Video Export
# ─────────────────────────────────────────────────────────────────────────────

WORKFLOW_ASSETS_DIR = DATA_DIR / "workflow_assets"
WORKFLOW_EXPORTS_DIR = DATA_DIR / "workflow_exports"
VEO_DATA_DIR = DATA_DIR / "media" / "veo_outputs"


def save_workflow_asset(file_bytes: bytes, filename: str, kind: str = "product") -> WorkflowAssetUploadResponse:
    """Lưu file tải lên vào thư mục workflow_assets trên disk và trả về thông tin AssetRef."""
    WORKFLOW_ASSETS_DIR.mkdir(parents=True, exist_ok=True)
    asset_id = str(uuid.uuid4())
    ext = Path(filename).suffix or ".jpg"
    safe_name = f"{asset_id}{ext}"
    target_path = WORKFLOW_ASSETS_DIR / safe_name
    target_path.write_bytes(file_bytes)

    ext_lower = ext.lower()
    mime = "image/png" if ext_lower in [".png"] else "image/webp" if ext_lower in [".webp"] else "image/jpeg"
    b64 = base64.b64encode(file_bytes).decode("ascii")
    data_url = f"data:{mime};base64,{b64}"

    return WorkflowAssetUploadResponse(
        id=asset_id,
        kind=kind,
        preview_url=f"/api/workflow/assets/{asset_id}",
        backend_path=str(target_path.resolve()),
        file_name=filename,
        size_bytes=len(file_bytes),
        data_url=data_url,
    )


def import_veo_image_to_workflow(image_id: str, kind: str = "product") -> WorkflowAssetUploadResponse:
    """Import một ảnh từ Thư viện Veo Studio thành một Asset chính thức của Workflow."""
    from app.veo import service as veo_service

    clean_id = (image_id or "").strip()
    if not clean_id:
        raise ValueError("image_id không được để trống.")

    file_path = veo_service.get_image_file_path(clean_id)
    file_bytes: bytes | None = None
    filename: str = f"{clean_id}.jpg"

    # 1. Nếu file đã có sẵn trên đĩa trong veo_images: đọc bytes trực tiếp
    if file_path and file_path.exists() and file_path.stat().st_size > 0:
        file_bytes = file_path.read_bytes()
        filename = file_path.name

    # 2. Nếu chưa có trên đĩa, tra cứu trong DB VeoImage
    if not file_bytes:
        img = veo_service.get_image_by_id(clean_id)
        if img and img.image_url:
            cdn_url = img.image_url.strip()
            if cdn_url.startswith("http://") or cdn_url.startswith("https://"):
                try:
                    logger.info("[Workflow] Đang tải ảnh %s từ CDN Veo: %s", clean_id, cdn_url[:80])
                    with httpx.Client(timeout=30.0, follow_redirects=True) as client:
                        resp = client.get(cdn_url)
                        if resp.status_code == 200 and len(resp.content) > 0:
                            file_bytes = resp.content
                            try:
                                if file_path:
                                    file_path.write_bytes(file_bytes)
                            except Exception:
                                pass
                except Exception as dl_err:
                    logger.warning("[Workflow] Lỗi khi tải ảnh từ CDN Veo: %s", dl_err)

    # 3. Fallback: tìm kiếm thêm trong các thư mục media chuẩn
    if not file_bytes:
        for candidate_dir in [
            DATA_DIR / "media" / "veo_images",
            DATA_DIR / "media" / "veo_outputs",
            DATA_DIR / "media" / "veo_uploads",
        ]:
            cand = candidate_dir / f"{clean_id}.jpg"
            if cand.exists() and cand.stat().st_size > 0:
                file_bytes = cand.read_bytes()
                filename = cand.name
                break

    if not file_bytes:
        raise FileNotFoundError(f"Không tìm thấy ảnh '{clean_id}' trong thư viện Veo Studio.")

    return save_workflow_asset(file_bytes=file_bytes, filename=filename, kind=kind)


def get_workflow_asset_path(asset_id: str) -> Path | None:
    """Tìm đường dẫn file thật trên disk theo asset_id."""
    WORKFLOW_ASSETS_DIR.mkdir(parents=True, exist_ok=True)
    for f in WORKFLOW_ASSETS_DIR.iterdir():
        if f.stem == asset_id or f.name.startswith(f"{asset_id}_") or f.name.startswith(f"{asset_id}."):
            return f
    return None


def sync_voiceover_to_scenes(
    scene_video_paths: list[Path],
    voiceover_audio_path: Path,
    work_dir: Path,
) -> Path:
    """Đồng bộ thời lượng voiceover cho khớp từng phân cảnh video (Per-scene time sync):

    1. Tìm các file vo_i.wav riêng lẻ trong cùng thư mục của voiceover_audio_path (nếu được sinh từ batch).
    2. Với mỗi phân cảnh i:
       - Đo thời lượng video clip T_i (ffprobe_duration)
       - Đo thời lượng audio clip D_i (ffprobe_duration)
       - Nếu D_i > T_i: tăng tốc bằng FFmpeg filter atempo=(D_i / T_i) (cap 1.30x) để vừa khít T_i.
       - Nếu D_i <= T_i: giữ nguyên tốc độ tự nhiên, đệm khoảng lặng apad để đạt đủ T_i.
    3. Ghép nối các đoạn synced_vo_i.wav thành synced_combined.wav có tổng thời lượng = sum(T_i).
    4. Nếu không tìm thấy các file riêng lẻ: co giãn toàn bộ file theo tổng thời lượng video.
    """
    work_dir.mkdir(parents=True, exist_ok=True)
    parent_dir = voiceover_audio_path.parent

    vo_item_paths: list[Path] = []
    for i in range(len(scene_video_paths)):
        cand = parent_dir / f"vo_{i}.wav"
        if cand.exists() and cand.is_file():
            vo_item_paths.append(cand)
        else:
            break

    if len(vo_item_paths) == len(scene_video_paths) and len(vo_item_paths) > 0:
        logger.info(f"[AudioSync] Bắt đầu đồng bộ riêng biệt {len(vo_item_paths)} phân cảnh voiceover theo từng clip video...")
        synced_segment_paths: list[Path] = []
        for i, (v_path, a_path) in enumerate(zip(scene_video_paths, vo_item_paths)):
            t_vid = max(1.0, ffprobe_duration(v_path))
            t_aud = max(0.1, ffprobe_duration(a_path))
            out_synced = work_dir / f"synced_vo_{i}.wav"
            out_synced.unlink(missing_ok=True)

            if t_aud > t_vid:
                factor = min(1.30, t_aud / t_vid)
                cmd = [
                    "ffmpeg", "-y",
                    "-i", str(a_path),
                    "-filter:a", f"atempo={factor:.4f}",
                    "-t", f"{t_vid:.3f}",
                    str(out_synced),
                ]
            else:
                cmd = [
                    "ffmpeg", "-y",
                    "-i", str(a_path),
                    "-af", "apad",
                    "-t", f"{t_vid:.3f}",
                    str(out_synced),
                ]
            res = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
            if res.returncode == 0 and out_synced.exists() and out_synced.stat().st_size > 0:
                synced_segment_paths.append(out_synced)
            else:
                logger.warning(f"[AudioSync] Không thể sync clip {i}, dùng bản audio gốc: {res.stderr}")
                synced_segment_paths.append(a_path)

        synced_combined = work_dir / "synced_combined_vo.wav"
        synced_combined.unlink(missing_ok=True)
        try:
            concat_segments(synced_segment_paths, synced_combined, work_dir / "concat_temp")
            if synced_combined.exists() and synced_combined.stat().st_size > 0:
                logger.info(f"[AudioSync] Đồng bộ thành công {len(synced_segment_paths)} phân cảnh vào {synced_combined.name}")
                return synced_combined
        except Exception as err:
            logger.warning(f"[AudioSync] Lỗi khi ghép chuỗi synced segments: {err}")

    # Fallback nếu chỉ có 1 file audio tổng duy nhất:
    total_vid_dur = sum(max(1.0, ffprobe_duration(p)) for p in scene_video_paths)
    total_aud_dur = max(0.1, ffprobe_duration(voiceover_audio_path))
    if total_aud_dur > total_vid_dur:
        factor = min(1.30, total_aud_dur / total_vid_dur)
        fallback_synced = work_dir / "fallback_synced_vo.wav"
        fallback_synced.unlink(missing_ok=True)
        cmd = [
            "ffmpeg", "-y",
            "-i", str(voiceover_audio_path),
            "-filter:a", f"atempo={factor:.4f}",
            "-t", f"{total_vid_dur:.3f}",
            str(fallback_synced),
        ]
        res = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
        if res.returncode == 0 and fallback_synced.exists():
            return fallback_synced

    return voiceover_audio_path


def concat_workflow_scenes(
    scene_video_paths: list[str],
    bgm_path: str | None = None,
    output_filename: str | None = None,
    voiceover_audio_path: str | None = None,
    mix_original_audio: bool = False,
    bgm_track_ids: list[str] | None = None,
    bgm_volume: float = 0.10,
    veo_ambient_volume: float = 0.0,
) -> WorkflowExportResponse:
    """Ghép nối danh sách file video từng phân cảnh bằng FFmpeg concat_segments."""
    WORKFLOW_EXPORTS_DIR.mkdir(parents=True, exist_ok=True)
    job_id = str(uuid.uuid4())[:8]

    valid_paths: list[Path] = []
    for sp in scene_video_paths:
        p: Path | None = None

        # 1. Hỗ trợ phân giải tự động nếu nhận URL preview dạng:
        # /api/veo/history/{id}/file, /api/veo/outputs/{file}, /api/veo/stream/{file}, /api/workflow/exports/{file}
        veo_match = re.search(
            r"/api/(?:veo/(?:history/([^/]+)/file|outputs/([^/?#]+)|stream/([^/?#]+))|workflow/exports/([^/?#]+))",
            sp,
        )
        if veo_match:
            extracted_id = next((g for g in veo_match.groups() if g), None)
            if extracted_id:
                try:
                    from app.veo import service as veo_service
                    veo_path = (
                        veo_service.get_video_path(extracted_id)
                        or veo_service.get_video_path(Path(extracted_id).stem)
                    )
                    if veo_path and veo_path.exists() and veo_path.is_file():
                        p = veo_path
                except Exception as e:
                    logger.warning(f"Không thể phân giải extracted_id '{extracted_id}' từ URL: {e}")

        # 2. Thử phân giải trực tiếp qua Veo service (nhận ID '00066213-f95' hoặc tên file '00066213-f95.mp4')
        if p is None:
            try:
                from app.veo import service as veo_service
                clean_name = Path(sp).name
                veo_path = (
                    veo_service.get_video_path(sp)
                    or veo_service.get_video_path(clean_name)
                    or veo_service.get_video_path(Path(clean_name).stem)
                )
                if veo_path and veo_path.exists() and veo_path.is_file():
                    p = veo_path
            except Exception as e:
                logger.warning(f"Không thể tra cứu qua veo_service cho '{sp}': {e}")

        # 3. Thử tìm trực tiếp file path trên disk hoặc trong các thư mục media chuẩn
        if p is None:
            cand = Path(sp)
            if cand.exists() and cand.is_file():
                p = cand
            else:
                clean_name = Path(sp).name
                for candidate_dir in [
                    DATA_DIR,
                    DATA_DIR / "media" / "veo_outputs",
                    DATA_DIR / "media" / "workflow_exports",
                    WORKFLOW_ASSETS_DIR,
                    WORKFLOW_EXPORTS_DIR,
                ]:
                    test_p = candidate_dir / clean_name
                    if test_p.exists() and test_p.is_file():
                        p = test_p
                        break
                    if not clean_name.endswith(".mp4"):
                        test_mp4 = candidate_dir / f"{clean_name}.mp4"
                        if test_mp4.exists() and test_mp4.is_file():
                            p = test_mp4
                            break

        if p is None:
            raise FileNotFoundError(f"Không tìm thấy file video phân cảnh: {sp}")

        valid_paths.append(p)

    # Chống Path Traversal: Lấy duy nhất tên file cơ bản và lọc bỏ ký tự nguy hiểm
    base_name = Path(output_filename).name if output_filename else f"workflow_final_{job_id}.mp4"
    if not base_name.endswith(".mp4"):
        base_name += ".mp4"
    safe_name = re.sub(r"[^\w\-\.]", "_", base_name)
    out_file = (WORKFLOW_EXPORTS_DIR / safe_name).resolve()

    # Kiểm tra đường dẫn đích bắt buộc phải nằm trong WORKFLOW_EXPORTS_DIR
    if not str(out_file).startswith(str(WORKFLOW_EXPORTS_DIR.resolve())):
        raise ValueError(f"Tên file export không hợp lệ (nguy cơ path traversal): {output_filename}")

    work_dir = WORKFLOW_EXPORTS_DIR / f"temp_{job_id}"
    out_file.unlink(missing_ok=True)

    final_path = concat_segments(valid_paths, out_file, work_dir)

    def _has_audio_stream_local(p: Path) -> bool:
        try:
            probe = subprocess.run(
                ["ffprobe", "-v", "error", "-select_streams", "a:0", "-show_entries", "stream=index", "-of", "csv=p=0", str(p)],
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=15,
            )
            return bool((probe.stdout or "").strip())
        except Exception:
            return False

    # 1. Trộn Voiceover đồng bộ theo phân cảnh (loại bỏ hoàn toàn âm thanh gốc Veo)
    if voiceover_audio_path:
        vo_p: Path | None = None
        vo_str = voiceover_audio_path.strip()
        vo_match = re.search(r"/api/workflow/voiceovers/([^/]+)/([^/?#]+)", vo_str)
        if vo_match:
            job_sub, fn = vo_match.groups()
            cand_vo = VOICEOVER_DIR / job_sub / fn
            if cand_vo.exists():
                vo_p = cand_vo
        if vo_p is None:
            cand_vo = Path(vo_str)
            if cand_vo.exists() and cand_vo.is_file():
                vo_p = cand_vo

        if vo_p and vo_p.exists():
            mixed_output = WORKFLOW_EXPORTS_DIR / f"mixed_{safe_name}"
            try:
                # Đồng bộ thời lượng voiceover cho từng clip (tránh tràn âm sang cảnh khác)
                synced_vo = sync_voiceover_to_scenes(valid_paths, vo_p, work_dir)

                # Thay thế hoàn toàn âm thanh: chỉ lấy video từ 0:v và audio đồng bộ từ synced_vo (1:a)
                cmd = [
                    "ffmpeg", "-y",
                    "-i", str(final_path),
                    "-i", str(synced_vo),
                    "-map", "0:v",
                    "-map", "1:a",
                    "-c:v", "copy",
                    "-c:a", "aac",
                    "-shortest",
                    str(mixed_output),
                ]
                res = subprocess.run(cmd, capture_output=True, text=True, timeout=90)
                if res.returncode == 0 and mixed_output.exists():
                    final_path.unlink(missing_ok=True)
                    mixed_output.rename(final_path)
            except Exception as vo_err:
                logger.warning(f"[Export] Lỗi khi đồng bộ/trộn voiceover: {vo_err}")

    # 2. Trộn BGM (Polish pass) nếu có cấu hình nhạc nền
    resolved_bgm_paths: list[Path] = []
    if bgm_track_ids:
        try:
            from app.db import SessionLocal
            from app.media.service import resolve_for_polish
            with SessionLocal() as db:
                b_paths, _ = resolve_for_polish(db, bgm_track_ids)
                resolved_bgm_paths.extend(b_paths)
        except Exception as e:
            logger.warning(f"[Export] Lỗi resolve BGM track IDs {bgm_track_ids}: {e}")
    elif bgm_path:
        cand_bgm = Path(bgm_path)
        if cand_bgm.exists() and cand_bgm.is_file():
            resolved_bgm_paths.append(cand_bgm)
        else:
            test_bgm = DATA_DIR / "media" / "bgm" / cand_bgm.name
            if test_bgm.exists() and test_bgm.is_file():
                resolved_bgm_paths.append(test_bgm)

    if resolved_bgm_paths:
        polished_output = WORKFLOW_EXPORTS_DIR / f"polished_{safe_name}"
        polished_output.unlink(missing_ok=True)
        try:
            if _has_audio_stream_local(final_path):
                from app.recap.ffmpeg import polish_final
                polish_final(
                    src=final_path,
                    out=polished_output,
                    bgm_paths=resolved_bgm_paths,
                    volume=bgm_volume,
                    work_dir=work_dir,
                )
            else:
                # Video không có audio stream -> add trực tiếp BGM stream
                bgm_input = resolved_bgm_paths[0]
                cmd = [
                    "ffmpeg", "-y",
                    "-i", str(final_path),
                    "-stream_loop", "-1", "-i", str(bgm_input),
                    "-filter_complex", f"[1:a]volume={bgm_volume:.3f}[aout]",
                    "-map", "0:v", "-map", "[aout]",
                    "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
                    "-shortest",
                    str(polished_output),
                ]
                subprocess.run(cmd, capture_output=True, text=True, timeout=120)

            if polished_output.exists() and polished_output.stat().st_size > 0:
                final_path.unlink(missing_ok=True)
                polished_output.rename(final_path)
        except Exception as bgm_err:
            logger.warning(f"[Export] Lỗi khi hòa âm BGM (polish_final): {bgm_err}")

    duration = 0.0
    try:
        duration = ffprobe_duration(final_path)
    except Exception as e:
        logger.warning(f"Không đo được duration file hoàn chỉnh: {e}")

    # Ghi nhận vào metadata history
    now_iso = datetime.now(timezone.utc).isoformat()
    history = _load_exports_metadata()
    history[final_path.name] = {
        "id": job_id,
        "filename": final_path.name,
        "duration_sec": duration,
        "size_bytes": final_path.stat().st_size if final_path.exists() else 0,
        "created_at": now_iso,
        "scene_count": len(valid_paths),
        "aspect_ratio": "9:16",
        "resolution": "1080p",
        "title": f"Video {len(valid_paths)} cảnh ({int(duration)}s)",
    }
    _save_exports_metadata(history)

    return WorkflowExportResponse(
        job_id=job_id,
        final_video_url=f"/api/workflow/exports/{final_path.name}",
        file_path=str(final_path.resolve()),
        duration_sec=duration,
        status="done",
    )


def extract_character_scene_profiles(
    model_image: str | None = None,
    scene_image: str | None = None,
    model: str | None = None,
) -> tuple[str, str]:
    """
    Trích xuất Canonical Character Profile và Scene Profile bằng tiếng Anh chuẩn cho Veo
    từ ảnh người mẫu và ảnh bối cảnh được tải lên.
    """
    cfg = read_config()
    chatgpt_cfg = cfg.get("chatgpt", {})
    endpoint = chatgpt_cfg.get("endpoint", "http://localhost:20128/v1")
    api_key = chatgpt_cfg.get("api_key", "")
    if not api_key:
        api_key = get_local_cli_secret()

    target_model = model or chatgpt_cfg.get("model") or resolve_default_script_model(chatgpt_cfg)
    char_profile = ""
    scene_profile = ""

    # 1. Trích xuất Character Profile
    if model_image and model_image.strip():
        char_prompt = (
            "You are an expert Hollywood casting director and AI prompt engineer for video generators (Google Veo, Sora). "
            "Analyze the person/model in this image. Produce a concise, highly detailed Canonical Character Profile in English (1-2 sentences). "
            "Specify: apparent age, gender/ethnicity, hair style & color, facial expression, clothing style, colors, accessories, and overall vibe. "
            "Focus ONLY on the person. Do NOT describe the background, camera equipment, or photo quality. "
            "Output ONLY the descriptive profile text without preface or quotes."
        )
        try:
            res_char = chat_completion(
                endpoint=endpoint,
                api_key=api_key,
                model=target_model,
                prompt=char_prompt,
                images=[model_image.strip()],
                timeout=45.0,
            )
            if res_char.get("ok"):
                char_profile = res_char.get("content", "").strip().strip('"')
            else:
                logger.warning(f"Lỗi khi trích xuất character profile: {res_char.get('error')}")
        except Exception as e:
            logger.warning(f"Ngoại lệ khi trích xuất character profile: {e}")

    # 2. Trích xuất Scene Profile
    if scene_image and scene_image.strip():
        scene_prompt = (
            "You are an expert cinematographer and set designer for high-end commercials. "
            "Analyze the environment/background in this image. Produce a concise, highly detailed Canonical Scene/Environment Profile in English (1-2 sentences). "
            "Specify: interior/exterior setting, architectural style, specific decor elements, lighting style (e.g. soft natural morning sunlight, warm studio backlight), color palette, and atmosphere. "
            "Focus ONLY on the setting and environment. Do NOT describe any people. "
            "Output ONLY the descriptive profile text without preface or quotes."
        )
        try:
            res_scene = chat_completion(
                endpoint=endpoint,
                api_key=api_key,
                model=target_model,
                prompt=scene_prompt,
                images=[scene_image.strip()],
                timeout=45.0,
            )
            if res_scene.get("ok"):
                scene_profile = res_scene.get("content", "").strip().strip('"')
            else:
                logger.warning(f"Lỗi khi trích xuất scene profile: {res_scene.get('error')}")
        except Exception as e:
            logger.warning(f"Ngoại lệ khi trích xuất scene profile: {e}")

    return char_profile, scene_profile



EXPORTS_METADATA_FILE = WORKFLOW_EXPORTS_DIR / "exports_history.json"


def _load_exports_metadata() -> dict[str, dict]:
    WORKFLOW_EXPORTS_DIR.mkdir(parents=True, exist_ok=True)
    if not EXPORTS_METADATA_FILE.exists():
        return {}
    try:
        return json.loads(EXPORTS_METADATA_FILE.read_text(encoding="utf-8"))
    except Exception as e:
        logger.warning(f"Không thể đọc {EXPORTS_METADATA_FILE}: {e}")
        return {}


def _save_exports_metadata(data: dict[str, dict]):
    try:
        WORKFLOW_EXPORTS_DIR.mkdir(parents=True, exist_ok=True)
        EXPORTS_METADATA_FILE.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    except Exception as e:
        logger.warning(f"Không thể ghi {EXPORTS_METADATA_FILE}: {e}")


def list_exported_videos() -> list[dict]:
    """Liệt kê toàn bộ video đã xuất trên ổ đĩa, kết hợp metadata lịch sử và các clip Veo đã sinh."""
    WORKFLOW_EXPORTS_DIR.mkdir(parents=True, exist_ok=True)
    history = _load_exports_metadata()
    result = []
    seen_filenames = set()

    # 1. Quét tất cả file .mp4 trong WORKFLOW_EXPORTS_DIR (video ghép hoàn chỉnh)
    for p in WORKFLOW_EXPORTS_DIR.glob("*.mp4"):
        if not p.is_file():
            continue
        fname = p.name
        seen_filenames.add(fname)
        meta = history.get(fname, {})
        stat = p.stat()
        size_bytes = stat.st_size
        created_iso = meta.get("created_at") or datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat()
        dur = meta.get("duration_sec") or 0.0
        if dur == 0.0:
            try:
                dur = ffprobe_duration(p)
            except Exception:
                dur = 0.0

        item = {
            "id": meta.get("id") or fname.replace(".mp4", ""),
            "filename": fname,
            "video_url": f"/api/workflow/exports/{fname}",
            "file_path": str(p.resolve()),
            "size_bytes": size_bytes,
            "duration_sec": dur,
            "created_at": created_iso,
            "scene_count": meta.get("scene_count"),
            "aspect_ratio": meta.get("aspect_ratio") or "9:16",
            "resolution": meta.get("resolution") or "1080p",
            "title": meta.get("title") or f"Video Hoàn Chỉnh #{meta.get('id', fname)[:8]}",
            "source_type": "export",
            "prompt": meta.get("prompt"),
            "model_display_name": "FFmpeg Concat (1080p)",
        }
        result.append(item)

    # 2. Quét tất cả clip phân cảnh sinh từ Veo trong VEO_DATA_DIR
    if VEO_DATA_DIR.exists():
        for f in VEO_DATA_DIR.iterdir():
            if not f.is_file() or f.suffix.lower() not in (".mp4", ".webm", ".mkv"):
                continue
            if f.name in seen_filenames:
                continue
            seen_filenames.add(f.name)

            stat = f.stat()
            # Đọc file metadata sidecar JSON nếu có
            meta_path = f.with_suffix(".json")
            veo_meta: dict[str, Any] = {}
            if meta_path.exists():
                try:
                    veo_meta = json.loads(meta_path.read_text(encoding="utf-8"))
                except Exception:
                    pass

            dur = float(veo_meta.get("duration_seconds") or 0.0)
            created_iso = veo_meta.get("created_at") or datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat()
            prompt_text = veo_meta.get("prompt") or ""
            model_name = veo_meta.get("model_display_name") or "Google Veo 3.0"
            aspect_ratio = veo_meta.get("aspect_ratio") or "9:16"
            w = veo_meta.get("width")
            h = veo_meta.get("height")
            res_str = f"{w}x{h}" if w and h else "720p"

            display_title = prompt_text[:70].strip() if prompt_text else f"Clip Veo AI ({f.stem[:8]})"
            if len(prompt_text) > 70:
                display_title += "..."

            item = {
                "id": f.stem,
                "filename": f.name,
                "video_url": f"/api/workflow/exports/{f.name}",
                "file_path": str(f.resolve()),
                "size_bytes": stat.st_size,
                "duration_sec": dur,
                "created_at": created_iso,
                "scene_count": 1,
                "aspect_ratio": aspect_ratio,
                "resolution": res_str,
                "title": display_title,
                "source_type": "veo_scene",
                "prompt": prompt_text,
                "model_display_name": model_name,
            }
            result.append(item)

    # Sắp xếp mới nhất lên đầu
    result.sort(key=lambda x: x["created_at"], reverse=True)
    return result


def delete_exported_video(filename: str) -> bool:
    """Xóa file video đã xuất hoặc clip Veo trên ổ đĩa và cập nhật metadata."""
    base_name = Path(filename).name

    # 1. Thử tìm và xóa trong WORKFLOW_EXPORTS_DIR
    target = (WORKFLOW_EXPORTS_DIR / base_name).resolve()
    if str(target).startswith(str(WORKFLOW_EXPORTS_DIR.resolve())) and target.exists() and target.is_file():
        try:
            target.unlink()
        except Exception as e:
            logger.error(f"Lỗi khi xóa file {target}: {e}")
            raise

        history = _load_exports_metadata()
        if base_name in history:
            del history[base_name]
            _save_exports_metadata(history)
        return True

    # 2. Thử tìm và xóa trong VEO_DATA_DIR
    if VEO_DATA_DIR.exists():
        target_veo = (VEO_DATA_DIR / base_name).resolve()
        if str(target_veo).startswith(str(VEO_DATA_DIR.resolve())) and target_veo.exists() and target_veo.is_file():
            try:
                target_veo.unlink()
                sidecar = target_veo.with_suffix(".json")
                if sidecar.exists():
                    sidecar.unlink()
                return True
            except Exception as e:
                logger.error(f"Lỗi khi xóa clip Veo {target_veo}: {e}")
                raise

        return False


def open_export_folder_in_explorer(filename: str) -> bool:
    """Mở thư mục chứa video trên Windows File Explorer và chọn sẵn file."""
    base_name = Path(filename).name
    target = (WORKFLOW_EXPORTS_DIR / base_name).resolve()
    if not (target.exists() and target.is_file()) and VEO_DATA_DIR.exists():
        target_veo = (VEO_DATA_DIR / base_name).resolve()
        if target_veo.exists() and target_veo.is_file():
            target = target_veo

    import subprocess
    import sys

    try:
        if sys.platform == "win32":
            if target.exists():
                subprocess.Popen(["explorer", f"/select,{str(target)}"])
            else:
                dest = WORKFLOW_EXPORTS_DIR if WORKFLOW_EXPORTS_DIR.exists() else VEO_DATA_DIR
                subprocess.Popen(["explorer", str(dest.resolve())])
            return True
        elif sys.platform == "darwin":
            subprocess.Popen(["open", "-R", str(target)])
            return True
        else:
            dest_dir = target.parent if target.exists() else WORKFLOW_EXPORTS_DIR
            subprocess.Popen(["xdg-open", str(dest_dir.resolve())])
            return True
    except Exception as e:
        logger.error(f"Không thể mở thư mục explorer: {e}")
        return False


# ─────────────────────────────────────────────────────────────────────────────
# VieNeu-TTS Voiceover Generation
# ─────────────────────────────────────────────────────────────────────────────

VOICEOVER_DIR = DATA_DIR / "workflow_voiceovers"


async def generate_voiceover_batch(
    voice_id: str,
    scripts: list[str],
    combine_all: bool = True,
) -> WorkflowVoiceoverResponse:
    """Sinh voiceover cho danh sách lời thoại từ VieNeu-TTS (port 8001).

    Nếu combine_all=True, ghép toàn bộ audio thành 1 file liền mạch bằng FFmpeg.
    Trả WorkflowVoiceoverResponse với items[] cho từng phân cảnh và combined audio.
    """
    import zipfile
    import io
    from app.voices import voice_client

    VOICEOVER_DIR.mkdir(parents=True, exist_ok=True)
    job_id = uuid.uuid4().hex[:8]
    job_dir = VOICEOVER_DIR / job_id
    job_dir.mkdir(parents=True, exist_ok=True)

    items_payload = [{"text": text} for text in scripts]

    # Gọi VieNeu-TTS /tts/batch → zip chứa vo_0.wav, vo_1.wav, ..., manifest.json
    zip_bytes = await voice_client.tts_batch(items_payload, voice_id)

    # Giải nén zip
    result_items: list[WorkflowVoiceoverItem] = []
    wav_paths: list[Path] = []

    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
        manifest = {}
        if "manifest.json" in zf.namelist():
            manifest = json.loads(zf.read("manifest.json"))

        manifest_items = manifest.get("items", [])

        for i, text in enumerate(scripts):
            wav_name = f"vo_{i}.wav"
            if wav_name not in zf.namelist():
                logger.warning(f"[VO] Không tìm thấy {wav_name} trong zip TTS batch")
                continue

            wav_data = zf.read(wav_name)
            wav_path = job_dir / wav_name
            wav_path.write_bytes(wav_data)
            wav_paths.append(wav_path)

            # Duration từ manifest hoặc ffprobe
            dur = 0.0
            if i < len(manifest_items):
                dur = float(manifest_items[i].get("duration_sec", 0.0))
            if dur == 0.0:
                try:
                    dur = ffprobe_duration(wav_path)
                except Exception:
                    pass

            result_items.append(WorkflowVoiceoverItem(
                index=i,
                text=text,
                audio_url=f"/api/workflow/voiceovers/{job_id}/{wav_name}",
                file_path=str(wav_path.resolve()),
                duration_sec=dur,
            ))

    total_dur = sum(item.duration_sec for item in result_items)

    combined_url = None
    combined_path = None

    if combine_all and len(wav_paths) > 1:
        combined_file = job_dir / "combined.wav"
        try:
            concat_segments(wav_paths, combined_file, job_dir / "temp_concat")
            combined_url = f"/api/workflow/voiceovers/{job_id}/combined.wav"
            combined_path = str(combined_file.resolve())
            total_dur = ffprobe_duration(combined_file) or total_dur
        except Exception as e:
            logger.warning(f"[VO] Không thể ghép audio: {e}")
    elif len(wav_paths) == 1:
        combined_url = result_items[0].audio_url
        combined_path = result_items[0].file_path

    return WorkflowVoiceoverResponse(
        voice_id=voice_id,
        items=result_items,
        combined_audio_url=combined_url,
        combined_file_path=combined_path,
        total_duration_sec=total_dur,
    )


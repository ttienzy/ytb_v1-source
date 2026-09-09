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

import uuid

from app.ai.gemini.recap import (
    _fresh_tokens,
    _gemini_config,
    _upload_file,
    _auto_refresh_cookies,
    RecapConfigError,
)
from app.core.config import TOOLS_DIR, DATA_DIR
from app.core.storage import read_config
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
)

logger = logging.getLogger("workflow.service")

PROMPT_FILE = TOOLS_DIR / "Backend" / "prompts" / "workflow" / "gemini_product_analysis.txt"


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
    """Parse base64 data URL hoặc đường dẫn file cục bộ thành (bytes, filename, mime_type)."""
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

    # 2. File path cục bộ
    p = Path(img_str)
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


def execute_gemini_analysis(
    prompt: str,
    images: list[str],
    allow_refresh: bool = True,
) -> str:
    """Gọi trực tiếp Google Gemini Web để phân tích hình ảnh và trả về kết quả text Markdown."""
    cfg = _gemini_config()
    cookies, ua, inner_template = cfg["cookies"], cfg["user_agent"], cfg["inner_template"]

    with httpx.Client(http2=False, timeout=120, follow_redirects=True) as client:
        # Lấy fresh tokens
        try:
            at_val, bl_val, fsid_val = _fresh_tokens(client, cookies, ua)
        except Exception as exc:
            if allow_refresh:
                logger.warning(f"[Gemini Workflow] Token hết hạn: {exc}. Đang tự động làm mới qua Chrome profile...")
                _auto_refresh_cookies()
                return execute_gemini_analysis(prompt, images, allow_refresh=False)
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
                logger.warning("[Gemini Workflow] Session hết hạn trong lúc gọi StreamGenerate. Refresh cookie...")
                _auto_refresh_cookies()
                return execute_gemini_analysis(prompt, images, allow_refresh=False)
            raise RuntimeError(f"Gemini Web API error: HTTP {resp.status_code} — {resp.text[:300]}")

        answer = _extract_answer_text(resp.text)
        if not answer:
            raise RuntimeError("Không thể trích xuất nội dung trả lời từ luồng phản hồi của Gemini.")

        return answer


def parse_analysis_to_structured(raw_text: str) -> GeminiAnalysisResponse:
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
        "Hãy phân tích dữ liệu sản phẩm và viết 3 kịch bản video bán hàng ngắn.\n\n"
        "Nguyên tắc ưu tiên:\n"
        "1. Chỉ dùng thông tin có trong đầu vào.\n"
        "2. Chọn tối đa 3 selling point quan trọng nhất.\n"
        "3. Chuyển tính năng thành lợi ích cho khách hàng.\n"
        "4. Mỗi kịch bản dùng một góc tiếp cận khác nhau.\n"
        "5. Không lặp hook, selling point hoặc CTA nếu không cần thiết.\n"
        "6. Không phóng đại, không tạo claim y tế hoặc cam kết kết quả nếu dữ liệu không chứng minh.\n"
        "7. Nếu dữ liệu mâu thuẫn, ưu tiên thông tin cụ thể và đáng tin cậy hơn; bỏ qua thông tin không chắc chắn.\n"
        "8. Nếu thiếu dữ liệu, không tự bịa.\n\n"
        "Góc 1: Problem → Solution\n"
        "Góc 2: Unique Selling Point → Benefit\n"
        "Góc 3: Situation/Experience → Desire\n\n"
        "Mỗi kịch bản gồm:\n"
        "Hook → Vấn đề/nhu cầu → Sản phẩm → Lợi ích chính → CTA\n\n"
        "Độ dài mục tiêu: 80-130 từ/kịch bản.\n"
        "Phong cách: tự nhiên, bán hàng nhưng không quá quảng cáo, phù hợp lời thoại video ngắn.\n\n"
        "Dữ liệu sản phẩm:\n"
        "{{PRODUCT_DATA}}"
    )


def format_product_data_from_structured(
    product_data: str,
    product_analysis: dict[str, Any] | None = None,
    assets: dict[str, Any] | None = None,
    scene_config: dict[str, Any] | None = None,
    script_config: dict[str, Any] | None = None,
) -> str:
    """Định dạng dữ liệu sản phẩm từ Object sang văn bản chi tiết cho ChatGPT."""
    parts: list[str] = []
    if product_data and product_data.strip():
        parts.append(product_data.strip())
    elif product_analysis:
        if product_analysis.get("features"):
            parts.append("Đặc điểm sản phẩm:\n" + "\n".join(f"- {f}" for f in product_analysis["features"]))
        if product_analysis.get("sellingPoints"):
            parts.append("Key Selling Points (USPs):\n" + "\n".join(f"- {usp}" for usp in product_analysis["sellingPoints"]))
        if product_analysis.get("classifications"):
            parts.append("Phân loại chi tiết:")
            for c in product_analysis["classifications"]:
                c_str = f"- Tên: {c.get('name', '')}"
                if c.get("coreBenefits"):
                    c_str += f" | Công dụng: {c['coreBenefits']}"
                if c.get("mainIngredients"):
                    c_str += f" | Thành phần: {c['mainIngredients']}"
                parts.append(c_str)
        if not parts and product_analysis.get("rawText"):
            parts.append(product_analysis["rawText"])

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
            parts.append("Tài nguyên hình ảnh đính kèm: " + ", ".join(asset_notes))

    target_count = None
    if script_config and script_config.get("count"):
        target_count = script_config.get("count")
    elif scene_config and scene_config.get("count"):
        target_count = scene_config.get("count")

    if target_count:
        parts.append(f"Yêu cầu kịch bản: Tạo đúng {target_count} kịch bản độc lập.")

    return "\n\n".join(parts) if parts else "Chưa có văn bản mô tả, hãy quan sát kỹ ảnh sản phẩm đính kèm để trích xuất USP."


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
    target_model = model or cfg.get("default_model", "cx/gpt-5.5")

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

    template = (prompt_template or "").strip() or get_default_gpt_prompt()
    data_str = format_product_data_from_structured(
        product_data,
        product_analysis,
        assets,
        scene_config,
        script_config,
    )

    # Thay thế các biến {{PRODUCT_DATA}}, {{SCRIPT_COUNT}}, {{CONTENT_MODE}}
    filled_prompt = re.sub(r"\{\{\s*PRODUCT_DATA\s*\}\}", data_str, template, flags=re.IGNORECASE)
    filled_prompt = re.sub(r"\{\{\s*SCRIPT_COUNT\s*\}\}", str(target_count), filled_prompt, flags=re.IGNORECASE)
    filled_prompt = re.sub(r"\{\{\s*CONTENT_MODE\s*\}\}", content_mode, filled_prompt, flags=re.IGNORECASE)

    if filled_prompt == template and "{{PRODUCT_DATA}}" not in template:
        filled_prompt = f"{template}\n\n[Dữ liệu sản phẩm]:\n{data_str}"

    # Luôn gắn thêm chỉ thị hệ thống ràng buộc chính xác số lượng kịch bản mong muốn
    system_instruction = (
        f"\n\n[YÊU CẦU HỆ THỐNG BẮT BUỘC]:\n"
        f"- Bắt buộc phải tạo chính xác đúng {target_count} kịch bản độc lập (nếu văn bản prompt phía trên có ghi số lượng khác, hãy ưu tiên tuân thủ đúng {target_count} kịch bản theo yêu cầu hệ thống này).\n"
        f"- Mỗi kịch bản phải có Tiêu đề & Góc tiếp cận (Angle) riêng biệt, Gợi ý hình ảnh (Visual Direction cho video), Lời thoại (Voiceover), và CTA."
    )
    filled_prompt = f"{filled_prompt}{system_instruction}"

    # Lọc ảnh hợp lệ
    valid_images = [img for img in (images or []) if img and img.strip()]

    # Gọi chat_completion
    res = chat_completion(
        endpoint=endpoint,
        api_key=api_key,
        model=target_model,
        prompt=filled_prompt,
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
    json_match = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", raw_text, re.DOTALL)
    candidate_json = json_match.group(1).strip() if json_match else raw_text.strip()

    if candidate_json.startswith("{") and candidate_json.endswith("}"):
        try:
            data = json.loads(candidate_json)
            raw_items = data.get("scripts") or data.get("items") or []
            if isinstance(raw_items, list) and len(raw_items) > 0:
                for idx, item in enumerate(raw_items):
                    if not isinstance(item, dict):
                        continue
                    angle = item.get("angle") or f"Góc {idx + 1}"
                    title = item.get("title") or f"Kịch bản {idx + 1}"
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
                if len(scripts) >= expected_count:
                    return scripts[:expected_count]
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

            # Tách angle thông minh từ header (e.g. "Kịch bản 1: Tiêu đề - Góc: Review chân thực")
            angle_name = f"Kịch bản {idx + 1}"
            if "Góc" in header or "Angle" in header:
                angle_match = re.search(r"(?:Góc|Angle)\s*[:\-]?\s*([^\-\n]+)", header, re.IGNORECASE)
                if angle_match:
                    angle_name = angle_match.group(1).strip()
                else:
                    angle_name = header
            elif " - " in header:
                parts = header.split(" - ")
                angle_name = parts[-1].strip()
            elif idx == 0:
                angle_name = "Problem → Solution"
            elif idx == 1:
                angle_name = "USP → Benefit"
            elif idx == 2:
                angle_name = "Experience → Desire"

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

    return WorkflowAssetUploadResponse(
        id=asset_id,
        kind=kind,
        preview_url=f"/api/workflow/assets/{asset_id}",
        backend_path=str(target_path.resolve()),
        file_name=filename,
        size_bytes=len(file_bytes),
    )


def get_workflow_asset_path(asset_id: str) -> Path | None:
    """Tìm đường dẫn file thật trên disk theo asset_id."""
    WORKFLOW_ASSETS_DIR.mkdir(parents=True, exist_ok=True)
    for f in WORKFLOW_ASSETS_DIR.iterdir():
        if f.stem == asset_id:
            return f
    return None


def concat_workflow_scenes(
    scene_video_paths: list[str],
    bgm_path: str | None = None,
    output_filename: str | None = None,
) -> WorkflowExportResponse:
    """Ghép nối danh sách file video từng phân cảnh bằng FFmpeg concat_segments."""
    WORKFLOW_EXPORTS_DIR.mkdir(parents=True, exist_ok=True)
    job_id = str(uuid.uuid4())[:8]

    valid_paths: list[Path] = []
    for sp in scene_video_paths:
        p: Path | None = None

        # 1. Hỗ trợ phân giải tự động nếu nhận URL preview dạng /api/veo/history/{id}/file
        veo_match = re.search(r"/api/veo/history/([^/]+)/file", sp)
        if veo_match:
            video_id = veo_match.group(1)
            try:
                from app.veo import service as veo_service
                veo_path = veo_service.get_video_path(video_id)
                if veo_path and veo_path.exists() and veo_path.is_file():
                    p = veo_path
            except Exception as e:
                logger.warning(f"Không thể phân giải video_id '{video_id}' từ veo history: {e}")

        # 2. Thử tìm trực tiếp file path trên disk
        if p is None:
            cand = Path(sp)
            if cand.exists() and cand.is_file():
                p = cand
            else:
                alt_p = DATA_DIR / sp
                if alt_p.exists() and alt_p.is_file():
                    p = alt_p
                else:
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

    final_path = concat_segments(valid_paths, out_file, work_dir)
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




from __future__ import annotations

import base64
import copy
import json
import logging
import re
import urllib.parse
from pathlib import Path
from typing import Any

import httpx

from app.ai.gemini.recap import (
    _fresh_tokens,
    _gemini_config,
    _upload_file,
    _auto_refresh_cookies,
    RecapConfigError,
)
from app.core.config import TOOLS_DIR
from app.core.storage import read_config
from app.ai.chatgpt.service import (
    chat_completion,
    ensure_9router_running,
    get_local_cli_secret,
    is_9router_running,
    normalize_endpoint,
)
from app.workflow.schemas import (
    GeminiAnalysisResponse,
    GeminiProductClassification,
    GptScriptItem,
    GptScriptResponse,
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
    cleaned = re.sub(r"\[cite:\s*[\d,\s]+\]", "", raw_text)

    # Tách các gạch đầu dòng làm key selling points
    lines = [line.strip() for line in cleaned.split("\n") if line.strip()]
    usp_bullets: list[str] = []
    classifications: list[GeminiProductClassification] = []

    current_section = "intro"
    curr_class: dict[str, str] = {}

    for line in lines:
        lower = line.lower()
        if any(kw in lower for kw in ["điểm 'ăn tiền'", "yếu tố thu hút", "usp", "điểm nổi bật"]):
            current_section = "usp"
            continue
        elif any(kw in lower for kw in ["phân loại chi tiết", "từng sản phẩm", "danh sách sản phẩm"]):
            current_section = "classification"
            continue

        if current_section == "usp":
            if line.startswith(("-", "*", "•")):
                usp_bullets.append(line.lstrip("-*• ").strip())

        elif current_section == "classification":
            # Phát hiện tên sản phẩm (thường có dạng số 1. hoặc gạch đầu dòng in đậm **...**)
            header_match = re.match(r"(?:\d+[\.\)]|[\*\-•])\s*\*\*([^\*]+)\*\*", line)
            if header_match:
                if curr_class and curr_class.get("name"):
                    classifications.append(GeminiProductClassification(**curr_class))
                    curr_class = {}
                curr_class["name"] = header_match.group(1).strip()
            elif ":" in line:
                key, val = line.split(":", 1)
                key_l = key.lower()
                val_clean = val.strip().strip("*")
                if "thành phần" in key_l:
                    curr_class["main_ingredients"] = val_clean
                elif "công dụng" in key_l:
                    curr_class["core_benefits"] = val_clean
                elif "mùi" in key_l or "trải nghiệm" in key_l:
                    curr_class["experience_scent"] = val_clean
                elif "màu" in key_l or "phiên bản" in key_l:
                    curr_class["color_variant"] = val_clean

    if curr_class and curr_class.get("name"):
        classifications.append(GeminiProductClassification(**curr_class))

    return GeminiAnalysisResponse(
        raw_text=cleaned,
        product_features=cleaned,
        classifications=classifications,
        key_selling_points=usp_bullets if usp_bullets else [l.lstrip("-*• ") for l in lines if l.startswith(("-", "*", "•"))][:6],
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


def execute_gpt_script_generation(
    product_data: str,
    images: list[str] | None = None,
    prompt_template: str | None = None,
    model: str | None = None,
) -> tuple[str, str]:
    """Gọi 9Router / ChatGPT để sinh 3 kịch bản video bán hàng."""
    cfg = read_config().get("chatgpt_9router", {})
    endpoint = cfg.get("endpoint", "http://localhost:20128/v1")
    api_key = cfg.get("api_key", "").strip() or get_local_cli_secret()
    target_model = model or cfg.get("default_model", "cx/gpt-5.5")

    # Đảm bảo 9Router đang chạy nếu dùng endpoint 20128
    if "20128" in endpoint and not is_9router_running(20128):
        logger.info("[Workflow] 9Router chưa chạy, tiến hành khởi động trên port 20128...")
        ensure_9router_running(20128)

    template = (prompt_template or "").strip() or get_default_gpt_prompt()
    data_str = product_data.strip() if product_data else "Chưa có văn bản mô tả, hãy quan sát kỹ ảnh sản phẩm đính kèm để trích xuất USP."
    
    # Thay thế biến {{PRODUCT_DATA}} bất kể khoảng trắng hoặc chữ hoa/thường
    filled_prompt = re.sub(r"\{\{\s*PRODUCT_DATA\s*\}\}", data_str, template, flags=re.IGNORECASE)
    if filled_prompt == template and "{{PRODUCT_DATA}}" not in template:
        filled_prompt = f"{template}\n\n[Dữ liệu sản phẩm]:\n{data_str}"

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


def parse_gpt_scripts(raw_text: str) -> list[GptScriptItem]:
    """Tách 3 kịch bản theo 3 góc tiếp cận từ phản hồi Markdown của GPT."""
    scripts: list[GptScriptItem] = []

    # Định nghĩa 3 góc tiếp cận chuẩn
    angle_defs = [
        {"id": "angle_1", "name": "Góc 1: Problem → Solution"},
        {"id": "angle_2", "name": "Góc 2: Unique Selling Point → Benefit"},
        {"id": "angle_3", "name": "Góc 3: Situation/Experience → Desire"},
    ]

    # Tìm các vị trí xuất hiện của từng Góc
    # Bắt: ## Góc 1..., **Góc 1...**, 1. Góc 1..., Kịch bản 1...
    pattern = r"(?:^|\n)(?:#{1,4}\s*|\*{1,2}|)(?:[0-9]+[\.\)]\s*)?(Góc\s*[123][^\n]*|Kịch\s*bản\s*[123][^\n]*)"
    matches = list(re.finditer(pattern, raw_text, re.IGNORECASE))

    if len(matches) >= 2:
        for idx, m in enumerate(matches):
            header = m.group(1).strip("*# :")
            start_pos = m.end()
            end_pos = matches[idx + 1].start() if idx + 1 < len(matches) else len(raw_text)
            chunk = raw_text[start_pos:end_pos].strip()

            # Bóc tách các thành phần Hook, Vấn đề, Sản phẩm, Lợi ích, CTA
            hook_m = re.search(r"(?:[-*•\d\.\s]*\*{0,2}(?:Hook|Mở đầu)\*{0,2}[:\s\-]+)([^\n]+)", chunk, re.IGNORECASE)
            problem_m = re.search(r"(?:[-*•\d\.\s]*\*{0,2}(?:Vấn đề(?:\/nhu cầu)?|Nhu cầu)\*{0,2}[:\s\-]+)([^\n]+)", chunk, re.IGNORECASE)
            prod_m = re.search(r"(?:[-*•\d\.\s]*\*{0,2}(?:Sản phẩm)\*{0,2}[:\s\-]+)([^\n]+)", chunk, re.IGNORECASE)
            benefit_m = re.search(r"(?:[-*•\d\.\s]*\*{0,2}(?:Lợi ích(?: chính)?)\*{0,2}[:\s\-]+)([^\n]+)", chunk, re.IGNORECASE)
            cta_m = re.search(r"(?:[-*•\d\.\s]*\*{0,2}(?:CTA|Kêu gọi(?: hành động)?)\*{0,2}[:\s\-]+)([^\n]+)", chunk, re.IGNORECASE)

            angle_name = angle_defs[idx]["name"] if idx < len(angle_defs) else f"Kịch bản {idx + 1}"

            scripts.append(
                GptScriptItem(
                    angle=angle_name,
                    title=header,
                    content=chunk,
                    hook=hook_m.group(1).strip() if hook_m else None,
                    problem=problem_m.group(1).strip() if problem_m else None,
                    product=prod_m.group(1).strip() if prod_m else None,
                    benefits=benefit_m.group(1).strip() if benefit_m else None,
                    cta=cta_m.group(1).strip() if cta_m else None,
                    word_count=len(chunk.split()),
                )
            )
    else:
        # Fallback nếu GPT không chia theo format chuẩn: tạo 1 item đầy đủ
        scripts.append(
            GptScriptItem(
                angle="Kịch bản bán hàng tổng hợp",
                title="3 Kịch Bản Video Bán Hàng",
                content=raw_text.strip(),
                word_count=len(raw_text.split()),
            )
        )

    return scripts


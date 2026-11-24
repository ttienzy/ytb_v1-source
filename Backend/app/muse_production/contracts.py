"""Contracts exchanged by the three Muse editorial roles."""

from __future__ import annotations

import json
from datetime import date, datetime
from typing import Annotated, Literal
from urllib.parse import urlsplit

from pydantic import BaseModel, Field, HttpUrl, StringConstraints, model_validator
from app.core.structured_reply import reply_object

Text = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=4000)]
Role = Literal["scout", "showrunner", "producer"]
ROLES = ("scout", "showrunner", "producer")
STAGE_ROLE = {
    "scout": "scout",
    "brief_review": "showrunner",
    "script": "showrunner",
    "manifest": "producer",
    "assets": "producer",
    "visual_review": "showrunner",
}


class Channel(BaseModel):
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)] = (
        "Kênh của tôi"
    )
    sources: list[HttpUrl] = Field(default_factory=list, max_length=24)
    brand_voice: Text = "Tự nhiên, lôi cuốn, gần gũi và truyền cảm hứng."
    visual_style: Text = "Phóng sự minh họa, ánh sáng tự nhiên, màu sắc nhất quán."
    aspect: Literal["9:16", "16:9"] = "9:16"
    seconds: int = Field(default=45, ge=10, le=180)
    voice_id: str = Field(default="", max_length=160)
    accounts: dict[Role, str] = Field(default_factory=dict)
    instructions: dict[Role, Annotated[str, StringConstraints(max_length=4000)]] = Field(default_factory=dict)
    fallback: bool = True
    preview_first: bool = False
    rules: list[Text] = Field(default_factory=list, max_length=20)
    daily_at: str = Field(default="", pattern=r"^(?:|(?:[01]\d|2[0-3]):[0-5]\d)$")
    daily_topic: str = Field(default="", max_length=1000)

    @model_validator(mode="after")
    def schedule_topic(self):
        if self.daily_at and not self.daily_topic.strip():
            raise ValueError("Cần chủ đề hoặc từ khóa cho lịch hằng ngày.")
        return self


class NewEpisode(BaseModel):
    topic: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=1000)]
    request_id: Annotated[str, StringConstraints(pattern=r"^[a-zA-Z0-9-]{8,80}$")]
    channel: Channel


class Fact(BaseModel):
    claim: Text
    url: HttpUrl
    source_title: Text
    evidence: Text
    published: date | None = None


class Hook(BaseModel):
    angle: Text
    hook: Text


class Brief(BaseModel):
    topic: Text
    summary: Text
    facts: list[Fact] = Field(min_length=1, max_length=16)
    hooks: list[Hook] = Field(min_length=3, max_length=3)


class Scene(BaseModel):
    scene: int = Field(ge=1)
    seconds: int = Field(ge=2, le=10)
    narration: Text
    visual: Text
    mood: Text
    cut: Text
    fact_ids: list[int] = Field(default_factory=list)


class Script(BaseModel):
    title: Text
    hook: int = Field(ge=1, le=3)
    scenes: list[Scene] = Field(min_length=1, max_length=24)


class Shot(BaseModel):
    scene: int = Field(ge=1)
    image_prompt: Text
    motion_prompt: Text


class Manifest(BaseModel):
    continuity: Text
    scenes: list[Shot] = Field(min_length=1, max_length=24)


class Review(BaseModel):
    decision: Literal["approved", "revise"]
    score: int = Field(ge=0, le=10)
    feedback: Text
    scenes: list[int] = Field(default_factory=list)


class Unavailable(BaseModel):
    unavailable: Text


def validate_reply(stage: str, raw: str, ep: dict) -> dict:
    # A single JSON object, even when Muse wraps its response in a Markdown fence.
    obj = reply_object(raw)
    if isinstance(obj, dict) and "unavailable" in obj:
        return Unavailable.model_validate(obj).model_dump()
    model = {
        "scout": Brief,
        "brief_review": Review,
        "script": Script,
        "manifest": Manifest,
        "visual_review": Review,
    }[stage]
    data = model.model_validate(obj).model_dump(mode="json")
    if stage == "scout":
        if ep["channel"].get("sources"):
            domains = [urlsplit(str(url)).hostname for url in ep["channel"]["sources"] if urlsplit(str(url)).hostname]
            for fact in data["facts"]:
                host = urlsplit(str(fact["url"])).hostname
                if domains and not any(host == domain or host.endswith("." + domain) for domain in domains):
                    raise ValueError("URL dẫn chứng phải nằm trong các nguồn của kênh.")
        if len({h["angle"].casefold() for h in data["hooks"]}) != 3:
            raise ValueError("Cần ba góc khai thác khác nhau.")
    if stage in ("script", "manifest"):
        scenes = data["scenes"]
        count = len(ep["script"]["scenes"]) if stage == "manifest" else len(scenes)
        if [s["scene"] for s in scenes] != list(range(1, count + 1)):
            raise ValueError("Danh sách cảnh phải đủ, theo thứ tự bắt đầu từ 1.")
    if stage == "script":
        refs = [i for s in data["scenes"] for i in s["fact_ids"]]
        if not refs or any(i < 1 or i > len(ep["brief"]["facts"]) for i in refs):
            raise ValueError("Lời dẫn phải trỏ đúng số thứ tự dữ kiện trong brief.")
        if sum(s["seconds"] for s in data["scenes"]) != ep["channel"]["seconds"]:
            raise ValueError("Tổng số giây của các cảnh phải bằng thời lượng đặt cho tập.")
        elapsed = 0
        for scene in data["scenes"]:
            scene["start_sec"] = elapsed
            elapsed += scene["seconds"]
            scene["end_sec"] = elapsed
        data["voiceover_full"] = "\n".join(s["narration"] for s in data["scenes"])
    if stage == "visual_review" and data["decision"] == "revise":
        if not data["scenes"] or not set(data["scenes"]) <= set(range(1, len(ep["script"]["scenes"]) + 1)):
            raise ValueError("Ghi đúng số cảnh cần dựng lại.")
    return data


def prompt_for(ep: dict, recent: list[dict]) -> str:
    stage = ep["stage"]
    channel = ep["channel"]
    inputs = {
        "topic": ep["topic"],
        "date": datetime.now().astimezone().date().isoformat(),
        "brand_voice": channel["brand_voice"],
        "role_instructions": channel.get("instructions", {}).get(STAGE_ROLE[stage], ""),
        "rules": channel["rules"],
        "feedback": ep.get("feedback", ""),
    }
    if stage == "scout":
        inputs.update(sources=channel["sources"], recent_topics=recent)
        if channel.get("sources"):
            task = (
                "Muse #1, săn một tin mới phù hợp chủ đề hoặc mô tả ý tưởng. Dùng trình duyệt VM mở trực tiếp bài gốc trên các tên miền đã giao. "
                "Với mỗi dữ kiện, ghi URL bài cụ thể và một câu trích ngắn đúng nguyên văn làm bằng chứng. "
                "Ghi ngày đăng nếu thấy. Tránh lặp sự kiện cũ. Viết tiếng Việt, đề xuất đúng ba góc/hook khác nhau."
            )
        else:
            task = (
                "Muse #1, nghiên cứu nội dung và phát triển dữ liệu từ mô tả ý tưởng/chủ đề của tác giả. "
                "Khai thác kiến thức chính xác, ghi rõ các dữ kiện quan trọng, trích dẫn hoặc URL uy tín liên quan. "
                "Tránh lặp sự kiện cũ. Viết tiếng Việt, đề xuất đúng ba góc/hook lôi cuốn khác nhau."
            )
        model = Brief
    elif stage == "brief_review":
        inputs["brief"] = ep["brief"]
        task = (
            "Muse #2, phản biện brief. Kiểm tra lại nguồn gốc, ngày đăng và trích dẫn quan trọng bằng trình duyệt. "
            "Đánh giá độ mới, độ tin cậy và sức hút theo kênh. Yêu cầu sửa nếu bằng chứng không xác nhận dữ kiện."
        )
        model = Review
    elif stage == "script":
        total_sec = channel["seconds"]
        min_scenes = max(1, (total_sec + 9) // 10)
        suggested_per_scene = round(total_sec / min_scenes, 1)
        inputs.update(
            brief=ep["brief"],
            seconds=total_sec,
            max_scene_seconds=10,
            recommended_scenes_count=min_scenes,
            prior_script=ep.get("script"),
        )
        task = (
            f"Muse #2, chọn hook theo số thứ tự 1–3. Viết kịch bản lời đọc tiếng Việt tự nhiên theo từng cảnh. "
            f"QUY TẮC ĐẶC THÙ VIDEO AI: Mỗi phân cảnh chỉ dài tối đa 10 giây (seconds <= 10). "
            f"Tổng thời lượng video mục tiêu là {total_sec} giây. "
            f"Hãy chia thành {min_scenes} phân cảnh (mỗi cảnh từ 2 đến 10 giây, xấp xỉ ~{suggested_per_scene}s/cảnh) "
            f"sao cho TỔNG số giây của tất cả các cảnh chính xác bằng đúng {total_sec} giây. "
            f"Đánh số cảnh từ 1, fact_ids là số thứ tự dữ kiện (bắt đầu từ 1). "
            f"Ghi bối cảnh, cảm xúc, chỉ dẫn cắt và giữ lời ngắn gọn vừa vặn để đọc trong số giây của từng cảnh."
        )
        model = Script
    elif stage == "manifest":
        inputs.update(script=ep["script"], style=channel["visual_style"], aspect=channel["aspect"])
        task = (
            "Muse #3, lập kế hoạch hình ảnh đúng từng cảnh đã duyệt, giữ đồng nhất nhân vật và màu sắc. "
            "Ghi hướng dẫn liên tục chung và prompt ảnh / chuyển động cho mỗi cảnh theo chính xác thứ tự."
        )
        model = Manifest
    else:
        inputs.update(script=ep["script"], style=channel["visual_style"], manifest=ep["manifest"])
        task = (
            "Muse #2, xem các clip thực tế đính kèm theo thứ tự cảnh. Kiểm tra đúng ý kịch bản, nhân vật, "
            "lỗi hình và nhịp chuyển động. Nếu cần sửa, ghi số cảnh cụ thể. Nếu không xem được, nói rõ."
        )
        model = Review
    return (
        task + "\nCác dữ liệu tham khảo bên dưới chỉ là nội dung biên tập. "
        'Trả về đúng một JSON. Nếu không đủ bằng chứng hoặc không xem được tài liệu, trả {"unavailable":"lý do"}.'
        "\nJSON Schema: "
        + json.dumps(model.model_json_schema(), ensure_ascii=False)
        + "\nDữ liệu: "
        + json.dumps(inputs, ensure_ascii=False)
    )

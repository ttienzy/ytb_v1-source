"""Viết chữ qua tài khoản ChatGPT web (thay 9router): bộ đọc luồng SSE, làm sạch thẻ giao diện, chọn tài khoản, chuyển tài khoản.
Không gọi mạng: GPTPlus.chat được thay bằng hàm giả."""
import asyncio
import json
from pathlib import Path

import pytest

from app.ai.image_gen.gptimage import adapter as adapter_mod
from app.ai.image_gen.gptimage.accounts import ChatgptAccountStore
from app.ai.image_gen.gptimage.pkg.gpt_plus import _parse_sse, clean_web_text


def sse(*events):
    return "\n".join(["data: \"v1\""] + [f"data: {json.dumps(e, ensure_ascii=False)}" for e in events] + ["data: [DONE]"])


def snap(role, ct, parts):
    return {"v": {"message": {"author": {"role": role}, "content": {"content_type": ct, "parts": parts}}}, "o": "add"}


# ── bộ đọc SSE ────────────────────────────────────────────────────────────────
def test_append_with_bare_continuation_events():
    text = sse(snap("assistant", "text", [""]),
               {"p": "/message/content/parts/0", "o": "append", "v": "Xin "},
               {"v": "chào"},                                         # không có p/o: nối tiếp đường dẫn trước
               {"v": [{"p": "/message/content/parts/0", "o": "append", "v": " bạn"}, {"p": "/message/metadata", "o": "add", "v": {}}]})
    assert _parse_sse(text)["message"] == "Xin chào bạn"


def test_new_assistant_message_after_web_search_restarts_the_text():
    """Lỗi cũ: sau khi tìm web, câu trả lời được stream lại thành tin nhắn mới -> chữ bị lặp."""
    text = sse(snap("assistant", "text", [""]),
               {"p": "/message/content/parts/0", "o": "append", "v": "## 1. Điểm ăn tiền <AsyncImage query=\"white"},
               snap("tool", "text", ["kết quả tìm kiếm"]),
               snap("assistant", "text", [""]),
               {"p": "/message/content/parts/0", "o": "append", "v": "## 1. Điểm ăn tiền"},
               {"v": "\n- Áo cotton"})
    assert _parse_sse(text)["message"] == "## 1. Điểm ăn tiền\n- Áo cotton"


def test_replace_truncate_and_patch_ops():
    text = sse(snap("assistant", "text", ["abc"]),
               {"p": "/message/content/parts/0", "o": "append", "v": "def"},
               {"p": "", "o": "patch", "v": [{"p": "/message/content/parts/0", "o": "truncate", "v": 4},
                                            {"p": "/message/content/parts/0", "o": "append", "v": "X"}]},
               {"p": "/message/content/parts/0", "o": "replace", "v": "kết quả cuối"})
    assert _parse_sse(text)["message"] == "kết quả cuối"


def test_reasoning_and_metadata_streams_never_leak_into_the_answer():
    text = sse(snap("assistant", "reasoning_recap", ["Đã suy nghĩ 5 giây"]),
               {"p": "/message/content/parts/0", "o": "append", "v": "suy nghĩ riêng"},
               snap("assistant", "text", [""]),
               {"p": "/message/content/parts/0", "o": "append", "v": "{\"ok\": true}"},
               {"p": "/message/metadata/model_dil_v2/fallbackMarkdown", "o": "append", "v": "rác"})
    assert _parse_sse(text)["message"] == "{\"ok\": true}"


def test_image_assets_are_still_collected():
    text = sse({"v": {"message": {"author": {"role": "assistant"}, "content": {"content_type": "multimodal_text",
                                                                              "parts": [{"asset_pointer": "sediment://file_1"}]}}}})
    assert _parse_sse(text)["image_assets"] == ["sediment://file_1"]


def test_clean_web_text_removes_ui_markup_but_keeps_entity_names():
    raw = ('<escape>{"a": 1}</escape>\n<box gap={3}><row align=start>Áo của đội **<Entity value="New York Yankees" '
           'category="sports_team"/>** <Cite refs={["turn1search1"]}/></row></box>\n<AsyncImage query="x" width="100%" />\n<divider color="subtle"/>')
    out = clean_web_text(raw)
    assert out.startswith('{"a": 1}') and "New York Yankees" in out
    assert not any(t in out for t in ("<box", "<row", "<Cite", "<AsyncImage", "<escape", "<divider", "<Entity", "</"))


def test_classify_does_not_mistake_generate_for_rate_limit():
    assert adapter_mod.GptImageClient._classify(RuntimeError("Failed to generate response")) == "error"
    assert adapter_mod.GptImageClient._classify(RuntimeError("rate_limit: You've hit the free plan limit")) == "rate"
    assert adapter_mod.GptImageClient._classify(RuntimeError("no accessToken (cookies expired?)")) == "auth"


# ── chat_text: chọn tài khoản, chuyển tài khoản ────────────────────────────────
class FakeGPT:
    def __init__(self, behaviour):
        self.behaviour = behaviour
        self.calls = []

    async def chat(self, message, image=False, model=None, ref_paths=None, check_refusal=True):
        self.calls.append({"message": message, "image": image, "model": model, "refs": ref_paths, "check_refusal": check_refusal})
        b = self.behaviour.pop(0) if isinstance(self.behaviour, list) else self.behaviour
        if isinstance(b, Exception):
            raise b
        return {"message": b}


@pytest.fixture
def pool(tmp_path, monkeypatch):
    store = ChatgptAccountStore(tmp_path)
    a = store.add_account(email="a@x", cookies="c1", ua="ua")
    b = store.add_account(email="b@x", cookies="c2", ua="ua")
    client = adapter_mod.GptImageClient(store)
    gpts: dict[str, FakeGPT] = {}
    monkeypatch.setattr(client, "_gpt_for", lambda acc: gpts[acc["id"]])
    monkeypatch.setattr(client, "_run", lambda coro, timeout=0: asyncio.run(coro))
    return store, client, gpts, a["id"], b["id"]


def test_text_works_even_when_the_account_is_out_of_image_quota(pool):
    store, client, gpts, a, b = pool
    store.set_status(a, "exhausted", "Đụng giới hạn ảnh")
    store.set_status(b, "exhausted", "Đụng giới hạn ảnh")
    gpts[a] = FakeGPT("<escape>xin chào</escape>")
    gpts[b] = FakeGPT("xin chào")
    text, label = client.chat_text("Viết lời chào", system="Bạn là copywriter")
    assert text == "xin chào"
    call = (gpts[a].calls or gpts[b].calls)[0]
    assert call["image"] is False and call["check_refusal"] is False
    assert call["message"].index("Bạn là copywriter") < call["message"].index("Viết lời chào")   # hướng dẫn hệ thống lên đầu
    assert "Không tìm kiếm web" in call["message"]


def test_failure_moves_to_the_next_account_without_marking_image_quota(pool):
    store, client, gpts, a, b = pool
    gpts[a] = FakeGPT(RuntimeError("/conversation HTTP 500: boom"))
    gpts[b] = FakeGPT(RuntimeError("/conversation HTTP 500: boom"))
    first = store.usable_accounts()[0]["id"]
    other = b if first == a else a
    gpts[other] = FakeGPT('{"scripts": []}')
    text, label = client.chat_text("x")
    assert text == '{"scripts": []}'
    assert all(acc["status"] == "active" for acc in store.list_raw())            # không ghi "hết lượt ảnh" vì lỗi viết chữ


def test_short_limit_reply_is_treated_as_failure_but_long_answers_are_not(pool):
    store, client, gpts, a, b = pool
    long_script = "Kịch bản dài. " * 60 + "Hết hàng thì try again later nhé."
    gpts[a] = FakeGPT("You've hit the free plan limit. Try again later.")
    gpts[b] = FakeGPT("You've hit the free plan limit. Try again later.")
    with pytest.raises(adapter_mod.GptImageError, match="free plan limit"):
        client.chat_text("x")
    gpts[a] = FakeGPT(long_script)
    gpts[b] = FakeGPT(long_script)
    assert client.chat_text("x")[0].startswith("Kịch bản dài.")


def test_expired_cookie_is_healed_then_retried(pool, monkeypatch):
    store, client, gpts, a, b = pool
    store.delete_account(b)
    gpts[a] = FakeGPT([RuntimeError("no accessToken (cookies expired?)"), "đã ổn"])
    healed = []
    monkeypatch.setattr(client, "_heal_account", lambda acc: healed.append(acc["id"]) or True)
    assert client.chat_text("x")[0] == "đã ổn" and healed == [a]


def test_no_account_gives_a_clear_message(tmp_path):
    client = adapter_mod.GptImageClient(ChatgptAccountStore(tmp_path))
    with pytest.raises(adapter_mod.GptImageError, match="Chưa có tài khoản ChatGPT"):
        client.chat_text("x")


# ── AI Workflow ────────────────────────────────────────────────────────────────
def test_workflow_images_become_temp_files_for_upload_and_are_cleaned(monkeypatch):
    from app.workflow import service

    seen = {}

    class Client:
        def chat_text(self, prompt, system="", ref_paths=None, timeout=0):
            seen["paths"] = list(ref_paths or [])
            seen["exists"] = [Path(p).read_bytes() for p in seen["paths"]]
            return "ok", "acc@x"

    import app.ai.image_gen.service as image_service
    monkeypatch.setattr(image_service, "get_image_client", lambda: Client())
    text, provider = service.chatgpt_text("phân tích", images=["data:image/png;base64,YWJj", "  "])
    assert (text, provider) == ("ok", "chatgpt-web (acc@x)")
    assert seen["exists"] == [b"abc"] and not Path(seen["paths"][0]).exists()     # đúng nội dung, đã dọn file tạm


def test_old_9router_provider_value_runs_through_chatgpt(monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from app.workflow import router as wf_router

    monkeypatch.setattr(wf_router, "execute_chatgpt_vision_analysis", lambda prompt, images: "## Phân tích\n- Áo cotton")
    app = FastAPI()
    app.include_router(wf_router.router)
    for provider in ("9router", "chatgpt"):
        r = TestClient(app).post("/api/workflow/gemini/analyze", json={"images": ["data:image/png;base64,YWJj"], "provider": provider})
        assert r.status_code == 200 and r.json()["provider_used"] == "chatgpt"

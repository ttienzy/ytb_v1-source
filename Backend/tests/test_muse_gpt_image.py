"""Muse Canvas: node gạt sang GPT tạo ảnh bằng kho tài khoản ChatGPT (không gọi ChatGPT thật)."""
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.workflow import image_library, muse_gpt_image
from app.workflow.router import router


class FakeClient:
    def __init__(self, fail: Exception | None = None):
        self.calls: list[dict] = []
        self.fail = fail

    def generate(self, prompt, dest, ref_paths=None, timeout=300, aspect="9:16"):
        self.calls.append({"prompt": prompt, "dest": dest, "refs": ref_paths, "aspect": aspect})
        if self.fail:
            raise self.fail
        Path(dest).write_bytes(b"\x89PNG fake")
        return dest


@pytest.fixture()
def env(tmp_path, monkeypatch):
    out = tmp_path / "muse_outputs"
    monkeypatch.setattr(muse_gpt_image, "_output_dir", lambda: out)
    monkeypatch.setattr(image_library, "INDEX_FILE", tmp_path / "image_library.json")
    monkeypatch.setattr(image_library, "MUSE_OUTPUT_DIR", out)
    fake = FakeClient()
    monkeypatch.setattr(muse_gpt_image, "_image_client", lambda: fake)
    char = tmp_path / "linh.png"
    outfit = tmp_path / "ao.png"
    char.write_bytes(b"c")
    outfit.write_bytes(b"o")
    app = FastAPI()
    app.include_router(router)
    return {"client": TestClient(app), "fake": fake, "out": out, "refs": [str(char), str(outfit)], "monkeypatch": monkeypatch}


def test_gpt_image_saves_next_to_muse_outputs_and_library(env):
    res = env["client"].post("/api/workflow/muse/gpt-image", json={
        "prompt": "BOARD\n\nOUTFIT", "reference_images": env["refs"],
        "chat_title": "Muse Canvas · Bảng nhân vật · Linh × Áo dài", "file_prefix": "muse_canvas_character", "aspect": "16:9",
    })
    assert res.status_code == 200, res.text
    body = res.json()
    saved = Path(body["local_path"])
    assert saved.parent == env["out"] and saved.name.startswith("muse_canvas_character_gpt_")
    assert body["preview_url"] == f"/api/ai/muse/output?file={saved.name}"
    call = env["fake"].calls[0]
    assert call["refs"] == env["refs"] and call["aspect"] == "16:9" and call["prompt"] == "BOARD\n\nOUTFIT"
    items = image_library.list_images(source="chatgpt")
    assert len(items) == 1 and items[0]["label"] == "Bảng nhân vật · Linh × Áo dài"


def test_missing_reference_is_rejected_before_calling_chatgpt(env):
    res = env["client"].post("/api/workflow/muse/gpt-image", json={"prompt": "p", "reference_images": ["D:/khong/co.png"]})
    assert res.status_code == 400
    assert env["fake"].calls == []


def test_chatgpt_error_is_reported(env):
    from app.ai.image_gen.gptimage.adapter import GptImageError

    failing = FakeClient(fail=GptImageError("Chưa có tài khoản ChatGPT nào."))
    env["monkeypatch"].setattr(muse_gpt_image, "_image_client", lambda: failing)
    res = env["client"].post("/api/workflow/muse/gpt-image", json={"prompt": "p", "reference_images": env["refs"]})
    assert res.status_code == 502
    assert "ChatGPT" in res.json()["detail"]


def test_gpt_default_prompt_for_character_sheet_is_bundled(tmp_path, monkeypatch):
    from app.workflow import muse_canvas

    monkeypatch.setattr(muse_canvas, "PROMPT_OVERRIDE_DIR", tmp_path / "muse_prompts")
    p = muse_canvas.get_prompt("character_sheet_gpt")
    assert p["is_custom"] is False
    assert p["prompt"].startswith("REFERENCE ROLES:")
    assert "Image 2 = outfit reference" in p["prompt"] and "@" not in p["prompt"]
    saved = muse_canvas.save_prompt("character_sheet_gpt", "MY GPT PROMPT")
    assert saved == {"name": "character_sheet_gpt", "prompt": "MY GPT PROMPT", "is_custom": True}
    assert muse_canvas.get_prompt("character_sheet")["prompt"] != "MY GPT PROMPT"  # prompt Muse không bị đổi


class FakeTextClient:
    def __init__(self, text="=== SCRIPT 1/1 — REF #1 — Áo — 8s ===", fail=None):
        self.calls = []
        self.text = text
        self.fail = fail

    def chat_text(self, prompt, system="", ref_paths=None, model="auto", timeout=300.0, failover=True):
        self.calls.append({"prompt": prompt, "refs": ref_paths, "timeout": timeout, "failover": failover})
        if self.fail:
            raise self.fail
        return self.text, "acc@x"


def test_gpt_script_writes_md_and_never_fails_over(env, tmp_path):
    fake = FakeTextClient()
    env["monkeypatch"].setattr(muse_gpt_image, "_image_client", lambda: fake)
    env["monkeypatch"].setattr(muse_gpt_image, "_text_dir", lambda: tmp_path / "muse_texts")
    res = env["client"].post("/api/workflow/muse/gpt-script", json={
        "prompt": "PROMPT\n\n## Reference images", "reference_images": env["refs"],
        "chat_title": "Muse Canvas · Kịch bản clip · 2 ảnh", "file_prefix": "muse_canvas_clipscript",
    })
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["text"].startswith("=== SCRIPT 1/1") and body["account_label"] == "acc@x"
    md = Path(body["local_path"])
    assert md.parent == tmp_path / "muse_texts" and md.name.startswith("muse_canvas_clipscript_")
    assert "=== SCRIPT 1/1" in md.read_text(encoding="utf-8")
    call = fake.calls[0]
    assert call["refs"] == env["refs"] and call["failover"] is False and call["timeout"] == 600


def test_gpt_script_missing_image_and_chatgpt_error(env, tmp_path):
    from app.ai.image_gen.gptimage.adapter import GptImageError

    fake = FakeTextClient(fail=GptImageError("ChatGPT lỗi (acc: timeout). Không tự gửi lại sang tài khoản khác."))
    env["monkeypatch"].setattr(muse_gpt_image, "_image_client", lambda: fake)
    env["monkeypatch"].setattr(muse_gpt_image, "_text_dir", lambda: tmp_path / "muse_texts")
    res = env["client"].post("/api/workflow/muse/gpt-script", json={"prompt": "p", "reference_images": ["D:/khong/co.png"]})
    assert res.status_code == 400 and fake.calls == []
    res = env["client"].post("/api/workflow/muse/gpt-script", json={"prompt": "p", "reference_images": env["refs"]})
    assert res.status_code == 502 and "Không tự gửi lại" in res.json()["detail"]


def test_clip_script_prompt_bundled_and_long_prompts_can_be_saved(tmp_path, monkeypatch):
    from app.workflow import muse_canvas

    monkeypatch.setattr(muse_canvas, "PROMPT_OVERRIDE_DIR", tmp_path / "muse_prompts")
    p = muse_canvas.get_prompt("clip_script")
    assert p["prompt"].startswith("You are a short-form fashion video director")
    # giữ đúng các dòng node dùng để tách bài, và luật prompt video vừa giới hạn 2000 ký tự của Flow
    for marker in ("=== SCRIPT k/N — REF #k — <short outfit name> — <D>s ===", "=== END SCRIPT k ===",
                   "**VIDEO PROMPT:**", "at most 1,900 characters"):
        assert marker in p["prompt"]
    assert len(p["prompt"]) < 6000
    long_prompt = p["prompt"] + "\n" + "x" * 9000  # bản người dùng tự viết dài vẫn lưu được (giới hạn 20000)
    assert muse_canvas.save_prompt("clip_script", long_prompt)["is_custom"] is True


def test_chat_text_without_failover_stops_after_first_account(monkeypatch):
    from app.ai.image_gen.gptimage import adapter

    class Store:
        def __init__(self):
            self.accs = [{"id": "a", "cookies": "c", "ua": "u", "status": "active"}, {"id": "b", "cookies": "c", "ua": "u", "status": "active"}]

        def list_raw(self):
            return self.accs

        def touch(self, *_):
            pass

        def set_status(self, *_a, **_k):
            pass

        def get_account(self, i):
            return next(a for a in self.accs if a["id"] == i)

    client = adapter.GptImageClient(Store())
    sent = []

    class Gpt:
        async def chat(self, message, **kw):
            sent.append(message)
            raise RuntimeError("network reset")

    monkeypatch.setattr(client, "_gpt_for", lambda acc: Gpt())
    with pytest.raises(adapter.GptImageError, match="Không tự gửi lại"):
        client.chat_text("hello", failover=False, timeout=5)
    assert len(sent) == 1  # chỉ gửi 1 lần, không sang tài khoản b
    sent.clear()
    with pytest.raises(adapter.GptImageError):
        client.chat_text("hello", timeout=5)  # mặc định vẫn chuyển tài khoản như cũ
    assert len(sent) == 2


# ── Thanh chat ChatGPT trực tiếp trong Muse Canvas ──────────────────────────────
class FakeCanvasChatClient:
    def __init__(self, reply="Đây là kịch bản mẫu", fail=None, pool=None):
        self.calls = []
        self.reply = reply
        self.fail = fail
        self.pool = pool or {"total": 2, "free": 2, "busy": 0, "cooldown": 0, "retry_after_seconds": 0, "accounts": []}

    def text_pool_status(self):
        return self.pool

    def chat_text(self, prompt, system="", ref_paths=None, model="auto", timeout=300.0, failover=True,
                  *, wait_timeout=None, respect_cooldown=False):
        self.calls.append({
            "prompt": prompt, "system": system, "refs": ref_paths,
            "failover": failover, "wait_timeout": wait_timeout, "respect_cooldown": respect_cooldown,
        })
        if self.fail:
            raise self.fail
        return self.reply, "b@x"


def test_build_chat_prompt_sliding_window_and_char_limit():
    turns = [
        muse_gpt_image.GptChatTurn(role="user", content="Lượt 1 " + "a" * 30),
        muse_gpt_image.GptChatTurn(role="assistant", content="Đáp 1 " + "b" * 30),
        muse_gpt_image.GptChatTurn(role="user", content="Lượt 2"),
        muse_gpt_image.GptChatTurn(role="assistant", content="Đáp 2"),
    ]
    assert muse_gpt_image.build_chat_prompt("  Xin chào  ", []) == "Xin chào"
    out = muse_gpt_image.build_chat_prompt("Sửa hook", turns, max_turns=2, max_chars=200)
    assert "Lượt 1" not in out
    assert "Lượt 2" in out and "Đáp 2" in out and "[YÊU CẦU HIỆN TẠI]\nSửa hook" in out

    tight = muse_gpt_image.build_chat_prompt("Ngắn", turns, max_turns=10, max_chars=60)
    assert "Lượt 1" not in tight and "Đáp 2" in tight


def test_muse_gpt_chat_status_and_turns(env):
    from app.ai.image_gen.gptimage.adapter import GptTextPoolError

    fake = FakeCanvasChatClient()
    env["monkeypatch"].setattr(muse_gpt_image, "_image_client", lambda: fake)

    st = env["client"].get("/api/workflow/muse/gpt-chat/status")
    assert st.status_code == 200 and st.json()["free"] == 2

    res = env["client"].post("/api/workflow/muse/gpt-chat", json={
        "message": "Viết hook 3 giây",
        "history": [{"role": "user", "content": "Chủ đề váy lụa"}, {"role": "assistant", "content": "Đã rõ"}],
        "reference_images": [env["refs"][0]],
    })
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["reply"] == "Đây là kịch bản mẫu" and body["account_label"] == "b@x"
    assert body["pool"]["total"] == 2
    call = fake.calls[0]
    assert call["failover"] is True and call["respect_cooldown"] is True and call["wait_timeout"] > 0
    assert "Chủ đề váy lụa" in call["prompt"] and "[YÊU CẦU HIỆN TẠI]\nViết hook 3 giây" in call["prompt"]
    assert call["refs"] == [env["refs"][0]]

    # Ảnh thiếu -> 400 ngay trước khi chạm pool
    bad = env["client"].post("/api/workflow/muse/gpt-chat", json={"message": "hi", "reference_images": ["D:/missing.png"]})
    assert bad.status_code == 400 and bad.json()["detail"]["code"] == "missing_reference"

    # Toàn bộ bận -> 429 kèm code + pool
    busy_pool = {"total": 1, "free": 0, "busy": 1, "cooldown": 0, "retry_after_seconds": 0, "accounts": []}
    busy_fake = FakeCanvasChatClient(fail=GptTextPoolError("Đang bận 1/1", code="all_busy", pool=busy_pool))
    env["monkeypatch"].setattr(muse_gpt_image, "_image_client", lambda: busy_fake)
    r429 = env["client"].post("/api/workflow/muse/gpt-chat", json={"message": "hi"})
    assert r429.status_code == 429 and r429.json()["detail"]["code"] == "all_busy"
    assert r429.json()["detail"]["pool"]["busy"] == 1

    # Chưa có acc -> 503
    no_fake = FakeCanvasChatClient(fail=GptTextPoolError("Chưa có acc", code="no_accounts", pool={"total": 0, "free": 0, "busy": 0, "cooldown": 0, "retry_after_seconds": 0, "accounts": []}))
    env["monkeypatch"].setattr(muse_gpt_image, "_image_client", lambda: no_fake)
    r503 = env["client"].post("/api/workflow/muse/gpt-chat", json={"message": "hi"})
    assert r503.status_code == 503 and r503.json()["detail"]["code"] == "no_accounts"

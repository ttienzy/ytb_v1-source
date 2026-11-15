"""Thư viện ảnh Canvas AI: chỉ mục, tự quét ảnh Muse, tải lên, sửa, xóa an toàn."""
from __future__ import annotations

import io

import pytest
from PIL import Image

from app.workflow import image_library as lib


def _png(w=8, h=6) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (w, h), "white").save(buf, "PNG")
    return buf.getvalue()


@pytest.fixture(autouse=True)
def isolated(monkeypatch, tmp_path):
    monkeypatch.setattr(lib, "INDEX_FILE", tmp_path / "image_library.json")
    monkeypatch.setattr(lib, "UPLOAD_DIR", tmp_path / "media" / "image_library")
    monkeypatch.setattr(lib, "MUSE_OUTPUT_DIR", tmp_path / "media" / "muse_outputs")
    return tmp_path


def test_existing_muse_outputs_are_picked_up(isolated):
    out = lib.MUSE_OUTPUT_DIR
    out.mkdir(parents=True)
    (out / "a.webp").write_bytes(_png())
    (out / "notes.txt").write_text("x")
    items = lib.list_images()
    assert [i["file_name"] for i in items] == ["a.webp"]
    assert items[0]["source"] == "muse" and items[0]["width"] == 8 and items[0]["preview_url"].endswith("/file")
    assert len(lib.list_images()) == 1  # không thêm trùng


def test_add_file_with_meta_then_search_and_filter(isolated):
    lib.MUSE_OUTPUT_DIR.mkdir(parents=True)
    f = lib.MUSE_OUTPUT_DIR / "out.png"
    f.write_bytes(_png())
    it = lib.add_file(f, "muse", "Áo dài đỏ", {"prompt": "Extract ONLY the outfit", "chat_title": "Muse Canvas · Tách áo quần · Áo dài đỏ"})
    again = lib.add_file(f, "muse", "", {"session_id": "s1"})
    assert again["id"] == it["id"] and again["meta"]["session_id"] == "s1" and again["meta"]["prompt"]
    up = lib.save_upload("my photo.jpg", _png(), "")
    assert up["source"] == "upload" and up["label"] == "my photo"
    assert [i["id"] for i in lib.list_images(q="áo dài")] == [it["id"]]
    assert [i["id"] for i in lib.list_images(q="extract only")] == [it["id"]]
    assert [i["id"] for i in lib.list_images(source="upload")] == [up["id"]]
    lib.update_image(up["id"], favorite=True, label=" Ảnh của tôi ", tags=["a", "a", " b "])
    fav = lib.list_images(favorite=True)
    assert [i["label"] for i in fav] == ["Ảnh của tôi"] and fav[0]["tags"] == ["a", "b"]


def test_upload_validation(isolated):
    with pytest.raises(ValueError):
        lib.save_upload("x.mp4", b"123")
    with pytest.raises(ValueError):
        lib.save_upload("x.png", b"")
    with pytest.raises(ValueError):
        lib.update_image(lib.save_upload("y.png", _png())["id"], label="  ")
    with pytest.raises(KeyError):
        lib.update_image("nope", favorite=True)


def test_delete_only_removes_files_inside_managed_dirs(isolated, tmp_path):
    inside = lib.save_upload("in.png", _png())
    outside_file = tmp_path / "elsewhere.png"
    outside_file.write_bytes(_png())
    outside = lib.add_file(outside_file, "upload", "ngoài")
    assert lib.delete_image(inside["id"]) and not (lib.UPLOAD_DIR / inside["file_name"]).exists()
    assert lib.delete_image(outside["id"]) and outside_file.exists()
    assert lib.list_images() == [] and lib.delete_image("nope") is False


def test_missing_files_drop_out_of_index(isolated):
    it = lib.save_upload("gone.png", _png())
    (lib.UPLOAD_DIR / it["file_name"]).unlink()
    assert lib.list_images() == []


def test_routes(isolated):
    from fastapi.testclient import TestClient
    from app.main import app

    c = TestClient(app)
    r = c.post("/api/workflow/images/upload", files={"file": ("ao.png", _png(), "image/png")}, data={"label": "Áo"})
    assert r.status_code == 200
    iid = r.json()["id"]
    assert c.get("/api/workflow/images").json()["total"] == 1
    assert c.get(f"/api/workflow/images/{iid}/file").headers["content-type"] == "image/png"
    assert c.patch(f"/api/workflow/images/{iid}", json={"favorite": True}).json()["favorite"] is True
    assert c.post("/api/workflow/images/upload", files={"file": ("a.txt", b"x", "text/plain")}).status_code == 400
    assert c.delete(f"/api/workflow/images/{iid}").json() == {"ok": True}
    assert c.get(f"/api/workflow/images/{iid}/file").status_code == 404

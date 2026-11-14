"""Bản tải phụ của video đã ghép: xóa watermark / không nhạc nền. Executor giả, không gọi gwr/ffmpeg thật."""
import pytest

from app.campaign import exports
from app.campaign.executors import assemble
from app.campaign.runner import ArtifactSpec, ExecResult

from .conftest import reach_clips, run_and_wait


@pytest.fixture
def done(env):
    """Chiến dịch đã có video ghép (có nhạc nền) đang chọn và còn mới."""
    svc, _, executors = env
    svc.runner.executors["assemble"] = lambda ctx: ExecResult([ArtifactSpec("video", ext="mp4", data=b"FINAL", meta={"bgm": ["Nhạc thử"]})])
    from .conftest import prime
    cid = prime(svc)
    reach_clips(svc, cid)
    from .conftest import elements_of
    for k in elements_of(svc, cid, "clip"):
        svc.decide_gate(cid, "clip", "approved", element_key=k)
    run_and_wait(svc, cid, "script")
    run_and_wait(svc, cid, "voice")
    run_and_wait(svc, cid, "assemble")
    return svc, cid, executors


def fake_executor(seen):
    def run(ctx):
        seen.append({"clean": ctx.params.get(assemble.EXPORT_CLEAN), "no_bgm": ctx.params.get(assemble.EXPORT_NO_BGM),
                     "clips": len(ctx.inputs.get("clip") or [])})
        return ExecResult([ArtifactSpec("video", ext="mp4", data=f"V:{ctx.params[assemble.EXPORT_CLEAN]}:{ctx.params[assemble.EXPORT_NO_BGM]}".encode())])
    return run


def test_status_lists_the_three_variants_for_the_current_video(done):
    svc, cid, _ = done
    st = exports.status(svc, cid)
    assert st["artifact_id"] and st["fresh"] is True and st["has_bgm"] is True
    assert {k: v["state"] for k, v in st["variants"].items()} == {"clean": "none", "no_bgm": "none", "clean_no_bgm": "none"}


def test_each_variant_rebuilds_the_same_video_once_with_the_right_flags(done):
    svc, cid, _ = done
    seen: list[dict] = []
    st = exports.start(svc, cid, "clean", executor=fake_executor(seen), wait=True)
    assert st["variants"]["clean"]["state"] == "ready"
    assert seen == [{"clean": True, "no_bgm": False, "clips": 4}]               # dựng lại từ đúng 4 clip đã duyệt (fit_check)
    path, name = exports.file_path(svc, cid, "clean")
    assert path.read_bytes() == b"V:True:False" and name.endswith("khong-watermark.mp4")
    exports.start(svc, cid, "clean", executor=fake_executor(seen), wait=True)   # đã có file: không dựng lại
    assert len(seen) == 1
    exports.start(svc, cid, "no_bgm", executor=fake_executor(seen), wait=True)
    assert seen[-1] == {"clean": False, "no_bgm": True, "clips": 4}
    assert exports.file_path(svc, cid, "no_bgm")[0].read_bytes() == b"V:False:True"


def test_a_failed_export_reports_the_error_and_can_be_retried(done):
    svc, cid, _ = done

    def boom(ctx):
        raise assemble.AssembleError("Xóa watermark shot:1 lỗi: gwr không xóa được watermark")
    st = exports.start(svc, cid, "clean", executor=boom, wait=True)
    assert st["variants"]["clean"]["state"] == "error" and "shot:1" in st["variants"]["clean"]["error"]
    with pytest.raises(exports.ExportError, match="chưa được tạo"):
        exports.file_path(svc, cid, "clean")
    st = exports.start(svc, cid, "clean", executor=fake_executor([]), wait=True)
    assert st["variants"]["clean"]["state"] == "ready"


def test_stale_video_or_no_music_or_unknown_variant_is_refused(done):
    svc, cid, executors = done
    with pytest.raises(exports.ExportError, match="Không có kiểu tải"):
        exports.start(svc, cid, "lạ")
    svc.set_params(cid, "assemble", {"caption_style": "box"})                   # video đang chọn thành cũ
    assert exports.status(svc, cid)["fresh"] is False
    with pytest.raises(exports.ExportError, match="ghép lại"):
        exports.start(svc, cid, "clean", executor=fake_executor([]))
    svc.runner.executors["assemble"] = lambda ctx: ExecResult([ArtifactSpec("video", ext="mp4", data=b"NO-MUSIC", meta={"bgm": []})])
    run_and_wait(svc, cid, "assemble")
    with pytest.raises(exports.ExportError, match="không có nhạc nền"):
        exports.start(svc, cid, "no_bgm", executor=fake_executor([]))


def test_without_a_final_video_status_explains_and_start_refuses(svc):
    from .conftest import prime
    cid = prime(svc)
    assert exports.status(svc, cid)["artifact_id"] is None
    with pytest.raises(exports.ExportError, match="Chưa có video"):
        exports.start(svc, cid, "clean")

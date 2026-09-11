import json

import pytest
from pathlib import Path
from app.workflow.service import (
    calculate_voiceover_word_range,
    execute_gpt_script_generation,
    generate_validated_gpt_scripts,
    parse_gpt_scripts,
    validate_gpt_scripts,
    concat_workflow_scenes,
    parse_analysis_to_structured,
    list_exported_videos,
    delete_exported_video,
    WORKFLOW_EXPORTS_DIR,
)


def test_voiceover_word_range_follows_clip_duration():
    assert calculate_voiceover_word_range(10) == (20, 24)
    assert calculate_voiceover_word_range(6) == (12, 14)
    assert calculate_voiceover_word_range(10, min_words=16, max_words=24) == (16, 24)

    with pytest.raises(ValueError, match="min_words"):
        calculate_voiceover_word_range(10, min_words=31, max_words=20)


def test_gpt_prompt_uses_dynamic_clip_contract(monkeypatch):
    from app.workflow import service as workflow_service

    captured = {}

    monkeypatch.setattr(
        workflow_service,
        "read_config",
        lambda: {"chatgpt_9router": {"endpoint": "http://router.test/v1", "api_key": "test-key"}},
    )

    def fake_chat_completion(**kwargs):
        captured.update(kwargs)
        return {"ok": True, "content": "mock response"}

    monkeypatch.setattr(workflow_service, "chat_completion", fake_chat_completion)

    raw_text, _ = execute_gpt_script_generation(
        product_data="Sản phẩm thử nghiệm",
        script_config={
            "count": 5,
            "content_mode": "ugc",
            "platform": "reels",
            "clip_duration_seconds": 10,
        },
        prompt_template=(
            "Tạo {{SCRIPT_COUNT}} kịch bản {{CONTENT_MODE}} cho {{PLATFORM}}, "
            "clip {{CLIP_DURATION}}s, {{MIN_WORDS}}-{{MAX_WORDS}} từ. {{PRODUCT_DATA}}"
        ),
    )

    assert raw_text == "mock response"
    assert "Tạo 5 kịch bản ugc cho reels, clip 10s, 20-24 từ" in captured["prompt"]
    assert "Sản phẩm thử nghiệm" in captured["prompt"]
    assert "đúng một clip Google Flow dài 10 giây" in captured["system_prompt"]


def test_validate_gpt_scripts_rejects_invalid_flow_contract():
    scripts = parse_gpt_scripts(
        json.dumps({
            "scripts": [{
                "angle": "Review",
                "title": "Một tiêu đề",
                "hook": "Hook",
                "visual_direction": "Một cú máy liền mạch",
                "voiceover": "quá ngắn",
                "on_screen_text": "Text",
                "cta": "Xem thêm",
            }]
        }, ensure_ascii=False),
        expected_count=1,
    )
    with pytest.raises(ValueError, match="từ lời thoại"):
        validate_gpt_scripts(scripts, expected_count=1, min_words=20, max_words=30)


def test_validate_gpt_scripts_does_not_silently_truncate_json_output():
    voiceover = " ".join(f"từ{i}" for i in range(20))
    raw_items = [
        {
            "angle": f"Góc {index}",
            "title": f"Kịch bản {index}",
            "hook": "Hook rõ ràng",
            "visual_direction": "Một cú máy liền mạch tập trung vào sản phẩm",
            "voiceover": voiceover,
            "on_screen_text": "Thông điệp ngắn",
            "cta": "Xem thêm khi bạn cần",
        }
        for index in (1, 2)
    ]
    scripts = parse_gpt_scripts(
        json.dumps({"scripts": raw_items}, ensure_ascii=False),
        expected_count=1,
    )

    assert len(scripts) == 2
    with pytest.raises(ValueError, match="Cần đúng 1 kịch bản"):
        validate_gpt_scripts(scripts, expected_count=1, min_words=20, max_words=30)


def test_generate_validated_scripts_repairs_once(monkeypatch):
    from app.workflow import service as workflow_service

    valid_voiceover = " ".join(f"từ{i}" for i in range(20))
    responses = [
        json.dumps({"scripts": [{"angle": "Thiếu trường"}]}, ensure_ascii=False),
        json.dumps({
            "scripts": [
                {
                    "angle": "Review thực tế",
                    "title": "Trải nghiệm nhanh",
                    "hook": "Bạn cần một lựa chọn gọn nhẹ?",
                    "visual_direction": "Một cú máy liền mạch cận sản phẩm bên cửa sổ",
                    "voiceover": valid_voiceover,
                    "on_screen_text": "Gọn nhẹ mỗi ngày",
                    "cta": "Xem chi tiết khi bạn cần",
                }
            ]
        }, ensure_ascii=False),
    ]

    def fake_execute(**_kwargs):
        return responses.pop(0), "mock-model"

    monkeypatch.setattr(workflow_service, "execute_gpt_script_generation", fake_execute)
    raw_text, model, scripts, repaired, duration, min_words, max_words = generate_validated_gpt_scripts(
        product_data="Sản phẩm test",
        script_config={"count": 1, "clip_duration_seconds": 10},
    )

    assert raw_text
    assert model == "mock-model"
    assert len(scripts) == 1
    assert repaired is True
    assert (duration, min_words, max_words) == (10, 20, 24)
    assert responses == []


def test_parse_gpt_scripts_dynamic_count():
    sample_markdown = """
### Góc 1: Vấn đề nhiệt mùa hè
Hook: Nắng nóng khiến bạn khó chịu?
Vấn đề: Mồ hôi làm ướt đẫm áo.
Sản phẩm: Áo Polo Pique Cotton thoáng khí.
Lợi ích: Khô thoáng suốt 12 tiếng.
CTA: Đặt ngay kẻo lỡ ưu đãi.

### Góc 2: Phong thái công sở lịch lãm
Hook: Muốn đi làm vừa mát vừa chuẩn soái ca?
Vấn đề: Áo sơ mi quá gò bó.
Sản phẩm: Áo Polo dệt kim cao cấp.
Lợi ích: Co giãn 4 chiều mềm mại.
CTA: Nhấn vào giỏ hàng ngay.
"""
    # 1. Yêu cầu 2 kịch bản -> Thành công
    scripts = parse_gpt_scripts(sample_markdown, expected_count=2)
    assert len(scripts) == 2
    assert "Góc 1" in scripts[0].title or "Vấn đề" in scripts[0].title
    assert "Góc 2" in scripts[1].title or "lịch lãm" in scripts[1].title
    assert scripts[0].hook == "Nắng nóng khiến bạn khó chịu?"

    # 2. Yêu cầu 3 kịch bản nhưng bài chỉ có 2 -> Phải ném ValueError
    with pytest.raises(ValueError, match="Không thể phân tách đủ 3 kịch bản"):
        parse_gpt_scripts(sample_markdown, expected_count=3)


def test_parse_gpt_scripts_json_format():
    sample_json = """```json
    {
      "scripts": [
        {
          "angle": "Review chân thực",
          "title": "Mẹo mặc mát cả ngày",
          "voiceover": "Đừng để nắng hè làm bạn mệt mỏi...",
          "visual_direction": "Cận cảnh chạm tay vào chất vải cotton dệt pique thoáng khí",
          "on_screen_text": "Thoáng mát 12 tiếng",
          "cta": "Mua ngay tại giỏ hàng"
        },
        {
          "angle": "Kể chuyện Lifestyle",
          "title": "Một ngày làm việc năng động",
          "voiceover": "Từ công sở đến quán cafe...",
          "visual_direction": "Góc quay tracking nhân vật tự tin sải bước dưới phố",
          "cta": "Ưu đãi 20% hôm nay"
        }
      ]
    }
    ```"""
    scripts = parse_gpt_scripts(sample_json, expected_count=2)
    assert len(scripts) == 2
    assert scripts[0].angle == "Review chân thực"
    assert "chất vải cotton" in scripts[0].visual_direction
    assert "nắng hè" in scripts[0].voiceover
    assert scripts[1].angle == "Kể chuyện Lifestyle"


def test_parse_gpt_scripts_reads_dynamic_angle_section():
    sample_markdown = """
### Kịch bản 1: Buổi sáng gọn nhẹ
- Góc tiếp cận: Lifestyle tối giản
- Hook: Một bước nhỏ cho buổi sáng nhẹ nhàng hơn.
- Gợi ý hình ảnh: Một cú máy liền mạch, cận sản phẩm trên bàn cạnh cửa sổ.
- Lời thoại: Bắt đầu ngày mới gọn gàng với đúng điều bạn cần.
- Chữ trên màn hình: Chỉ một bước
- CTA: Xem chi tiết khi bạn sẵn sàng.
"""
    scripts = parse_gpt_scripts(sample_markdown, expected_count=1)
    assert scripts[0].angle == "Lifestyle tối giản"
    assert "cú máy liền mạch" in (scripts[0].visual_direction or "")


def test_parse_gpt_scripts_5_items_markdown():
    sample_md_5 = """
### Kịch bản 1: Giải quyết vấn đề - Góc: Problem Solving
Gợi ý hình ảnh: Cận cảnh mồ hôi ướt áo.
Lời thoại: Trời nóng bức làm bạn khó chịu?
CTA: Đặt ngay!

### Kịch bản 2: Điểm bán hàng độc nhất - Góc: USP Focus
Gợi ý hình ảnh: Test co giãn 4 chiều của vải.
Lời thoại: Chất vải dệt kim cao cấp co giãn cực tốt.
CTA: Xem ngay!

### Kịch bản 3: Trải nghiệm người dùng - Góc: User Experience
Gợi ý hình ảnh: Nụ cười tự tin khi mặc áo.
Lời thoại: Mặc lên cảm giác như không mặc gì, cực kỳ nhẹ.
CTA: Mua liền!

### Kịch bản 4: So sánh thực tế - Góc: Comparison
Gợi ý hình ảnh: Đặt 2 loại áo cạnh nhau.
Lời thoại: Khác biệt hoàn toàn so với áo cotton thông thường.
CTA: Thử ngay!

### Kịch bản 5: Bằng chứng xã hội - Góc: Social Proof
Gợi ý hình ảnh: Hàng ngàn đánh giá 5 sao trên màn hình.
Lời thoại: Hơn 10.000 khách hàng đã tin dùng sản phẩm này.
CTA: Săn deal ngay!
"""
    scripts = parse_gpt_scripts(sample_md_5, expected_count=5)
    assert len(scripts) == 5
    assert scripts[3].angle == "Problem Solving" or "Comparison" in scripts[3].angle or "Kịch bản 4" in scripts[3].title
    assert scripts[4].angle == "Problem Solving" or "Social Proof" in scripts[4].angle or "Kịch bản 5" in scripts[4].title
    assert scripts[3].visual_direction is not None
    assert scripts[4].voiceover is not None

    # Kiểm tra tính năng cắt gọn chính xác: input có 5 kịch bản nhưng chỉ yêu cầu 3 -> Trả về đúng 3 kịch bản
    truncated = parse_gpt_scripts(sample_md_5, expected_count=3)
    assert len(truncated) == 3
    assert "Kịch bản 1" in truncated[0].title
    assert "Kịch bản 2" in truncated[1].title
    assert "Kịch bản 3" in truncated[2].title


def test_concat_workflow_scenes_path_traversal():
    # Khi cố tình truyền output_filename có điều hướng path traversal '../../outside.mp4'
    # Phải được sanitize hoặc chặn đứng
    with pytest.raises((ValueError, FileNotFoundError)):
        concat_workflow_scenes(
            scene_video_paths=["non_existent_1.mp4"],
            output_filename="../../malicious.mp4",
        )


def test_concat_workflow_scenes_veo_url_resolution(monkeypatch, tmp_path):
    # Test phân giải URL preview dạng /api/veo/history/{id}/file
    dummy_mp4 = tmp_path / "dummy_veo.mp4"
    dummy_mp4.write_bytes(b"\x00" * 100)

    from app.veo import service as veo_service
    monkeypatch.setattr(veo_service, "get_video_path", lambda vid: dummy_mp4 if vid == "mock123" else None)

    # Nếu mock concat_segments để không cần ffmpeg thật
    from app.workflow import service as wf_service
    monkeypatch.setattr(wf_service, "concat_segments", lambda segs, out, work: out)
    monkeypatch.setattr(wf_service, "ffprobe_duration", lambda p: 4.0)

    res = concat_workflow_scenes(
        scene_video_paths=["/api/veo/history/mock123/file"],
        output_filename="test_veo_res.mp4",
    )
    assert res.status == "done"
    assert res.duration_sec == 4.0
    assert "test_veo_res.mp4" in res.final_video_url


def test_parse_analysis_to_structured():
    sample_gemini_output = """
**Điểm 'ăn tiền' và yếu tố thu hút chung:**
- Thiết kế chai tinh xảo, chất liệu thủy tinh cao cấp trong suốt sang trọng.
- Công nghệ lưu hương 3 tầng kéo dài 12 tiếng liên tục.
- 100% tinh dầu thiên nhiên nhập khẩu từ Pháp.

**Phân loại chi tiết từng sản phẩm trong hình:**
1. **Chai màu hồng (Rose Elegance)**:
- **Thành phần chính**: Chiết xuất hoa hồng Damask, xạ hương trắng, hoa mẫu đơn.
- **Công dụng cốt lõi**: Tạo hương thơm quý phái, tăng sức quyến rũ nữ tính.
- **Trải nghiệm / Mùi hương**: Ngọt ngào, thanh lịch, phù hợp hẹn hò và dạ tiệc.

2. **Chai màu cam/nâu (Amber Sun)**:
- **Thành phần chính**: Gỗ đàn hương, hổ phách, vỏ cam bergamot.
- **Công dụng cốt lõi**: Mang lại cảm giác ấm áp, tự tin và thư thái.
- **Trải nghiệm / Mùi hương**: Trầm ấm, cá tính, sang trọng chuẩn doanh nhân.

3. **Chai màu vàng (Golden Jasmine)**:
- **Thành phần chính**: Tinh chất hoa nhài, trà trắng, cam chanh tươi mát.
- **Công dụng cốt lõi**: Khử mùi cơ thể, sảng khoái suốt ngày dài năng động.
- **Trải nghiệm / Mùi hương**: Tươi mát, trẻ trung, phù hợp dùng hàng ngày đi làm.
"""
    res = parse_analysis_to_structured(sample_gemini_output)

    assert "Thiết kế chai tinh xảo" in res.product_features
    assert len(res.key_selling_points) >= 3
    assert len(res.classifications) == 3

    p1 = res.classifications[0]
    assert "Rose Elegance" in p1.name
    assert "Damask" in (p1.main_ingredients or "")
    assert "quý phái" in (p1.core_benefits or "")
    assert "Ngọt ngào" in (p1.experience_scent or "")

    p2 = res.classifications[1]
    assert "Amber Sun" in p2.name
    assert "đàn hương" in (p2.main_ingredients or "")
    assert "ấm áp" in (p2.core_benefits or "")

    p3 = res.classifications[2]
    assert "Golden Jasmine" in p3.name
    assert "hoa nhài" in (p3.main_ingredients or "")
    assert "Tươi mát" in (p3.experience_scent or "")


def test_exported_videos_library(tmp_path):
    # Tạo dummy video trong WORKFLOW_EXPORTS_DIR
    dummy_file = WORKFLOW_EXPORTS_DIR / "dummy_test_lib.mp4"
    dummy_file.write_bytes(b"\x00" * 1024)

    try:
        items = list_exported_videos()
        match = [x for x in items if x["filename"] == "dummy_test_lib.mp4"]
        assert len(match) == 1
        assert match[0]["size_bytes"] == 1024
        assert "/api/workflow/exports/dummy_test_lib.mp4" in match[0]["video_url"]

        # Xóa video
        ok = delete_exported_video("dummy_test_lib.mp4")
        assert ok is True
        assert not dummy_file.exists()
    finally:
        if dummy_file.exists():
            dummy_file.unlink()


def test_concat_workflow_scenes_filename_and_veo_id_resolution(monkeypatch, tmp_path):
    dummy_mp4 = tmp_path / "00066213-f95.mp4"
    dummy_mp4.write_bytes(b"\x00" * 100)

    from app.veo import service as veo_service
    monkeypatch.setattr(veo_service, "get_video_path", lambda vid: dummy_mp4 if "00066213-f95" in str(vid) else None)

    from app.workflow import service as wf_service
    monkeypatch.setattr(wf_service, "concat_segments", lambda segs, out, work: out)
    monkeypatch.setattr(wf_service, "ffprobe_duration", lambda p: 10.0)

    # Test với tên file trần "00066213-f95.mp4"
    res = concat_workflow_scenes(
        scene_video_paths=["00066213-f95.mp4"],
        output_filename="test_raw_filename.mp4",
    )
    assert res.status == "done"
    assert res.duration_sec == 10.0

    # Test với ID trần "00066213-f95"
    res2 = concat_workflow_scenes(
        scene_video_paths=["00066213-f95"],
        output_filename="test_raw_id.mp4",
    )
    assert res2.status == "done"


def test_sync_voiceover_to_scenes_per_clip(tmp_path):
    from app.workflow.service import sync_voiceover_to_scenes

    # Tạo 2 clip video giả lập
    v1 = tmp_path / "clip_0.mp4"
    v2 = tmp_path / "clip_1.mp4"
    v1.write_bytes(b"\x00" * 10)
    v2.write_bytes(b"\x00" * 10)

    # Thư mục voiceover chứa vo_0.wav (dài hơn: 12s -> cần atempo) và vo_1.wav (ngắn hơn: 8s -> cần apad)
    vo_dir = tmp_path / "voiceover_job"
    vo_dir.mkdir()
    vo_0 = vo_dir / "vo_0.wav"
    vo_1 = vo_dir / "vo_1.wav"
    vo_combined = vo_dir / "combined.wav"
    vo_0.write_bytes(b"\x00" * 10)
    vo_1.write_bytes(b"\x00" * 10)
    vo_combined.write_bytes(b"\x00" * 10)

    work_dir = tmp_path / "work"

    # Mock ffprobe_duration
    dur_map = {
        str(v1): 10.0,
        str(v2): 10.0,
        str(vo_0): 12.0,  # D > T -> atempo
        str(vo_1): 8.0,   # D <= T -> apad
        str(vo_combined): 20.0,
    }

    import subprocess
    orig_run = subprocess.run
    commands_executed = []

    def fake_run(cmd, *args, **kwargs):
        commands_executed.append(cmd)
        out_file = Path(cmd[-1])
        out_file.parent.mkdir(parents=True, exist_ok=True)
        out_file.write_bytes(b"\x00" * 50)
        class MockProc:
            returncode = 0
            stdout = "10.0"
            stderr = ""
        return MockProc()

    from app.workflow import service as wf_service
    wf_service.ffprobe_duration = lambda p: dur_map.get(str(p), 10.0)

    import subprocess
    old_run = subprocess.run
    subprocess.run = fake_run
    try:
        synced_result = sync_voiceover_to_scenes([v1, v2], vo_combined, work_dir)
        assert synced_result.name == "synced_combined_vo.wav"
        # Kiểm tra đã gọi atempo cho clip 0 (factor = 1.20)
        assert any("atempo=1.2000" in " ".join(c) for c in commands_executed if isinstance(c, list))
        # Kiểm tra đã gọi apad cho clip 1
        assert any("apad" in " ".join(c) for c in commands_executed if isinstance(c, list))
    finally:
        subprocess.run = old_run


def test_bgm_import_session_local_exists():
    # Kiểm tra SessionLocal có thể import được từ app.db
    from app.db import SessionLocal
    assert SessionLocal is not None



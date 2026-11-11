from app.workflow.service import get_default_motion_prompt, MOTION_PROMPT_FILE


def test_motion_prompt_file_exists():
    assert MOTION_PROMPT_FILE.exists(), f"Prompt file {MOTION_PROMPT_FILE} must exist"
    content = get_default_motion_prompt()
    # Omni 1.2: chỉ đạo chính ngắn; câu mở đầu theo ảnh do giao diện tự dựng.
    assert "input video" in content and "timing" in content
    assert "image reference" not in content.lower()
    # Crucial safeguard: ensure the trigger phrase "anatomically correct" is not present!
    assert "anatomically correct" not in content.lower()

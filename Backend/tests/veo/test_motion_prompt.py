from app.workflow.service import get_default_motion_prompt, MOTION_PROMPT_FILE


def test_motion_prompt_file_exists():
    assert MOTION_PROMPT_FILE.exists(), f"Prompt file {MOTION_PROMPT_FILE} must exist"
    content = get_default_motion_prompt()
    assert "choreography" in content
    assert "Natural biomechanics" in content
    # Crucial safeguard: ensure the trigger phrase "anatomically correct" is not present!
    assert "anatomically correct" not in content.lower()

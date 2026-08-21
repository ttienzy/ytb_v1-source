import json
import re
import sys

path = r"D:\GOOGLE SEARCH\tools\Backend\Data\curl_gemini_response.txt"
raw = open(path, "r", encoding="utf-8").read().splitlines()
found = []

def walk(value):
    if isinstance(value, str):
        text = value.replace("\\n", "\n")
        if len(text) >= 40 and not text.startswith(("http://", "https://")) and not re.fullmatch(r"[A-Za-z0-9_+/=-]{40,}", text):
            if any(char.isalpha() for char in text):
                found.append(text)
    elif isinstance(value, list):
        for item in value:
            walk(item)
    elif isinstance(value, dict):
        for item in value.values():
            walk(item)

for line in raw:
    if not line.startswith("[["):
        continue
    try:
        outer = json.loads(line)
        payload = outer[0][2] if outer and outer[0] and len(outer[0]) > 2 else None
        if isinstance(payload, str):
            walk(json.loads(payload))
    except (ValueError, IndexError, TypeError):
        continue

for text in found[-8:]:
    sys.stdout.buffer.write(b"---\n")
    sys.stdout.buffer.write((text[:3000] + "\n").encode("utf-8", errors="replace"))

import json
import urllib.parse

har = json.loads(open(r"..\gemini.google.com.har", encoding="utf-8").read())

def walk(value):
    if isinstance(value, str) and 2 <= len(value) <= 500:
        if not (len(value) > 40 and all(char.isalnum() or char in "_-!" for char in value)):
            print(value)
    elif isinstance(value, list):
        for item in value:
            walk(item)
    elif isinstance(value, dict):
        for item in value.values():
            walk(item)

for entry in [item for item in har["log"]["entries"] if item["request"]["method"] == "POST" and "gemini.google.com" in item["request"]["url"]]:
    body = entry["request"].get("postData", {}).get("text", "")
    parts = [item for item in body.split("&") if item.startswith("f.req=")]
    if not parts:
        continue
    try:
        encoded = parts[0][6:]
        outer = json.loads(urllib.parse.unquote(urllib.parse.unquote(encoded)))
        inner = json.loads(outer[1])
    except Exception:
        continue
    print("---", entry["request"]["url"].split("?")[0])
    walk(inner)

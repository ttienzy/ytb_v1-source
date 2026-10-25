"""
CLI Runner cho Meta Muse AI
Sử dụng trực tiếp MuseService từ app.ai.muse
"""
import sys
import os

# Đảm bảo import được Backend app
BACKEND_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "Backend"))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

from app.ai.muse.service import muse_service
from app.ai.muse.schemas import MuseGenerateRequest

def main():
    prompt = "A cute golden retriever puppy wearing tiny sunglasses sitting on a beach towel under an umbrella, bright tropical sunlight, photorealistic 4k"
    if len(sys.argv) > 1:
        prompt = " ".join(sys.argv[1:])

    print(f"[*] Đang yêu cầu Muse tạo video với prompt:\n    '{prompt}'\n")
    req = MuseGenerateRequest(prompt=prompt, use_side_chat=True)
    res = muse_service.generate_video(req)

    if res.ok:
        print(f"\n[THÀNH CÔNG] Video đã tạo xong trong {res.duration_seconds}s!")
        print(f"  - File MP4 lưu tại: {res.local_path}")
        print(f"  - Kích thước: {res.file_size:,} bytes")
    else:
        print(f"\n[THẤT BẠI] Lỗi: {res.error}")

if __name__ == "__main__":
    main()

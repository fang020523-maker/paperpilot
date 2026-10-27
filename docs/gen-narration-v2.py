# -*- coding: utf-8 -*-
"""v2 解说词 TTS 生成（13 条，基于段落时间轴）"""
import asyncio, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
os.chdir(HERE)
spec = json.load(open("narration-v2.json", encoding="utf-8"))

async def gen(text, out):
    import edge_tts
    await edge_tts.Communicate(text, spec["voice"], rate=spec["rate"]).save(out)

ok = fail = 0
for clip in spec["clips"]:
    out = os.path.join("narration", clip["file"])
    if os.path.exists(out) and os.path.getsize(out) > 3000:
        ok += 1
        continue
    try:
        asyncio.run(gen(clip["text"], out))
        assert os.path.getsize(out) > 2000
        ok += 1
        print("ok", clip["file"])
    except Exception as e:
        fail += 1
        print("FAIL", clip["file"], str(e)[:80])
print(f"{ok} ok / {fail} fail")
sys.exit(1 if fail else 0)

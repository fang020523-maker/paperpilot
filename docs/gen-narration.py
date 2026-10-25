# -*- coding: utf-8 -*-
"""生成全部旁白 clip（edge-tts 神经语音，失败自动回退 Windows SAPI）"""
import asyncio, json, os, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
os.chdir(HERE)

spec = json.load(open("narration-script.json", encoding="utf-8"))
VOICE = spec["voice"]
RATE = spec["rate"]

async def gen_edge(text, out):
    import edge_tts
    tts = edge_tts.Communicate(text, VOICE, rate=RATE)
    await tts.save(out)

def gen_sapi(text, out):
    # 回退：Windows SAPI（音质一般但离线可用）
    ps = f'''
Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
$s.SelectVoice((($s.GetInstalledVoices() | Where-Object {{ $_.VoiceInfo.Culture.Name -like "zh*" }} | Select-Object -First 1).VoiceInfo.Name))
$s.SetOutputToWaveFile("{os.path.abspath(out).replace(chr(92), '/')}")
$s.Speak("{text}")
$s.Dispose()
'''
    subprocess.run(["powershell", "-NoProfile", "-Command", ps], check=True,
                   capture_output=True, timeout=120)

ok = fail = 0
for clip in spec["clips"]:
    out = os.path.join("narration", clip["file"])
    if os.path.exists(out) and os.path.getsize(out) > 4000:
        print(f"skip {clip['file']}")
        ok += 1
        continue
    try:
        asyncio.run(gen_edge(clip["text"], out))
        assert os.path.getsize(out) > 2000
        ok += 1
        print(f"edge ok {clip['file']}")
    except Exception as e:
        print(f"edge FAIL {clip['file']}: {str(e)[:60]} → SAPI")
        try:
            gen_sapi(clip["text"], out.replace(".mp3", ".wav"))
            ok += 1
            print(f"sapi ok {clip['file']}")
        except Exception as e2:
            fail += 1
            print(f"sapi FAIL {clip['file']}: {str(e2)[:80]}")

print(f"done: {ok} ok, {fail} fail")
sys.exit(1 if fail else 0)

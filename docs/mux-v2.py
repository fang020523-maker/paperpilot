# -*- coding: utf-8 -*-
"""v2 成片：9 段 VP8 无损拼接 + 13 条旁白按段偏移混入 → demo-video-v2.mp4 (H264+AAC)"""
import av, json, os
from fractions import Fraction
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
os.chdir(HERE)

spec = json.load(open("narration-v2.json", encoding="utf-8"))
segs = spec["segments"]
SR = 48000

# ---- 视频拼接（VP8 直通 + 时间戳偏移）+ 计算每段全局起点 ----
merged = av.open("demo-video-v2-silent.webm", "w")
vout = merged.add_stream("vp8", rate=20)
vout.width, vout.height, vout.pix_fmt = 1440, 900, "yuv420p"
vout.time_base = Fraction(1, 1000)
vout.codec_tag = "VP80"
vout.options = {"crf": "10", "b": "0", "deadline": "realtime", "cpu-used": "8"}

seg_starts = []  # ms
offset = 0
for s in segs:
    seg_starts.append(offset)
    src = av.open(s["file"])
    vs = src.streams.video[0]
    n = 0
    for packet in src.demux(vs):
        if packet.dts is None:
            continue
        packet.stream = vout
        if offset:
            if packet.pts is not None:
                packet.pts += offset
            if packet.dts is not None:
                packet.dts += offset
        merged.mux(packet)
        n += 1
    src.close()
    real_ms = n * 50
    offset += real_ms + 800  # 0.8s 段间隔
    print(f"{s['file']}: {n}f start={seg_starts[-1]}ms")
merged.close()
TOTAL_MS = offset - 800
print("total:", round(TOTAL_MS / 1000, 1), "s")

# ---- 混音轨道 ----
total_n = int(TOTAL_MS / 1000 * SR)
track = np.zeros(total_n, dtype=np.float32)
resampler = av.AudioResampler(format="s16", layout="mono", rate=SR)
for clip in spec["clips"]:
    path = os.path.join("narration", clip["file"])
    cont = av.open(path)
    ast = cont.streams.audio[0]
    buf = []
    for frame in cont.decode(ast):
        for rf in resampler.resample(frame):
            buf.append(rf.to_ndarray().reshape(-1))
    cont.close()
    pcm = np.concatenate(buf) if buf else np.zeros(1, dtype=np.int16)
    start_ms = seg_starts[clip["seg"]] + int(clip["at"] * 1000)
    st = int(start_ms / 1000 * SR)
    en = min(st + len(pcm), total_n)
    if en > st:
        track[st:en] += pcm[: en - st].astype(np.float32) / 32768.0 * 0.9
    print(f"{clip['file']} @ {start_ms}ms ({len(pcm)/SR:.1f}s)")
track = np.clip(track, -1.0, 1.0)

# ---- 封装 H264+AAC ----
out = av.open("demo-video-v2.mp4", "w")
venc = out.add_stream("libx264", rate=20)
venc.width, venc.height, venc.pix_fmt = 1440, 900, "yuv420p"
venc.time_base = Fraction(1, 20)
venc.options = {"preset": "veryfast", "crf": "21"}
aenc = out.add_stream("aac", rate=SR)
aenc.layout = "mono"
aenc.format = "fltp"
aenc.time_base = Fraction(1, SR)

src = av.open("demo-video-v2-silent.webm")
vin = src.streams.video[0]
track_i16 = (track * 32767).astype(np.int16)
audio_frames = []
apos = 0
for i in range(0, len(track_i16), 1024):
    chunk = track_i16[i : i + 1024]
    if len(chunk) < 1024:
        chunk = np.pad(chunk, (0, 1024 - len(chunk)))
    af = av.AudioFrame.from_ndarray(chunk.reshape(1, -1), format="s16", layout="mono")
    af.sample_rate = SR
    af.pts = apos
    af.time_base = Fraction(1, SR)
    apos += 1024
    audio_frames.append(af)

vpos = 0
aptr = 0
for frame in src.decode(vin):
    frame.pts = vpos
    frame.time_base = Fraction(1, 20)
    for p in venc.encode(frame):
        out.mux(p)
    need = SR // 20
    done = 0
    while done < need and aptr < len(audio_frames):
        for p in aenc.encode(audio_frames[aptr]):
            out.mux(p)
        aptr += 1
        done += 1024
    vpos += 1
while aptr < len(audio_frames):
    for p in aenc.encode(audio_frames[aptr]):
        out.mux(p)
    aptr += 1
for p in venc.encode(None):
    out.mux(p)
for p in aenc.encode(None):
    out.mux(p)
out.close()
src.close()
os.remove("demo-video-v2-silent.webm")
print("final:", round(os.path.getsize("demo-video-v2.mp4") / 1048576, 1), "MB")

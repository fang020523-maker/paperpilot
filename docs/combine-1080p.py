# -*- coding: utf-8 -*-
"""1080p 成片：无声放大视频 + v2 源音轨 → demo-video-final.mp4"""
import av, os
from fractions import Fraction
import numpy as np

SR = 48000
SILENT = "demo-video-1080-silent.mp4"
AUDIO_SRC = "demo-video-v2.mp4"
OUT = "demo-video-final.mp4"

# 若无声 1080p 不存在：先从 v2 放大生成（纯视频）
if not os.path.exists(SILENT):
    os.rename(OUT, SILENT)  # 上一步产物即无声 1080p

# ---- 音轨：v2 解码为 PCM 轨 ----
src = av.open(AUDIO_SRC)
ain = src.streams.audio[0]
chunks = []
for frame in src.decode(ain):
    chunks.append(frame.to_ndarray().astype(np.float32).reshape(-1))
track = np.concatenate(chunks)
src.close()

out = av.open(OUT, "w")
venc = out.add_stream("libx264", rate=20)
venc.width, venc.height, venc.pix_fmt = 1920, 1080, "yuv420p"
venc.time_base = Fraction(1, 20)
venc.options = {"preset": "medium", "crf": "18", "tune": "film"}
aenc = out.add_stream("aac", rate=SR)
aenc.layout = "mono"
aenc.format = "fltp"
aenc.time_base = Fraction(1, SR)

# 音频帧序列
track_i16 = (track * 32767).astype(np.int16)
audio_frames = []
apos = 0
for i in range(0, len(track_i16), 1024):
    c = track_i16[i : i + 1024]
    if len(c) < 1024:
        c = np.pad(c, (0, 1024 - len(c)))
    af = av.AudioFrame.from_ndarray(c.reshape(1, -1), format="s16", layout="mono")
    af.sample_rate = SR
    af.pts = apos
    af.time_base = Fraction(1, SR)
    apos += 1024
    audio_frames.append(af)

# 视频：无声 1080p 解码重编码（crf18），音频按 20fps 节拍交错（mux-v2 逻辑）
sil = av.open(SILENT)
svin = sil.streams.video[0]
vpos = 0
aptr = 0
for frame in sil.decode(svin):
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
sil.close()
os.remove(SILENT)

# 验证
c = av.open(OUT)
streams = {s.type for s in c.streams}
v = c.streams.video[0]
frames = sum(1 for _ in c.decode(v))
c.close()
print(f"{v.width}x{v.height} {frames}帧={frames/20/60:.1f}分钟 流={sorted(streams)} 大小={round(os.path.getsize(OUT)/1048576,1)}MB")

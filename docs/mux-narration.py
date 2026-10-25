# -*- coding: utf-8 -*-
"""旁白混入视频：VP8 静音成片 + 11 条 TTS → demo-video-final.mp4 (H264+AAC)"""
import av, json, os
from fractions import Fraction
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
os.chdir(HERE)

SRC = "demo-video.webm"
OUT = "demo-video-final.mp4"
TOTAL_S = 153.0
SR = 48000

spec = json.load(open("narration-script.json", encoding="utf-8"))

# ---------- 1. 混音：全部 clip 解码重采样到 48k mono，按偏移放进总轨 ----------
total_n = int(TOTAL_S * SR)
track = np.zeros(total_n, dtype=np.float32)

src = av.open(SRC)
vin = src.streams.video[0]
resampler = av.AudioResampler(format="s16", layout="mono", rate=SR)

for clip in spec["clips"]:
    path = os.path.join("narration", clip["file"])
    cont = av.open(path)
    ast = cont.streams.audio[0]
    start = int(clip["start"] * SR)
    buf = []
    for frame in cont.decode(ast):
        # mp3 采样率不定 → 统一重采样
        for rf in resampler.resample(frame):
            buf.append(rf.to_ndarray().reshape(-1))
    cont.close()
    pcm = np.concatenate(buf) if buf else np.zeros(1, dtype=np.int16)
    # 轻微压声避免削波
    pcm_f = pcm.astype(np.float32) / 32768.0 * 0.9
    end = min(start + len(pcm_f), total_n)
    if end > start:
        track[start:end] += pcm_f[: end - start]
    print(f"{clip['file']}: {len(pcm)/SR:.1f}s @ {clip['start']}s")

# 防叠音削波
track = np.clip(track, -1.0, 1.0)
src.close()
print("track mixed:", round(len(track) / SR, 1), "s")

# ---------- 2. 封装：视频 VP8→H264，音频→AAC ----------
out = av.open(OUT, "w")
venc = out.add_stream("libx264", rate=20)
venc.width = 1440
venc.height = 900
venc.pix_fmt = "yuv420p"
venc.time_base = Fraction(1, 20)
venc.options = {"preset": "veryfast", "crf": "21"}

aenc = out.add_stream("aac", rate=SR)
aenc.layout = "mono"
aenc.format = "fltp"
aenc.time_base = Fraction(1, SR)

# 视频帧循环 + 音频样本调度
src = av.open(SRC)
vin = src.streams.video[0]

# 音频：按 AAC 帧大小（1024 samples）切块喂编码器
audio_pos = 0
samples_per_frame = 1024
track_i16 = (track * 32767).astype(np.int16)

# 先排音频（在视频时间轴上同步推进）
audio_frames = []
for i in range(0, len(track_i16), samples_per_frame):
    chunk = track_i16[i : i + samples_per_frame]
    if len(chunk) < samples_per_frame:
        chunk = np.pad(chunk, (0, samples_per_frame - len(chunk)))
    af = av.AudioFrame.from_ndarray(chunk.reshape(1, -1), format="s16", layout="mono")
    af.sample_rate = SR
    af.pts = audio_pos
    af.time_base = Fraction(1, SR)
    audio_pos += samples_per_frame
    audio_frames.append(af)

# 视频帧 pts（1/20s 基准），同时按 20fps 节奏插入对应音频
vpos = 0
aptr = 0
for packet_counter, frame in enumerate(src.decode(vin)):
    frame.pts = vpos
    frame.time_base = Fraction(1, 20)
    for p in venc.encode(frame):
        out.mux(p)
    # 每帧消耗 1/20s 的音频 = 2400 样本 → 分批 1024
    need = SR // 20
    done = 0
    while done < need and aptr < len(audio_frames):
        af = audio_frames[aptr]
        for p in aenc.encode(af):
            # 音频包时间基准已是 1/SR
            out.mux(p)
        aptr += 1
        done += samples_per_frame
    vpos += 1

# flush 音频剩余
while aptr < len(audio_frames):
    for p in aenc.encode(audio_frames[aptr]):
        out.mux(p)
    aptr += 1
# flush 视频与音频编码器
for p in venc.encode(None):
    out.mux(p)
for p in aenc.encode(None):
    out.mux(p)

out.close()
src.close()
print("final size:", round(os.path.getsize(OUT) / 1048576, 1), "MB")

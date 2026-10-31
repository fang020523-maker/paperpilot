# -*- coding: utf-8 -*-
"""Contextual Chunking A/B：BM25(带 LLM 上下文前缀) vs BM25(裸切块)，黄金集命中率对比
数据源：.data/knowledge-base.json（15 篇论文全部分块）
"""
import json, sys, os

sys.path.insert(0, os.path.join(os.getcwd(), "src"))
# 直接复用项目内 BM25 实现（通过 vitest 的 tsx 转译不可行 → 这里用等价 Python 实现）
# 为保证与生产实现一致，此处移植 src/lib/retrieval/bm25.ts 的分词与打分逻辑
import re

STOP = set("""a an the and or of to in on for with is are was were be been by as at from that this these
those it its we our they their which who whom can could will would should may might shall have has had
do does did not no but if then than so such both each other more most some any all 的 了 在 是 我 有 和 就
不 人 都 一 一个 上 也 很 到 说 要 去 你 会 着 没有 看 好 与 及 或 等 为 以 于 被 把 让 从 对""".split())

def tokenize(text):
    toks = []
    for w in re.findall(r"[a-z][a-z0-9\-_.]{1,30}|\d+(?:\.\d+)?%?", text.lower()):
        if w not in STOP and len(w) > 1:
            toks.append(w)
    for run in re.findall(r"[\u4e00-\u9fff]+", text):
        if len(run) == 1:
            toks.append(run)
        else:
            toks += [run[i:i+2] for i in range(len(run)-1)]
    return toks

K1, B = 1.5, 0.75

class BM25:
    def __init__(self):
        self.docs = {}
        self.df = {}
        self.total = 0
    def add(self, i, text):
        toks = tokenize(text)
        tf = {}
        for t in toks:
            tf[t] = tf.get(t, 0) + 1
        self.docs[i] = (tf, len(toks))
        self.total += len(toks)
        for t in tf:
            self.df[t] = self.df.get(t, 0) + 1
    def search(self, q, k=5):
        if not self.docs:
            return []
        qt = tokenize(q)
        avg = self.total / len(self.docs)
        scores = []
        for i, (tf, dl) in self.docs.items():
            s = 0.0
            for t in qt:
                f = tf.get(t)
                if not f:
                    continue
                n = self.df.get(t, 0)
                idf = (1 + (len(self.docs) - n + 0.5) / (n + 0.5))
                s += idf * (f * (K1 + 1)) / (f + K1 * (1 - B + B * dl / avg))
            if s > 0:
                scores.append((i, s))
        scores.sort(key=lambda x: -x[1])
        return scores[:k]

kb = json.load(open(".data/knowledge-base.json", encoding="utf-8"))
papers = {p["id"]: p["title"] for p in kb["papers"]}
golden = json.load(open("docs/golden-testset.json", encoding="utf-8"))["cases"]

idx_prefix, idx_raw = BM25(), BM25()
chunk_paper = {}
for c in kb["chunks"]:
    chunk_paper[c["id"]] = c["paperId"]
    prefixed = (c.get("contextPrefix") or "") + "\n" + c["rawText"]
    idx_prefix.add(c["id"], prefixed)
    idx_raw.add(c["id"], c["rawText"])

def hitrate(idx, k=5):
    hits = 0
    miss = []
    for case in golden:
        titles = [papers.get(chunk_paper[i], "") for i, _ in idx.search(case["q"], k)]
        ok = any(any(e in t for e in case["expect"]) for t in titles)
        hits += ok
        if not ok:
            miss.append(case["q"])
    return hits, miss

hp, mp = hitrate(idx_prefix)
hr, mr = hitrate(idx_raw)
n = len(golden)
print(f"BM25 命中率(top-5, {n} 题)：")
print(f"  Contextual（前缀+原文）: {hp}/{n} = {hp/n:.0%}")
print(f"  裸切块（仅原文）      : {hr}/{n} = {hr/n:.0%}")
if mp != mr:
    only_p = [q for q in mp if q not in mr]
    only_r = [q for q in mr if q not in mp]
    if only_p: print("  仅裸切块失败的题:", only_p)
    if only_r: print("  仅前缀版失败的题:", only_r)

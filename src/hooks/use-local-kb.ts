"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { embedInBrowser, getBrowserEmbedder } from "@/lib/local/browser-embedder";
import {
  clearChunks,
  getAllChunks,
  getMeta,
  localVectorSearch,
  putChunks,
  setMeta,
  type LocalChunk,
} from "@/lib/local/vector-store";

export type LocalKbStatus = "idle" | "checking" | "syncing" | "ready" | "error";

const SYNC_VERSION = 2;

export function useLocalKb() {
  const [status, setStatus] = useState<LocalKbStatus>("idle");
  const [device, setDevice] = useState<"webgpu" | "wasm" | null>(null);
  const [chunkCount, setChunkCount] = useState(0);
  const [progress, setProgress] = useState(0);
  const chunksRef = useRef<LocalChunk[] | null>(null);

  useEffect(() => {
    // 初始化：读取本地库状态
    void (async () => {
      const all = await getAllChunks().catch(() => [] as LocalChunk[]);
      chunksRef.current = all;
      setChunkCount(all.length);
    })();
  }, []);

  const ensureSynced = useCallback(async (): Promise<boolean> => {
    if (status === "syncing") return false;
    setStatus("checking");
    try {
      const syncedVersion = await getMeta<number>("syncVersion");
      const all = chunksRef.current ?? (await getAllChunks());
      chunksRef.current = all;

      const res = await fetch("/api/chunks");
      const { chunks: serverChunks, total } = (await res.json()) as {
        chunks: { id: string; paperId: string; paperTitle: string; page: number; section?: string; text: string }[];
        total: number;
      };
      // 集合比对（IndexedDB getAll 按主键序返回，与服务器插入序不同，不能用有序数组比对）
      const localIds = new Set(all.map((c) => c.id));
      const needSync =
        syncedVersion !== SYNC_VERSION ||
        all.length !== serverChunks.length ||
        serverChunks.some((sc) => !localIds.has(sc.id));

      const { device: dev } = await getBrowserEmbedder();
      setDevice(dev);

      if (!needSync) {
        setStatus("ready");
        return true;
      }

      // 端侧嵌入：批量 12 条，实时进度
      setStatus("syncing");
      setProgress(0);
      await clearChunks().catch(() => {});
      const BATCH = 12;
      const local: LocalChunk[] = [];
      for (let i = 0; i < serverChunks.length; i += BATCH) {
        const batch = serverChunks.slice(i, i + BATCH);
        const vectors = await embedInBrowser(
          batch.map((c) => c.text),
          "passage"
        );
        batch.forEach((c, j) => local.push({ ...c, embedding: vectors[j] }));
        setProgress(Math.round(((i + BATCH) / Math.max(serverChunks.length, 1)) * 100));
      }
      await putChunks(local);
      await setMeta("syncVersion", SYNC_VERSION);
      chunksRef.current = local;
      setChunkCount(local.length);
      setStatus("ready");
      return true;
    } catch (err) {
      console.error("[local-kb] 同步失败:", err);
      setStatus("error");
      return false;
    }
  }, [status]);

  const searchLocally = useCallback(
    async (query: string, topK = 5) => {
      const chunks = chunksRef.current ?? (await getAllChunks());
      chunksRef.current = chunks;
      if (chunks.length === 0) return [];
      const [emb] = await embedInBrowser([query], "query");
      return localVectorSearch(chunks, emb, topK);
    },
    []
  );

  return { status, device, chunkCount, progress, ensureSynced, searchLocally };
}

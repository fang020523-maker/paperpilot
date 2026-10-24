"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { EvaluationRecord } from "@/lib/types";

interface EvalState {
  records: EvaluationRecord[];
  addRecord: (r: EvaluationRecord) => void;
  clear: () => void;
}

export const useEvalStore = create<EvalState>()(
  persist(
    (set) => ({
      records: [],
      addRecord: (r) => set((s) => ({ records: [r, ...s.records].slice(0, 200) })),
      clear: () => set({ records: [] }),
    }),
    { name: "paperpilot-eval-history" }
  )
);

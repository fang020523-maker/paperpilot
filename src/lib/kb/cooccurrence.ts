/**
 * 术语共现图谱（降级模式）
 *
 * LLM 实体抽取不可用（离线开发/密钥未配置/抽取失败）时，
 * 从分块文本中扫描精选术语词典，同一分块内共现的实体连边——
 * 保证知识图谱页在任何环境下都能展示真实语料-derived 的网络结构。
 * 这是「零配置降级链」的图谱环节：LLM 抽取 → 词典共现。
 */
import type { Chunk, Community, EntityType, GraphEntity, GraphRelation } from "../types";
import { detectCommunities } from "./graph-extract";

const LEXICON: Partial<Record<EntityType, string[]>> = {
  dataset: [
    "HotpotQA", "ASQA", "PopQA", "Bio", "MS MARCO", "Natural Questions",
    "TriviaQA", "FEVER", "GSM8K", "SQuAD", "2WikiMultihopQA", "MuSiQue",
    "PubMedQA", "MMLU", "Common Crawl",
  ],
  model: [
    "GPT-4", "GPT-3.5", "GPT-3", "ChatGPT", "LLaMA", "Llama 2", "GLM",
    "BERT", "T5", "FLAN-T5", "Gemma", "Mistral", "Qwen",
  ],
  metric: ["F1", "EM", "FActScore", "Recall@k", "BLEU", "ROUGE", "FActScore"],
  method: [
    "Self-RAG", "CRAG", "Adaptive-RAG", "GraphRAG", "LightRAG", "RAPTOR",
    "HyDE", "BM25", "DPR", "ColBERT", "RAG", "RLHF", "LoRA",
    "chain-of-thought", "few-shot", "reflection tokens", "chunking",
  ],
  task: [
    "question answering", "summarization", "fact verification",
    "open-domain QA", "machine translation",
  ],
};

/** 大小写不敏感词边界匹配（拉丁术语） */
function countMatches(haystackLower: string, term: string): number {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`, "gi");
  return (haystackLower.match(re) ?? []).length;
}

export interface CooccurrenceResult {
  entities: Map<string, GraphEntity>;
  relations: Map<string, GraphRelation>;
  communities: Community[];
}

export function buildCooccurrenceGraph(paperId: string, paperTitle: string, chunks: Chunk[]): CooccurrenceResult {
  const entities = new Map<string, GraphEntity>();
  const relations = new Map<string, GraphRelation>();

  for (const chunk of chunks) {
    const lower = chunk.text.toLowerCase();
    // 本块命中的术语
    const hits: { key: string; name: string; type: EntityType; count: number }[] = [];
    for (const [type, terms] of Object.entries(LEXICON) as [EntityType, string[]][]) {
      for (const term of terms) {
        const c = countMatches(lower, term);
        if (c > 0) {
          const key = term.toLowerCase().replace(/[^a-z0-9]+/g, "-");
          hits.push({ key, name: term, type, count: c });
        }
      }
    }
    if (hits.length === 0) continue;

    // 登记实体与提及
    for (const h of hits) {
      const existing = entities.get(h.key);
      if (existing) {
        const m = existing.mentions.find((m) => m.paperId === paperId);
        if (m) {
          if (!m.chunkIds.includes(chunk.id)) m.chunkIds.push(chunk.id);
          m.count += h.count;
        } else {
          existing.mentions.push({ paperId, chunkIds: [chunk.id], count: h.count });
        }
      } else {
        entities.set(h.key, {
          id: h.key,
          name: h.name,
          type: h.type,
          aliases: [],
          mentions: [{ paperId, chunkIds: [chunk.id], count: h.count }],
          description: "术语共现图谱（降级模式）",
        });
      }
    }

    // 块内共现连边
    for (let i = 0; i < hits.length; i++) {
      for (let j = i + 1; j < hits.length; j++) {
        const a = hits[i].key < hits[j].key ? hits[i] : hits[j];
        const b = hits[i].key < hits[j].key ? hits[j] : hits[i];
        const relId = `${a.key}→co-occurs-with→${b.key}`;
        const evidence = {
          paperId,
          chunkId: chunk.id,
          sentence: chunk.rawText.slice(0, 200),
        };
        const existing = relations.get(relId);
        if (existing) {
          if (existing.evidence.length < 6) existing.evidence.push(evidence);
          existing.weight++;
        } else {
          relations.set(relId, {
            id: relId,
            sourceId: a.key,
            targetId: b.key,
            label: "co-occurs-with",
            evidence: [evidence],
            weight: 1,
          });
        }
      }
    }
  }

  void paperTitle;
  return { entities, relations, communities: [] };
}

/** 在实体+关系映射上跑 Louvain 并回填 communityId（复用抽取模块实现） */
export function assignCommunities(
  entities: Map<string, GraphEntity>,
  relations: Map<string, GraphRelation>
): Community[] {
  const assignment = detectCommunities(entities, relations);
  const byCommunity = new Map<number, string[]>();
  for (const [entityId, cid] of assignment) {
    if (!byCommunity.has(cid)) byCommunity.set(cid, []);
    byCommunity.get(cid)!.push(entityId);
  }
  const communities: Community[] = [];
  for (const [cid, ids] of [...byCommunity.entries()].sort((a, b) => b[1].length - a[1].length)) {
    const members = ids.filter((id) => entities.has(id));
    if (members.length < 2) continue;
    for (const m of members) entities.get(m)!.communityId = communities.length;
    communities.push({
      id: communities.length,
      entityIds: members,
      // 共现模式无 LLM 摘要：用最高频成员名合成主题标签
      summary: `围绕 ${members
        .slice(0, 4)
        .map((id) => entities.get(id)?.name)
        .filter(Boolean)
        .join("、")} 的共现主题群`,
      size: members.length,
    });
  }
  return communities;
}

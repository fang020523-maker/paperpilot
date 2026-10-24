/**
 * 自研 BM25 索引（Okapi BM25, k1=1.5, b=0.75）
 *
 * 中英混合分词策略（面向学术论文文本）：
 * - 英文/数字：小写化、去停用词、保留词干原形
 * - 中文：字符二元组（bigram）——无需分词器即可获得实用的召回
 */

const STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "of", "to", "in", "on", "for", "with", "is", "are",
  "was", "were", "be", "been", "by", "as", "at", "from", "that", "this", "these",
  "those", "it", "its", "we", "our", "they", "their", "which", "who", "whom",
  "can", "could", "will", "would", "should", "may", "might", "shall", "have",
  "has", "had", "do", "does", "did", "not", "no", "but", "if", "then", "than",
  "so", "such", "both", "each", "other", "more", "most", "some", "any", "all",
  "的", "了", "在", "是", "我", "有", "和", "就", "不", "人", "都", "一", "一个",
  "上", "也", "很", "到", "说", "要", "去", "你", "会", "着", "没有", "看", "好",
  "与", "及", "或", "等", "为", "以", "于", "被", "把", "让", "从", "对",
]);

export function tokenize(text: string): string[] {
  const tokens: string[] = [];
  // 1. 英文与数字词
  const words = text.toLowerCase().match(/[a-z][a-z0-9\-_.]{1,30}|\d+(\.\d+)?%?/g) ?? [];
  for (const w of words) {
    if (!STOPWORDS.has(w) && w.length > 1) tokens.push(w);
  }
  // 2. 中文 bigram（连续 CJK 段）
  const cjkRuns = text.match(/[\u4e00-\u9fff]+/g) ?? [];
  for (const run of cjkRuns) {
    if (run.length === 1) {
      tokens.push(run);
    } else {
      for (let i = 0; i < run.length - 1; i++) {
        tokens.push(run.slice(i, i + 2));
      }
    }
  }
  return tokens;
}

interface IndexedDoc {
  id: string;
  tf: Map<string, number>;
  length: number;
}

export class BM25Index {
  private docs = new Map<string, IndexedDoc>();
  private df = new Map<string, number>();
  private totalLen = 0;
  private k1 = 1.5;
  private b = 0.75;

  add(id: string, text: string): void {
    if (this.docs.has(id)) this.remove(id);
    const tokens = tokenize(text);
    const tf = new Map<string, number>();
    for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
    this.docs.set(id, { id, tf, length: tokens.length });
    this.totalLen += tokens.length;
    for (const t of tf.keys()) this.df.set(t, (this.df.get(t) ?? 0) + 1);
  }

  remove(id: string): void {
    const doc = this.docs.get(id);
    if (!doc) return;
    this.totalLen -= doc.length;
    for (const t of doc.tf.keys()) {
      const d = this.df.get(t);
      if (d === undefined) continue;
      if (d <= 1) this.df.delete(t);
      else this.df.set(t, d - 1);
    }
    this.docs.delete(id);
  }

  clear(): void {
    this.docs.clear();
    this.df.clear();
    this.totalLen = 0;
  }

  get size(): number {
    return this.docs.size;
  }

  private idf(term: string): number {
    const n = this.df.get(term) ?? 0;
    const N = this.docs.size;
    return Math.log(1 + (N - n + 0.5) / (n + 0.5));
  }

  search(query: string, topK = 10): { id: string; score: number }[] {
    if (this.docs.size === 0) return [];
    const queryTokens = tokenize(query);
    if (queryTokens.length === 0) return [];
    const avgLen = this.totalLen / this.docs.size;
    const scores: { id: string; score: number }[] = [];

    for (const doc of this.docs.values()) {
      let score = 0;
      for (const t of queryTokens) {
        const f = doc.tf.get(t);
        if (!f) continue;
        const idf = this.idf(t);
        score +=
          (idf * (f * (this.k1 + 1))) /
          (f + this.k1 * (1 - this.b + (this.b * doc.length) / avgLen));
      }
      if (score > 0) scores.push({ id: doc.id, score });
    }
    scores.sort((a, b) => b.score - a.score);
    return scores.slice(0, topK);
  }
}

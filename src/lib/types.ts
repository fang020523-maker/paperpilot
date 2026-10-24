/**
 * PaperPilot 核心领域模型
 * 全系统共享的类型定义：文献、分块、知识图谱、Agent 步骤、评估指标
 */

// ============ 文献库 ============

export type PaperStatus = "processing" | "ready" | "error";

export interface Paper {
  id: string;
  title: string;
  authors: string[];
  year?: number;
  venue?: string;
  arxivId?: string;
  abstract?: string;
  filename: string;
  pageCount: number;
  chunkCount: number;
  status: PaperStatus;
  errorMessage?: string;
  createdAt: string;
  /** 该文献是否来自端侧隐私导入（不出浏览器策略标记） */
  localOnly?: boolean;
}

export interface PaperDetail extends Paper {
  chunkPreview: { id: string; index: number; page: number; text: string }[];
  entityNames: string[];
}

// ============ 分块（Contextual Chunking, Anthropic 2024）============

export interface Chunk {
  id: string;
  paperId: string;
  /** 在文献内的序号 */
  index: number;
  /** PDF 页码（1-based） */
  page: number;
  /** 最近的上文标题（用于引用定位展示） */
  section?: string;
  /** 原始文本 */
  rawText: string;
  /** LLM 生成的上下文前缀：说明该片段在全文中的位置与作用 */
  contextPrefix?: string;
  /** 最终用于嵌入的文本 = contextPrefix + rawText */
  text: string;
  embedding?: number[];
  embeddingSource: "cloud" | "local";
  tokenEstimate: number;
}

// ============ GraphRAG 知识图谱 ============

export type EntityType =
  | "method" // 方法/技术
  | "dataset" // 数据集
  | "metric" // 评价指标
  | "model" // 模型
  | "task" // 任务
  | "finding" // 关键结论
  | "author" // 作者
  | "institution"; // 机构

export const ENTITY_TYPE_META: Record<EntityType, { label: string; color: string }> = {
  method: { label: "方法", color: "#6366f1" },
  dataset: { label: "数据集", color: "#10b981" },
  metric: { label: "指标", color: "#f59e0b" },
  model: { label: "模型", color: "#ec4899" },
  task: { label: "任务", color: "#06b6d4" },
  finding: { label: "结论", color: "#a855f7" },
  author: { label: "作者", color: "#64748b" },
  institution: { label: "机构", color: "#f43f5e" },
};

export interface EntityMention {
  paperId: string;
  chunkIds: string[];
  count: number;
}

export interface GraphEntity {
  /** 规范化名称作为 ID */
  id: string;
  name: string;
  type: EntityType;
  aliases: string[];
  mentions: EntityMention[];
  /** LLM 生成的实体聚合摘要 */
  description?: string;
  /** Louvain 社区检测分配的社区编号 */
  communityId?: number;
}

export interface RelationEvidence {
  paperId: string;
  chunkId: string;
  sentence: string;
}

export interface GraphRelation {
  id: string;
  sourceId: string;
  targetId: string;
  /** 关系谓词，如 evaluated-on / proposes / outperforms / uses */
  label: string;
  evidence: RelationEvidence[];
  weight: number;
}

export interface Community {
  id: number;
  entityIds: string[];
  /** LLM 生成的社区主题摘要（GraphRAG Global Search 的检索单元） */
  summary?: string;
  size: number;
}

// ============ 检索结果 ============

export type RetrievalMethod = "vector" | "bm25" | "hyde" | "multi-query" | "graph-local" | "graph-global";

export interface RetrievedChunk {
  chunk: Chunk;
  paper: Paper;
  score: number;
  method: RetrievalMethod;
  /** 重排序后的名次 */
  rank?: number;
}

export interface GraphContext {
  entities: GraphEntity[];
  relations: GraphRelation[];
  /** 本轮命中的图谱模式：local 邻域子图 / global 社区摘要 */
  mode: "local" | "global";
  communities?: Community[];
}

// ============ Agentic RAG 流水线（前端可视化协议）============
/**
 * 每个工具调用即一个流水线步骤，通过 AI SDK 的 tool-invocation parts
 * 流式推送至前端，渲染为「AI 思考时间线」。
 */

export type QueryComplexity = "simple" | "factual" | "multi-hop" | "global-summary" | "chitchat";

export interface ClassifyStepResult {
  complexity: QueryComplexity;
  reason: string;
  /** Adaptive-RAG 路由到的策略 */
  strategy: "direct-answer" | "single-retrieval" | "iterative-retrieval" | "graph-global" | "graph-local";
}

export interface RewriteStepResult {
  originalQuery: string;
  rewrittenQuery: string;
  multiQueries: string[];
  /** HyDE 假设答案段落（arXiv:2212.10496） */
  hypotheticalAnswer?: string;
}

export interface RetrievalStepResult {
  method: RetrievalMethod[];
  candidates: {
    chunkId: string;
    paperTitle: string;
    page: number;
    preview: string;
    score: number;
  }[];
  fusedBy: "RRF";
}

export interface GradeStepResult {
  /** CRAG 文档级相关性评分 0-10 */
  grades: { chunkId: string; paperTitle: string; score: number; reason: string }[];
  averageScore: number;
  /** 是否触发纠错（低置信度 → 重写再检索） */
  correctiveAction: "accept" | "rewrite" | "fallback-none";
}

export interface GraphSearchStepResult {
  mode: "local" | "global";
  entitiesHit: string[];
  contextSummary: string;
}

export interface SelfAssessStepResult {
  /** Self-RAG 支撑度 0-10 */
  supportScore: number;
  isGrounded: boolean;
  needsMoreRetrieval: boolean;
  verdict: string;
}

// ============ RAGAS 评估（arXiv:2309.15217）============

export interface RagasScores {
  /** 忠实度：答案论断可被上下文支撑的比例 */
  faithfulness: number;
  /** 答案相关性 */
  answerRelevancy: number;
  /** 上下文精确率：检索到的上下文中相关比例 */
  contextPrecision: number;
  /** 上下文召回率 */
  contextRecall: number;
  /** 端到端耗时（毫秒） */
  latencyMs: number;
  /** 本次使用的检索方法组合 */
  methods: string[];
}

export interface EvaluationRecord {
  id: string;
  question: string;
  answerPreview: string;
  scores: RagasScores;
  /** naive = 基线单轮 RAG；agentic = 完整流水线 */
  pipeline: "naive" | "agentic";
  createdAt: string;
}

// ============ Agent 对话消息标注 ============

export interface ChatAnnotation {
  citations?: Citation[];
  ragas?: RagasScores;
}

export interface Citation {
  no: number;
  paperId: string;
  paperTitle: string;
  page: number;
  section?: string;
  chunkId: string;
  /** 引用命中的原文片段 */
  quote: string;
  score: number;
}

// ============ 导入任务（SSE 进度）============

export type IngestEvent =
  | { type: "progress"; stage: string; percent: number; detail?: string }
  | { type: "chunk-done"; count: number; total: number }
  | { type: "graph-done"; entities: number; relations: number }
  | { type: "done"; paperId: string; title: string; chunks: number; entities: number; relations: number }
  | { type: "error"; message: string };

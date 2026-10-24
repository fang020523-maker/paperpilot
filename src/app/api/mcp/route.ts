import { expandQuery, retrieveHybrid } from "@/lib/retrieval/hybrid";
import { graphGlobalSearch, graphLocalSearch } from "@/lib/retrieval/graph-search";
import { getKB } from "@/lib/kb/store";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * MCP (Model Context Protocol) Streamable HTTP 端点
 * 将 PaperPilot 检索能力暴露为标准 MCP 工具，可被 Claude Desktop、
 * 任意 MCP 客户端调用 —— 赛题「MCP/工具集成」评分项。
 *
 * 协议：JSON-RPC 2.0 over HTTP POST
 * 工具：search_papers（混合检索）、get_knowledge_graph（图谱检索）
 */

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

const TOOLS = [
  {
    name: "search_papers",
    description:
      "在学术文献知识库中混合检索（BM25 关键词 + 向量语义 + HyDE，RRF 融合）。返回最相关的论文片段（含标题/页码/章节）。",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "检索查询" },
        topK: { type: "number", description: "返回片段数（默认5）" },
      },
      required: ["query"],
    },
  },
  {
    name: "get_knowledge_graph",
    description:
      "检索知识图谱：mode=local 返回实体 1 跳邻域（多跳关联推理）；mode=global 返回主题社区摘要（领域综述）。",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "实体名或主题" },
        mode: { type: "string", enum: ["local", "global"], description: "默认 local" },
      },
      required: ["query"],
    },
  },
];

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  const kb = getKB();
  await kb.ensureLoaded();

  if (name === "search_papers") {
    const query = String(args.query ?? "");
    const topK = Math.min(Number(args.topK ?? 5) || 5, 10);
    if (!query) return { error: "query required" };
    const expansion = await expandQuery(query).catch(() => ({
      originalQuery: query,
      rewrittenQuery: query,
      multiQueries: [],
      hypotheticalAnswer: undefined,
    }));
    const results = await retrieveHybrid(expansion, { topK });
    return {
      query: expansion.rewrittenQuery,
      results: results.slice(0, topK).map((r, i) => ({
        rank: i + 1,
        paper: r.paper.title,
        authors: r.paper.authors.slice(0, 3),
        year: r.paper.year,
        page: r.chunk.page,
        section: r.chunk.section,
        method: r.method,
        text: r.chunk.rawText.slice(0, 600),
      })),
      knowledgeBase: { papers: kb.papers.size, chunks: kb.chunks.size },
    };
  }

  if (name === "get_knowledge_graph") {
    const query = String(args.query ?? "");
    const mode = args.mode === "global" ? "global" : "local";
    const ctx = mode === "local" ? graphLocalSearch(query) : graphGlobalSearch(query);
    return {
      mode,
      entities: ctx.entities.slice(0, 15).map((e) => ({
        name: e.name,
        type: e.type,
        mentionedByPapers: e.mentions.length,
      })),
      relations: ctx.relations.slice(0, 15).map((r) => ({
        source: r.sourceId,
        relation: r.label,
        target: r.targetId,
        evidenceCount: r.evidence.length,
      })),
      communities: ctx.communities?.map((c) => ({ size: c.size, summary: c.summary })) ?? [],
    };
  }

  throw new Error(`Unknown tool: ${name}`);
}

export async function POST(req: Request) {
  let rpc: JsonRpcRequest;
  try {
    rpc = (await req.json()) as JsonRpcRequest;
  } catch {
    return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, { status: 400 });
  }

  const ok = (result: unknown) =>
    Response.json({ jsonrpc: "2.0", id: rpc.id ?? null, result }, { headers: { "MCP-Session-Id": "paperpilot" } });

  // 通知（无 id）→ 204
  if (rpc.id === undefined || rpc.id === null) {
    return new Response(null, { status: 204 });
  }

  switch (rpc.method) {
    case "initialize":
      return ok({
        protocolVersion: "2025-03-26",
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "paperpilot", version: "1.0.0", title: "PaperPilot 学术文献检索 MCP" },
      });
    case "ping":
      return ok({});
    case "tools/list":
      return ok({ tools: TOOLS });
    case "tools/call": {
      const name = String((rpc.params as { name?: string })?.name ?? "");
      const args = ((rpc.params as { arguments?: Record<string, unknown> })?.arguments ?? {}) as Record<string, unknown>;
      try {
        const result = await callTool(name, args);
        return ok({
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          structuredContent: result,
        });
      } catch (err) {
        return Response.json(
          {
            jsonrpc: "2.0",
            id: rpc.id,
            error: { code: -32000, message: err instanceof Error ? err.message : "tool error" },
          },
          { headers: { "MCP-Session-Id": "paperpilot" } }
        );
      }
    }
    default:
      return Response.json(
        { jsonrpc: "2.0", id: rpc.id, error: { code: -32601, message: `Method not found: ${rpc.method}` } },
        { status: 404 }
      );
  }
}

export async function GET() {
  return Response.json(
    {
      server: "paperpilot-mcp",
      transport: "streamable-http (JSON-RPC POST only)",
      tools: TOOLS.map((t) => t.name),
    },
    { status: 405 }
  );
}

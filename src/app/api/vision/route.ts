import { zhipuKey } from "@/lib/llm";

export const maxDuration = 120;

const ZHIPU_BASE = "https://open.bigmodel.cn/api/paas/v4";

/**
 * POST /api/vision — GLM-4V 论文图表理解（多模态增强）
 * Body: { images: { page: number; dataUrl: string }[], paperTitle: string }
 * 返回每页的图表解读；纯文本页返回空 description。
 */
export async function POST(req: Request) {
  const key = zhipuKey();
  if (!key) {
    return Response.json(
      { error: "图表理解需要智谱 API 密钥（GLM-4V）——配置 .env.local 后可用" },
      { status: 503 }
    );
  }
  const body = (await req.json()) as {
    images: { page: number; dataUrl: string }[];
    paperTitle: string;
  };
  const images = (body.images ?? []).slice(0, 10);
  if (images.length === 0) return Response.json({ descriptions: [] });

  const results = await Promise.all(
    images.map(async (img) => {
      try {
        const res = await fetch(`${ZHIPU_BASE}/chat/completions`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
          body: JSON.stringify({
            model: "glm-4v-flash",
            messages: [
              {
                role: "user",
                content: [
                  { type: "image_url", image_url: { url: img.dataUrl } },
                  {
                    type: "text",
                    text: `这是论文《${body.paperTitle}》第 ${img.page} 页。若该页包含实验图表/曲线图/表格/架构图，请用中文详细解读其内容（图表类型、对比对象、关键数字与结论，150字内）；若该页是纯文本（无图表），只输出 NO_FIGURE。`,
                  },
                ],
              },
            ],
          }),
        });
        if (!res.ok) return { page: img.page, description: "" };
        const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
        const text = json.choices?.[0]?.message?.content?.trim() ?? "";
        const description = text.includes("NO_FIGURE") ? "" : text.slice(0, 500);
        return { page: img.page, description };
      } catch {
        return { page: img.page, description: "" };
      }
    })
  );

  return Response.json({ descriptions: results.filter((r) => r.description) });
}

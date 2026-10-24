"use client";

import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { ENTITY_TYPE_META, type EntityType, type Paper } from "@/lib/types";

interface DetailResponse {
  paper: Paper;
  chunkPreview: { id: string; index: number; page: number; text: string }[];
  entities: { name: string; type: EntityType }[];
}

export function PaperDetailSheet({
  paperId,
  onClose,
}: {
  paperId: string | null;
  onClose: () => void;
}) {
  const { data } = useQuery({
    queryKey: ["paper", paperId],
    enabled: !!paperId,
    queryFn: async (): Promise<DetailResponse> => {
      const res = await fetch(`/api/papers/${paperId}`);
      return res.json();
    },
  });

  return (
    <Sheet open={!!paperId} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto thin-scrollbar">
        {!data ? (
          <div className="space-y-4 pt-8">
            <Skeleton className="h-8 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-32 w-full" />
          </div>
        ) : (
          <>
            <SheetHeader>
              <SheetTitle className="text-left leading-snug">{data.paper.title}</SheetTitle>
              <div className="text-left text-xs text-muted-foreground">
                {data.paper.authors.join(", ") || "未知作者"}
              </div>
              <div className="flex flex-wrap gap-1.5 pt-1">
                {data.paper.year && <Badge variant="secondary">{data.paper.year}</Badge>}
                {data.paper.venue && <Badge variant="secondary">{data.paper.venue}</Badge>}
                <Badge variant="secondary">{data.paper.pageCount} 页</Badge>
                <Badge variant="secondary">{data.paper.chunkCount} 分块</Badge>
              </div>
            </SheetHeader>

            {data.paper.abstract && (
              <section className="mt-5">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  摘要
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-foreground/90">
                  {data.paper.abstract}
                </p>
              </section>
            )}

            {data.entities.length > 0 && (
              <section className="mt-6">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  关联实体（知识图谱）
                </h3>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {data.entities.map((e) => (
                    <span
                      key={e.name}
                      className="rounded-full border px-2.5 py-0.5 text-xs"
                      style={{
                        borderColor: `${ENTITY_TYPE_META[e.type]?.color ?? "#888"}55`,
                        color: ENTITY_TYPE_META[e.type]?.color ?? "#aaa",
                        background: `${ENTITY_TYPE_META[e.type]?.color ?? "#888"}14`,
                      }}
                    >
                      {e.name}
                    </span>
                  ))}
                </div>
              </section>
            )}

            <Separator className="my-6" />

            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                分块预览（前 {data.chunkPreview.length} 块）
              </h3>
              <div className="mt-3 space-y-2.5">
                {data.chunkPreview.map((c) => (
                  <div key={c.id} className="rounded-lg border bg-muted/30 p-3">
                    <div className="mb-1 flex items-center gap-2 text-[10px] text-muted-foreground font-mono">
                      <Badge variant="outline" className="h-4 px-1.5 text-[9px]">
                        #{c.index}
                      </Badge>
                      P{c.page}
                    </div>
                    <p className="line-clamp-3 text-xs leading-relaxed text-foreground/80">
                      {c.text}…
                    </p>
                  </div>
                ))}
              </div>
            </section>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createIndexerService } from "@/lib/indexer/factory";

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { taskId } = await request.json();

  if (!taskId) {
    return NextResponse.json({ error: "taskId is required" }, { status: 400 });
  }

  try {
    const indexer = createIndexerService();
    const links = await indexer.getTaskLinks(taskId);

    const now = new Date().toISOString();
    let updated = 0;

    for (const link of links) {
      if (link.status === "pending") continue;

      const { error } = await supabase
        .from("site_pages")
        .update({
          index_status: link.status,
          last_checked_at: now,
        })
        .eq("url", link.url)
        .eq("checker_task_id", taskId);

      if (!error) updated++;
    }

    return NextResponse.json({
      taskId,
      totalLinks: links.length,
      updated,
      indexed: links.filter((l) => l.status === "indexed").length,
      notIndexed: links.filter((l) => l.status === "not_indexed").length,
      pending: links.filter((l) => l.status === "pending").length,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to get results" },
      { status: 500 },
    );
  }
}

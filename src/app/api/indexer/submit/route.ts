import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createIndexerService } from "@/lib/indexer/factory";

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { urls } = await request.json();

  if (!urls || !Array.isArray(urls) || urls.length === 0) {
    return NextResponse.json({ error: "urls array required" }, { status: 400 });
  }

  try {
    const indexer = createIndexerService();
    const { taskId } = await indexer.submitUrls(urls);

    // Store task in database
    await supabase.from("indexer_tasks").insert({
      task_id: taskId,
      urls,
      status: "pending",
    });

    // Update deindexed_urls status
    await supabase
      .from("deindexed_urls")
      .update({ status: "reindex_submitted", indexer_task_id: taskId })
      .in("url", urls)
      .eq("status", "detected");

    // Log API usage
    await supabase.from("api_usage_log").insert({
      user_id: user.id,
      service: "rapid_indexer",
      endpoint: "create_task",
      credits_used: urls.length,
      cost_usd: 0,
    });

    return NextResponse.json({ taskId, submitted: urls.length });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to submit" },
      { status: 500 }
    );
  }
}

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { gscClient } from "@/lib/google/search-console";
import { RapidIndexerService } from "@/lib/indexer/rapid-indexer";

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();

  if (!body.urls || !Array.isArray(body.urls) || body.urls.length === 0) {
    return NextResponse.json({ error: "urls array required" }, { status: 400 });
  }

  // Deduplicate URLs
  const urls = [...new Set(body.urls as string[])];

  const admin = createAdminClient();

  const results: {
    google: { submitted: number; failed: number; errors: string[] } | null;
    rapid: { taskId: string; submitted: number } | null;
  } = { google: null, rapid: null };

  // 1. Google Indexing API
  if (gscClient.isConfigured()) {
    try {
      const googleResult = await gscClient.notifyUrlUpdateBatch(urls);
      results.google = googleResult;

      await admin.from("api_usage_log").insert({
        user_id: user.id,
        service: "google_indexing",
        endpoint: "indexing/v3/urlNotifications:publish",
        credits_used: googleResult.submitted,
        cost_usd: 0,
      });
    } catch (err) {
      results.google = {
        submitted: 0,
        failed: urls.length,
        errors: [err instanceof Error ? err.message : "Google Indexing failed"],
      };
    }
  }

  // 2. Rapid Indexer (in parallel)
  try {
    const rapidIndexer = new RapidIndexerService();
    const { taskId } = await rapidIndexer.submitUrls(urls);
    results.rapid = { taskId, submitted: urls.length };

    await admin.from("indexer_tasks").insert({
      task_id: taskId,
      urls,
      status: "pending",
    });

    await admin.from("api_usage_log").insert({
      user_id: user.id,
      service: "rapid_indexer",
      endpoint: "create_task",
      credits_used: urls.length,
      cost_usd: 0,
    });
  } catch (err) {
    results.rapid = null;
  }

  // Update statuses
  await admin
    .from("deindexed_urls")
    .update({
      status: "reindex_submitted",
      indexer_task_id: results.rapid?.taskId ?? null,
    })
    .in("url", urls)
    .eq("status", "detected");

  await admin
    .from("site_pages")
    .update({ index_status: "reindex_submitted" })
    .in("url", urls)
    .eq("index_status", "not_indexed");

  const totalSubmitted = Math.max(
    results.google?.submitted ?? 0,
    results.rapid?.submitted ?? 0
  );

  return NextResponse.json({
    submitted: totalSubmitted,
    google: results.google,
    rapid: results.rapid,
  });
}

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { DataForSeoClient } from "@/lib/dataforseo/client";
import { createIndexerService } from "@/lib/indexer/factory";

export const maxDuration = 60; // Allow up to 60s for this route

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { siteIds } = await request.json();

  // Fetch all keywords grouped by unique (keyword, location_code) for deduplication
  let query = supabase
    .from("keywords")
    .select("id, keyword, location_code, site_id, sites(domain), locations(default_language)");

  if (siteIds && Array.isArray(siteIds) && siteIds.length > 0) {
    query = query.in("site_id", siteIds);
  }

  const { data: keywords, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!keywords || keywords.length === 0) {
    return NextResponse.json({ message: "No keywords to check" });
  }

  // Deduplicate: group by (keyword + location_code)
  const deduped = new Map<string, {
    keyword: string;
    locationCode: number;
    language: string;
    entries: Array<{ keywordId: string; siteId: string; domain: string }>;
  }>();

  keywords.forEach((kw) => {
    const key = `${kw.keyword}::${kw.location_code}`;
    const loc = kw.locations as unknown as { default_language: string };
    const site = kw.sites as unknown as { domain: string };

    if (!deduped.has(key)) {
      deduped.set(key, {
        keyword: kw.keyword,
        locationCode: kw.location_code,
        language: loc?.default_language ?? "en",
        entries: [],
      });
    }
    deduped.get(key)!.entries.push({
      keywordId: kw.id,
      siteId: kw.site_id,
      domain: site?.domain ?? "",
    });
  });

  const dataforseo = new DataForSeoClient();
  const dedupedArray = Array.from(deduped.entries());
  let totalApiCalls = 0;
  const deindexedUrls: Array<{ siteId: string; keywordId: string; url: string }> = [];
  const errors: string[] = [];

  // Use Live endpoint: one call per keyword, results returned immediately
  for (const [, data] of dedupedArray) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const response: any = await dataforseo.getSerpLive(
        data.keyword,
        data.locationCode,
        data.language,
      );
      totalApiCalls++;

      const task = response?.tasks?.[0];
      if (!task || task.status_code !== 20000) {
        errors.push(`${data.keyword}: task error ${task?.status_code} - ${task?.status_message}`);
        continue;
      }

      const items = task.result?.[0]?.items ?? [];

      // For each site tracking this keyword+country, find its position
      for (const entry of data.entries) {
        const domainClean = entry.domain.replace(/^www\./, "").toLowerCase();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const found = items.find((item: any) => {
          if (item.type !== "organic") return false;
          const itemDomain = (item.domain || "").replace(/^www\./, "").toLowerCase();
          return itemDomain === domainClean;
        });

        // Get previous position for deindex detection
        const { data: prevPositions } = await supabase
          .from("keyword_positions")
          .select("position, url_found")
          .eq("keyword_id", entry.keywordId)
          .eq("site_id", entry.siteId)
          .order("checked_at", { ascending: false })
          .limit(1);

        const prevPosition = prevPositions?.[0]?.position ?? null;
        const prevUrl = prevPositions?.[0]?.url_found ?? null;

        const newPosition = found ? found.rank_group : null;
        const newUrl = found ? found.url : null;

        // Insert new position
        await supabase.from("keyword_positions").insert({
          keyword_id: entry.keywordId,
          site_id: entry.siteId,
          position: newPosition,
          url_found: newUrl,
          serp_features: null,
        });

        // Deindex detection: was in top 100, now out
        if (prevPosition !== null && newPosition === null && prevUrl) {
          deindexedUrls.push({
            siteId: entry.siteId,
            keywordId: entry.keywordId,
            url: prevUrl,
          });
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${data.keyword}: ${msg}`);
      console.error(`DataForSEO error for "${data.keyword}":`, err);
    }
  }

  // Handle deindexed URLs: insert + auto-submit to Rapid Indexer
  if (deindexedUrls.length > 0) {
    await supabase.from("deindexed_urls").insert(
      deindexedUrls.map((d) => ({
        site_id: d.siteId,
        keyword_id: d.keywordId,
        url: d.url,
        status: "detected" as const,
      }))
    );

    await supabase.from("alerts").insert(
      deindexedUrls.map((d) => ({
        site_id: d.siteId,
        alert_type: "deindex" as const,
        severity: "critical" as const,
        message: `URL deindexed: ${d.url}`,
      }))
    );

    try {
      const indexer = createIndexerService();
      const urls = [...new Set(deindexedUrls.map((d) => d.url))];
      const { taskId } = await indexer.submitUrls(urls);

      await supabase.from("indexer_tasks").insert({
        task_id: taskId,
        urls,
        status: "pending",
      });

      await supabase
        .from("deindexed_urls")
        .update({ status: "reindex_submitted", indexer_task_id: taskId })
        .in("url", urls)
        .eq("status", "detected");
    } catch (err) {
      console.error("Rapid Indexer auto-submit error:", err);
    }
  }

  // Log API usage
  if (totalApiCalls > 0) {
    await supabase.from("api_usage_log").insert({
      user_id: user.id,
      service: "dataforseo",
      endpoint: "serp/google/organic/live",
      credits_used: totalApiCalls,
      cost_usd: totalApiCalls * 0.002, // live endpoint costs $0.002 per task
    });
  }

  return NextResponse.json({
    checked: dedupedArray.length,
    totalKeywords: keywords.length,
    deduplicated: keywords.length - dedupedArray.length,
    deindexed: deindexedUrls.length,
    apiCalls: totalApiCalls,
    errors: errors.length > 0 ? errors : undefined,
  });
}

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { discoverSitemapUrls } from "@/lib/sitemap/parser";
import { extractSlugFromUrl, slugToKeyword } from "@/lib/sitemap/slug";
import { DataForSeoClient } from "@/lib/dataforseo/client";
import { createIndexerService } from "@/lib/indexer/factory";

export const maxDuration = 300; // 5 minutes

export async function GET(request: Request) {
  // Verify cron secret
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();

  // Get all active sites
  const { data: sites } = await supabase
    .from("sites")
    .select("id, domain, location_code, locations(default_language)")
    .eq("is_active", true);

  if (!sites || sites.length === 0) {
    return NextResponse.json({ message: "No active sites" });
  }

  const dataforseo = new DataForSeoClient();
  let totalApiCalls = 0;
  let totalIndexed = 0;
  let totalNotIndexed = 0;
  const notIndexedUrls: Array<{ siteId: string; url: string }> = [];

  for (const site of sites) {
    try {
      // Discover sitemap URLs
      const urls = await discoverSitemapUrls(site.domain);
      if (urls.length === 0) continue;

      // Upsert into site_pages
      const toUpsert = urls.map((url) => ({
        site_id: site.id,
        url,
        source: "sitemap",
      }));

      for (let i = 0; i < toUpsert.length; i += 500) {
        await supabase
          .from("site_pages")
          .upsert(toUpsert.slice(i, i + 500), {
            onConflict: "site_id,url",
            ignoreDuplicates: true,
          });
      }

      const loc = site.locations as unknown as { default_language: string } | null;
      const locationCode = site.location_code ?? 2840;
      const language = loc?.default_language ?? "en";

      // Check each URL via DataForSEO site: query
      for (const url of urls) {
        const slug = extractSlugFromUrl(url);
        if (!slug) continue;

        const keyword = slugToKeyword(slug);

        try {
          const result = await dataforseo.checkIndexation(
            site.domain,
            keyword,
            slug,
            locationCode,
            language,
          );
          totalApiCalls++;

          const now = new Date().toISOString();
          if (result.indexed) {
            totalIndexed++;
            await supabase
              .from("site_pages")
              .update({ index_status: "indexed", last_checked_at: now })
              .eq("site_id", site.id)
              .eq("url", url);
          } else {
            totalNotIndexed++;
            await supabase
              .from("site_pages")
              .update({ index_status: "not_indexed", last_checked_at: now })
              .eq("site_id", site.id)
              .eq("url", url);

            notIndexedUrls.push({ siteId: site.id, url });
          }
        } catch (err) {
          console.error(`[CRON-INDEX] Error checking ${url}:`, err);
        }
      }
    } catch (err) {
      console.error(`[CRON-INDEX] Error processing site ${site.domain}:`, err);
    }
  }

  // Auto-submit not-indexed URLs to Rapid Indexer for reindexation
  if (notIndexedUrls.length > 0) {
    try {
      const indexer = createIndexerService();
      const urls = notIndexedUrls.map((n) => n.url);
      const { taskId } = await indexer.submitUrls(urls);

      await supabase.from("indexer_tasks").insert({
        task_id: taskId,
        urls,
        status: "pending",
      });

      console.log(`[CRON-INDEX] Auto-submitted ${urls.length} not-indexed URLs to Rapid Indexer (task ${taskId})`);
    } catch (err) {
      console.error("[CRON-INDEX] Rapid Indexer auto-submit error:", err);
    }
  }

  // Log API usage
  if (totalApiCalls > 0) {
    const { data: anySite } = await supabase
      .from("sites")
      .select("user_id")
      .limit(1)
      .single();

    if (anySite?.user_id) {
      await supabase.from("api_usage_log").insert({
        user_id: anySite.user_id,
        service: "dataforseo",
        endpoint: "serp/google/organic/live (cron index check)",
        credits_used: totalApiCalls,
        cost_usd: totalApiCalls * 0.002,
      });
    }
  }

  console.log(`[CRON-INDEX] Complete: ${sites.length} sites, ${totalApiCalls} API calls, ${totalIndexed} indexed, ${totalNotIndexed} not indexed`);

  return NextResponse.json({
    sites: sites.length,
    apiCalls: totalApiCalls,
    indexed: totalIndexed,
    notIndexed: totalNotIndexed,
    autoReindexed: notIndexedUrls.length,
  });
}

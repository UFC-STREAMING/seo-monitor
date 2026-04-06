import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { discoverSitemapUrls } from "@/lib/sitemap/parser";
import { gscClient } from "@/lib/google/search-console";
import { RapidIndexerService } from "@/lib/indexer/rapid-indexer";

export const maxDuration = 300; // 5 minutes

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();

  // Get all active sites with their GSC properties
  const { data: sites } = await supabase
    .from("sites")
    .select("id, domain, gsc_properties(id)")
    .eq("is_active", true);

  if (!sites || sites.length === 0) {
    return NextResponse.json({ message: "No active sites" });
  }

  let totalIndexed = 0;
  let totalNotIndexed = 0;
  const notIndexedUrls: Array<{ siteId: string; url: string }> = [];

  for (const site of sites) {
    try {
      // Get linked GSC property
      const gscProps = site.gsc_properties as unknown as Array<{ id: string }> | null;
      const gscPropertyId = gscProps?.[0]?.id;

      if (!gscPropertyId) {
        console.log(`[CRON-INDEX] No GSC property linked for ${site.domain}, skipping`);
        continue;
      }

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

      // Get pages that appear in GSC (last 30 days = indexed)
      const sinceDate = new Date();
      sinceDate.setDate(sinceDate.getDate() - 30);
      const dateStr = sinceDate.toISOString().split("T")[0];

      const { data: gscPages } = await supabase
        .from("gsc_search_data")
        .select("page")
        .eq("gsc_property_id", gscPropertyId)
        .gte("date", dateStr)
        .gt("impressions", 0)
        .not("page", "is", null);

      const indexedPages = new Set(
        (gscPages ?? []).filter((p: { page: string | null }) => p.page !== null).map((p: { page: string | null }) => p.page as string)
      );

      const now = new Date().toISOString();

      // Cross-reference sitemap URLs with GSC pages
      for (const url of urls) {
        const isIndexed = indexedPages.has(url);

        if (isIndexed) {
          totalIndexed++;
          await supabase
            .from("site_pages")
            .update({
              index_status: "indexed",
              last_checked_at: now,
              indexed_at: now,
            })
            .eq("site_id", site.id)
            .eq("url", url);
        } else {
          totalNotIndexed++;
          await supabase
            .from("site_pages")
            .update({
              index_status: "not_indexed",
              last_checked_at: now,
            })
            .eq("site_id", site.id)
            .eq("url", url);

          notIndexedUrls.push({ siteId: site.id, url });
        }
      }
    } catch (err) {
      console.error(`[CRON-INDEX] Error processing site ${site.domain}:`, err);
    }
  }

  // Auto-submit not-indexed URLs via Google Indexing API + Rapid Indexer
  let googleReindexed = 0;
  let rapidReindexed = 0;

  if (notIndexedUrls.length > 0) {
    const urls = notIndexedUrls.map((n) => n.url);

    // 1. Google Indexing API (limit 200/day)
    if (gscClient.isConfigured()) {
      const batch = urls.slice(0, 200);
      const result = await gscClient.notifyUrlUpdateBatch(batch);
      googleReindexed = result.submitted;
      if (result.errors.length > 0) {
        console.error("[CRON-INDEX] Google Indexing errors:", result.errors);
      }
    }

    // 2. Rapid Indexer (all URLs, no daily limit)
    try {
      const rapidIndexer = new RapidIndexerService();
      const { taskId } = await rapidIndexer.submitUrls(urls);
      rapidReindexed = urls.length;

      await supabase.from("indexer_tasks").insert({
        task_id: taskId,
        urls,
        status: "pending",
      });
    } catch (err) {
      console.error("[CRON-INDEX] Rapid Indexer error:", err);
    }

    // Update status for all not-indexed URLs
    const now = new Date().toISOString();
    for (const entry of notIndexedUrls) {
      await supabase
        .from("site_pages")
        .update({
          index_status: "reindex_submitted",
          submitted_at: now,
        })
        .eq("site_id", entry.siteId)
        .eq("url", entry.url);
    }
  }

  console.log(
    `[CRON-INDEX] Complete: ${sites.length} sites, ${totalIndexed} indexed, ${totalNotIndexed} not indexed (GSC-based, $0 cost)`
  );

  return NextResponse.json({
    sites: sites.length,
    indexed: totalIndexed,
    notIndexed: totalNotIndexed,
    googleReindexed,
    rapidReindexed,
  });
}

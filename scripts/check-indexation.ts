// ---------------------------------------------------------------------------
// Standalone script: Check URL indexation via GSC data + auto-reindex
// Run: npx tsx --env-file=.env scripts/check-indexation.ts
// ---------------------------------------------------------------------------

import { createAdminClient } from "@/lib/supabase/admin";
import { discoverSitemapUrls } from "@/lib/sitemap/parser";
import { gscClient } from "@/lib/google/search-console";
import { RapidIndexerService } from "@/lib/indexer/rapid-indexer";

async function main() {
  console.log("[CHECK-INDEXATION] Starting (GSC-based)...");
  const startTime = Date.now();

  const supabase = createAdminClient();

  // Get all active sites with GSC properties
  const { data: sites } = await supabase
    .from("sites")
    .select("id, domain, user_id, gsc_properties(id)")
    .eq("is_active", true);

  if (!sites || sites.length === 0) {
    console.log("[CHECK-INDEXATION] No active sites");
    process.exit(0);
  }

  console.log(`[CHECK-INDEXATION] Processing ${sites.length} sites...`);

  let totalIndexed = 0;
  let totalNotIndexed = 0;
  const notIndexedUrls: Array<{ siteId: string; url: string }> = [];

  for (const site of sites) {
    try {
      // Get linked GSC property
      const gscProps = site.gsc_properties as unknown as Array<{ id: string }> | null;
      const gscPropertyId = gscProps?.[0]?.id;

      if (!gscPropertyId) {
        console.log(`[CHECK-INDEXATION] ${site.domain}: no GSC property, skipping`);
        continue;
      }

      // Discover sitemap URLs
      const urls = await discoverSitemapUrls(site.domain);
      if (urls.length === 0) {
        console.log(`[CHECK-INDEXATION] ${site.domain}: no sitemap URLs found`);
        continue;
      }

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
      let siteIndexed = 0;
      let siteNotIndexed = 0;

      for (const url of urls) {
        if (indexedPages.has(url)) {
          siteIndexed++;
          totalIndexed++;
          await supabase
            .from("site_pages")
            .update({ index_status: "indexed", last_checked_at: now, indexed_at: now })
            .eq("site_id", site.id)
            .eq("url", url);
        } else {
          siteNotIndexed++;
          totalNotIndexed++;
          await supabase
            .from("site_pages")
            .update({ index_status: "not_indexed", last_checked_at: now })
            .eq("site_id", site.id)
            .eq("url", url);

          notIndexedUrls.push({ siteId: site.id, url });
        }
      }

      console.log(
        `[CHECK-INDEXATION] ${site.domain}: ${urls.length} URLs, ${siteIndexed} indexed, ${siteNotIndexed} not indexed`
      );
    } catch (err) {
      console.error(`[CHECK-INDEXATION] Error processing site ${site.domain}:`, err);
    }
  }

  // Auto-submit not-indexed URLs
  let googleReindexed = 0;
  let rapidReindexed = 0;

  if (notIndexedUrls.length > 0) {
    const urls = [...new Set(notIndexedUrls.map((n) => n.url))];
    console.log(`[CHECK-INDEXATION] ${urls.length} unique not-indexed URLs to reindex`);

    // Google Indexing API (limit 200/day)
    if (gscClient.isConfigured()) {
      const batch = urls.slice(0, 200);
      console.log(`[CHECK-INDEXATION] Submitting ${batch.length} URLs to Google Indexing API...`);
      const result = await gscClient.notifyUrlUpdateBatch(batch);
      googleReindexed = result.submitted;
    }

    // Rapid Indexer
    try {
      const rapidIndexer = new RapidIndexerService();
      const { taskId } = await rapidIndexer.submitUrls(urls);
      rapidReindexed = urls.length;

      await supabase.from("indexer_tasks").insert({
        task_id: taskId,
        urls,
        status: "pending",
      });

      console.log(`[CHECK-INDEXATION] Submitted ${urls.length} URLs to Rapid Indexer (task ${taskId})`);
    } catch (err) {
      console.error("[CHECK-INDEXATION] Rapid Indexer error:", err);
    }

    // Update status
    const now = new Date().toISOString();
    for (const entry of notIndexedUrls) {
      await supabase
        .from("site_pages")
        .update({ index_status: "reindex_submitted", submitted_at: now })
        .eq("site_id", entry.siteId)
        .eq("url", entry.url);
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(
    `[CHECK-INDEXATION] Complete in ${elapsed}s: ${sites.length} sites, ${totalIndexed} indexed, ${totalNotIndexed} not indexed, ${googleReindexed} Google reindexed, ${rapidReindexed} Rapid reindexed ($0 API cost)`
  );

  process.exit(0);
}

main().catch((err) => {
  console.error("[CHECK-INDEXATION] Fatal error:", err);
  process.exit(1);
});

// ---------------------------------------------------------------------------
// Standalone script: Check URL indexation via DataForSEO + auto-reindex
// Run: npx tsx --env-file=.env scripts/check-indexation.ts
// ---------------------------------------------------------------------------

import { createAdminClient } from "@/lib/supabase/admin";
import { discoverSitemapUrls } from "@/lib/sitemap/parser";
import { extractSlugFromUrl, slugToKeyword } from "@/lib/sitemap/slug";
import { DataForSeoClient } from "@/lib/dataforseo/client";
import { gscClient } from "@/lib/google/search-console";
import { RapidIndexerService } from "@/lib/indexer/rapid-indexer";

async function main() {
  console.log("[CHECK-INDEXATION] Starting...");
  const startTime = Date.now();

  const supabase = createAdminClient();

  // Get all active sites
  const { data: sites } = await supabase
    .from("sites")
    .select("id, domain, user_id, location_code, locations(default_language)")
    .eq("is_active", true);

  if (!sites || sites.length === 0) {
    console.log("[CHECK-INDEXATION] No active sites");
    process.exit(0);
  }

  console.log(`[CHECK-INDEXATION] Processing ${sites.length} sites...`);

  const dataforseo = new DataForSeoClient();
  let totalApiCalls = 0;
  let totalIndexed = 0;
  let totalNotIndexed = 0;
  const notIndexedUrls: Array<{ siteId: string; url: string }> = [];

  for (const site of sites) {
    try {
      // Discover sitemap URLs
      const urls = await discoverSitemapUrls(site.domain);
      if (urls.length === 0) {
        console.log(`[CHECK-INDEXATION] ${site.domain}: no sitemap URLs found`);
        continue;
      }

      // Get URLs already covered by tracked keywords (check-positions handles those)
      const { data: kwPositions } = await supabase
        .from("keyword_positions")
        .select("url_found")
        .eq("site_id", site.id)
        .not("url_found", "is", null);

      const coveredUrls = new Set(
        (kwPositions ?? []).map((p) => p.url_found).filter(Boolean)
      );

      // Also match by keyword slug → URL slug
      const { data: siteKeywords } = await supabase
        .from("keywords")
        .select("keyword")
        .eq("site_id", site.id);

      const kwSlugs = new Set(
        (siteKeywords ?? []).map((k) =>
          k.keyword.toLowerCase().replace(/\s+/g, "-")
        )
      );

      const filteredUrls = urls.filter((url) => {
        // Skip if already checked via check-positions
        if (coveredUrls.has(url)) return false;
        // Skip if URL slug matches a tracked keyword
        const slug = extractSlugFromUrl(url).toLowerCase();
        if (slug && kwSlugs.has(slug)) return false;
        return true;
      });

      console.log(
        `[CHECK-INDEXATION] ${site.domain}: ${urls.length} sitemap URLs, ${urls.length - filteredUrls.length} covered by keywords, ${filteredUrls.length} to check`
      );

      // Upsert ALL sitemap URLs into site_pages (for reference)
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

      const loc = site.locations as unknown as {
        default_language: string;
      } | null;
      const locationCode = site.location_code ?? 2840;
      const language = loc?.default_language ?? "en";

      // Check only non-keyword-covered URLs via DataForSEO
      let siteChecked = 0;
      for (const url of filteredUrls) {
        const slug = extractSlugFromUrl(url);
        if (!slug) continue;

        const keyword = slugToKeyword(slug);

        try {
          const result = await dataforseo.checkIndexation(
            site.domain,
            keyword,
            slug,
            locationCode,
            language
          );
          totalApiCalls++;
          siteChecked++;

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

          // Progress log every 20 URLs
          if (siteChecked % 20 === 0) {
            console.log(
              `[CHECK-INDEXATION] ${site.domain}: ${siteChecked}/${urls.length} checked`
            );
          }
        } catch (err) {
          console.error(`[CHECK-INDEXATION] Error checking ${url}:`, err);
        }
      }

      console.log(
        `[CHECK-INDEXATION] ${site.domain}: done (${siteChecked} checked)`
      );
    } catch (err) {
      console.error(
        `[CHECK-INDEXATION] Error processing site ${site.domain}:`,
        err
      );
    }
  }

  // Auto-submit not-indexed URLs via Google Indexing API + Rapid Indexer
  let googleReindexed = 0;
  let rapidReindexed = 0;

  if (notIndexedUrls.length > 0) {
    const urls = [...new Set(notIndexedUrls.map((n) => n.url))];
    console.log(
      `[CHECK-INDEXATION] ${urls.length} unique not-indexed URLs to reindex`
    );

    // 1. Google Indexing API (limit 200/day)
    if (gscClient.isConfigured()) {
      const batch = urls.slice(0, 200);
      console.log(
        `[CHECK-INDEXATION] Submitting ${batch.length} URLs to Google Indexing API...`
      );
      const result = await gscClient.notifyUrlUpdateBatch(batch);
      googleReindexed = result.submitted;
      if (result.errors.length > 0) {
        console.error(
          "[CHECK-INDEXATION] Google Indexing errors:",
          result.errors
        );
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

      console.log(
        `[CHECK-INDEXATION] Submitted ${urls.length} URLs to Rapid Indexer (task ${taskId})`
      );
    } catch (err) {
      console.error("[CHECK-INDEXATION] Rapid Indexer error:", err);
    }

    // Update status for all not-indexed URLs
    for (const entry of notIndexedUrls) {
      await supabase
        .from("site_pages")
        .update({ index_status: "reindex_submitted" })
        .eq("site_id", entry.siteId)
        .eq("url", entry.url);
    }
  }

  // Log API usage
  if (totalApiCalls > 0) {
    const userId = sites[0]?.user_id;
    if (userId) {
      await supabase.from("api_usage_log").insert({
        user_id: userId,
        service: "dataforseo",
        endpoint: "serp/google/organic/live (check indexation)",
        credits_used: totalApiCalls,
        cost_usd: totalApiCalls * 0.002,
      });
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(
    `[CHECK-INDEXATION] Complete in ${elapsed}s: ${sites.length} sites, ${totalApiCalls} API calls, ${totalIndexed} indexed, ${totalNotIndexed} not indexed, ${googleReindexed} Google reindexed, ${rapidReindexed} Rapid reindexed`
  );

  process.exit(0);
}

main().catch((err) => {
  console.error("[CHECK-INDEXATION] Fatal error:", err);
  process.exit(1);
});

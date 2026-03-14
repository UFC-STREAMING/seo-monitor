import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { gscClient } from "@/lib/google/search-console";
import { RapidIndexerService } from "@/lib/indexer/rapid-indexer";
import { discoverSitemapUrls } from "@/lib/sitemap/parser";

export const maxDuration = 300; // 5 minutes

/**
 * Cron: Reindex product URLs via Google Indexing API.
 * Priority order:
 *   1. Not-indexed URLs linked to tracked keywords (via GSC data or slug match)
 *   2. Not-indexed URLs (no keyword match)
 *   3. Unknown status URLs linked to tracked keywords
 *   4. Remaining URLs
 *
 * Quota: 200 URLs/day per Google Cloud project.
 */
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!gscClient.isConfigured()) {
    return NextResponse.json(
      { error: "Google Service Account not configured" },
      { status: 500 }
    );
  }

  const supabase = createAdminClient();

  // Get all active sites
  const { data: sites } = await supabase
    .from("sites")
    .select("id, domain, user_id")
    .eq("is_active", true);

  if (!sites || sites.length === 0) {
    return NextResponse.json({ message: "No active sites" });
  }

  const siteIds = sites.map((s) => s.id);

  // Get all tracked keywords per site
  const { data: trackedKeywords } = await supabase
    .from("keywords")
    .select("keyword, site_id")
    .in("site_id", siteIds);

  // Build a set of keywords per site for fast lookup
  const keywordsBySite = new Map<string, Set<string>>();
  (trackedKeywords ?? []).forEach((k) => {
    const existing = keywordsBySite.get(k.site_id) ?? new Set();
    existing.add(k.keyword.toLowerCase());
    keywordsBySite.set(k.site_id, existing);
  });

  // Get GSC page→keyword mapping (which pages rank for tracked keywords)
  const trackedKeywordList = (trackedKeywords ?? []).map((k) => k.keyword);
  const keywordPageUrls = new Set<string>();

  if (trackedKeywordList.length > 0) {
    // Get GSC properties linked to these sites
    const { data: gscProps } = await supabase
      .from("gsc_properties")
      .select("id, site_id")
      .in("site_id", siteIds)
      .eq("is_active", true);

    if (gscProps && gscProps.length > 0) {
      const propIds = gscProps.map((p) => p.id);

      // Find pages that rank for tracked keywords (batch query)
      // Use chunks to avoid query limits
      for (let i = 0; i < trackedKeywordList.length; i += 50) {
        const kwBatch = trackedKeywordList.slice(i, i + 50);
        const { data: gscPages } = await supabase
          .from("gsc_search_data")
          .select("page, query")
          .in("gsc_property_id", propIds)
          .in("query", kwBatch)
          .gte("clicks", 1)
          .limit(5000);

        (gscPages ?? []).forEach((row) => {
          if (row.page) keywordPageUrls.add(row.page);
        });
      }
    }
  }

  let totalUrlsDiscovered = 0;
  let totalSubmitted = 0;
  let totalFailed = 0;
  let quotaExceeded = false;
  const allErrors: string[] = [];
  const siteResults: Array<{
    domain: string;
    discovered: number;
    submitted: number;
    failed: number;
  }> = [];

  // Collect all URLs with priority scoring
  const urlsToSubmit: Array<{
    url: string;
    siteId: string;
    domain: string;
    priority: number; // lower = higher priority
  }> = [];

  for (const site of sites) {
    try {
      const urls = await discoverSitemapUrls(site.domain);
      if (urls.length === 0) continue;

      totalUrlsDiscovered += urls.length;

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

      // Get pages status
      const { data: pages } = await supabase
        .from("site_pages")
        .select("url, index_status")
        .eq("site_id", site.id)
        .in("url", urls);

      const pageStatusMap = new Map(
        (pages ?? []).map((p) => [p.url, p.index_status])
      );

      const siteKeywords = keywordsBySite.get(site.id);

      for (const url of urls) {
        const status = pageStatusMap.get(url) ?? "unknown";
        const isNotIndexed = status === "not_indexed" || status === "error";
        const isUnknown = status === "unknown";

        // Check if this URL is linked to a tracked keyword
        const hasTrackedKeyword =
          keywordPageUrls.has(url) || urlMatchesKeyword(url, siteKeywords);

        // Priority scoring (lower = submitted first)
        let priority: number;
        if (isNotIndexed && hasTrackedKeyword) {
          priority = 0; // TOP PRIORITY: not indexed + tracked keyword
        } else if (isNotIndexed) {
          priority = 1; // not indexed, no keyword match
        } else if (isUnknown && hasTrackedKeyword) {
          priority = 2; // unknown status + tracked keyword
        } else if (isUnknown) {
          priority = 3; // unknown status
        } else if (status === "reindex_submitted") {
          priority = 4; // already submitted recently
        } else {
          priority = 5; // indexed — lowest priority
        }

        urlsToSubmit.push({
          url,
          siteId: site.id,
          domain: site.domain,
          priority,
        });
      }
    } catch (err) {
      allErrors.push(
        `${site.domain}: sitemap error - ${err instanceof Error ? err.message : "unknown"}`
      );
    }
  }

  // Sort by priority (lower = first)
  urlsToSubmit.sort((a, b) => a.priority - b.priority);

  // Submit URLs via Google Indexing API (max 200/day quota)
  const DAILY_QUOTA = 200;
  const batch = urlsToSubmit.slice(0, DAILY_QUOTA);
  const skippedDomains = new Set<string>();

  for (const { url, siteId, domain } of batch) {
    if (quotaExceeded) break;
    if (skippedDomains.has(domain)) continue;

    const result = await gscClient.notifyUrlUpdate(url);

    if (result.success) {
      totalSubmitted++;

      await supabase
        .from("site_pages")
        .update({
          index_status: "reindex_submitted",
          last_checked_at: new Date().toISOString(),
        })
        .eq("site_id", siteId)
        .eq("url", url);
    } else {
      totalFailed++;

      if (result.error?.includes("429")) {
        quotaExceeded = true;
        allErrors.push("Google Indexing API quota exceeded — stopping");
      } else if (result.error?.includes("403")) {
        skippedDomains.add(domain);
        allErrors.push(
          `${domain}: permission denied (service account needs Owner role in GSC)`
        );
      } else {
        allErrors.push(`${url}: ${result.error}`);
      }
    }

    // Track per-site results
    const existing = siteResults.find((r) => r.domain === domain);
    if (existing) {
      existing.discovered++;
      if (result.success) existing.submitted++;
      else existing.failed++;
    } else {
      siteResults.push({
        domain,
        discovered: 1,
        submitted: result.success ? 1 : 0,
        failed: result.success ? 0 : 1,
      });
    }

    // 200ms delay between requests
    await new Promise((r) => setTimeout(r, 200));
  }

  // Log Google Indexing API usage
  if (totalSubmitted > 0) {
    const userId = sites[0].user_id;
    await supabase.from("api_usage_log").insert({
      user_id: userId,
      service: "google_indexing",
      endpoint: "indexing/v3/urlNotifications:publish",
      credits_used: totalSubmitted,
      cost_usd: 0,
    });
  }

  // Also submit all URLs via Rapid Indexer (no daily limit)
  let rapidSubmitted = 0;
  const allUrls = urlsToSubmit.map((u) => u.url);
  if (allUrls.length > 0) {
    try {
      const rapidIndexer = new RapidIndexerService();
      const { taskId } = await rapidIndexer.submitUrls(allUrls);
      rapidSubmitted = allUrls.length;

      await supabase.from("indexer_tasks").insert({
        task_id: taskId,
        urls: allUrls,
        status: "pending",
      });

      if (sites[0]?.user_id) {
        await supabase.from("api_usage_log").insert({
          user_id: sites[0].user_id,
          service: "rapid_indexer",
          endpoint: "create_task (cron reindex)",
          credits_used: allUrls.length,
          cost_usd: 0,
        });
      }
    } catch (err) {
      allErrors.push(`Rapid Indexer: ${err instanceof Error ? err.message : "failed"}`);
    }
  }

  // Count priorities in the batch for reporting
  const priorityCounts = {
    not_indexed_with_keyword: urlsToSubmit.filter((u) => u.priority === 0).length,
    not_indexed: urlsToSubmit.filter((u) => u.priority === 1).length,
    unknown_with_keyword: urlsToSubmit.filter((u) => u.priority === 2).length,
    unknown: urlsToSubmit.filter((u) => u.priority === 3).length,
    already_submitted: urlsToSubmit.filter((u) => u.priority === 4).length,
    indexed: urlsToSubmit.filter((u) => u.priority === 5).length,
  };

  return NextResponse.json({
    total_urls_discovered: totalUrlsDiscovered,
    tracked_keywords: trackedKeywordList.length,
    keyword_pages_found: keywordPageUrls.size,
    priority_breakdown: priorityCounts,
    google_submitted: totalSubmitted,
    rapid_submitted: rapidSubmitted,
    total_failed: totalFailed,
    quota_exceeded: quotaExceeded,
    remaining_quota: DAILY_QUOTA - totalSubmitted,
    skipped_domains: [...skippedDomains],
    sites: siteResults,
    errors: allErrors.length > 0 ? allErrors : null,
  });
}

/**
 * Check if a URL's slug matches any tracked keyword.
 * e.g. URL "https://site.com/glucofit/" matches keyword "glucofit"
 */
function urlMatchesKeyword(
  url: string,
  siteKeywords: Set<string> | undefined
): boolean {
  if (!siteKeywords || siteKeywords.size === 0) return false;

  try {
    const { pathname } = new URL(url);
    const slug = pathname
      .replace(/\/$/, "")
      .split("/")
      .pop()
      ?.toLowerCase();
    if (!slug) return false;

    // Direct match: slug === keyword
    if (siteKeywords.has(slug)) return true;

    // Slug contains keyword (e.g. "glucofit-avis" contains "glucofit")
    for (const kw of siteKeywords) {
      if (slug.includes(kw.replace(/\s+/g, "-"))) return true;
    }

    return false;
  } catch {
    return false;
  }
}

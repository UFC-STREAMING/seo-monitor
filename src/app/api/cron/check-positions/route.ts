import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { DataForSeoClient } from "@/lib/dataforseo/client";
import { createIndexerService } from "@/lib/indexer/factory";
import { discoverSitemapUrls } from "@/lib/sitemap/parser";
import { extractSlugFromUrl, slugToKeyword } from "@/lib/sitemap/slug";

export const maxDuration = 300;

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();

  const { data: keywords, error } = await supabase
    .from("keywords")
    .select("id, keyword, location_code, site_id, sites(domain), locations(default_language)");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

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
  // Collect ALL out-of-100 keywords (not just drops)
  const outOf100: Array<{ siteId: string; keywordId: string; domain: string; keyword: string }> = [];
  const errors: string[] = [];

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

      for (const entry of data.entries) {
        const domainClean = entry.domain.replace(/^www\./, "").toLowerCase();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const found = items.find((item: any) => {
          if (item.type !== "organic") return false;
          const itemDomain = (item.domain || "").replace(/^www\./, "").toLowerCase();
          return itemDomain === domainClean;
        });

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

        await supabase.from("keyword_positions").insert({
          keyword_id: entry.keywordId,
          site_id: entry.siteId,
          position: newPosition,
          url_found: newUrl,
          serp_features: null,
        });

        // Classic drop detection (was in top 100, now gone)
        if (prevPosition !== null && newPosition === null && prevUrl) {
          deindexedUrls.push({
            siteId: entry.siteId,
            keywordId: entry.keywordId,
            url: prevUrl,
          });
        }

        // Collect ALL out-of-100 keywords for sitemap matching
        if (newPosition === null) {
          outOf100.push({
            siteId: entry.siteId,
            keywordId: entry.keywordId,
            domain: entry.domain,
            keyword: data.keyword,
          });
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${data.keyword}: ${msg}`);
      console.error(`[CRON] DataForSEO error for "${data.keyword}":`, err);
    }
  }

  // ── Sitemap matching for ALL out-of-100 keywords ──
  // Group by domain to fetch each sitemap only once
  const sitemapUrlsToReindex: string[] = [];
  let sitemapMatched = 0;

  if (outOf100.length > 0) {
    const byDomain = new Map<string, typeof outOf100>();
    for (const entry of outOf100) {
      const arr = byDomain.get(entry.domain) ?? [];
      arr.push(entry);
      byDomain.set(entry.domain, arr);
    }

    for (const [domain, entries] of byDomain) {
      try {
        const sitemapUrls = await discoverSitemapUrls(domain);
        if (sitemapUrls.length === 0) continue;

        // Build a list of { slug, url } for contains-matching
        const sitemapEntries = sitemapUrls.map((url) => ({
          slug: extractSlugFromUrl(url).toLowerCase(),
          url,
        })).filter((e) => e.slug);

        for (const entry of entries) {
          // Convert keyword to slug form: "oreiller derila ergo" → "oreiller-derila-ergo"
          const kwSlug = entry.keyword.toLowerCase().replace(/\s+/g, "-");
          // Match any sitemap URL whose slug CONTAINS the keyword slug
          // e.g. "oreiller-derila-ergo" matches "oreiller-derila-ergo-avis"
          const matched = sitemapEntries.find((e) => e.slug.includes(kwSlug));
          const matchedUrl = matched?.url;

          if (matchedUrl) {
            sitemapMatched++;
            sitemapUrlsToReindex.push(matchedUrl);

            // Upsert into site_pages as not_indexed
            await supabase
              .from("site_pages")
              .upsert({
                site_id: entry.siteId,
                url: matchedUrl,
                source: "sitemap",
                index_status: "not_indexed",
                last_checked_at: new Date().toISOString(),
              }, { onConflict: "site_id,url" });
          }
        }
      } catch (err) {
        console.error(`[CRON] Sitemap fetch error for ${domain}:`, err);
      }
    }
  }

  // ── Handle classic drops (position X → null) ──
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
  }

  // ── Submit ALL not-indexed URLs to Rapid Indexer ──
  // Combine classic drops + sitemap-matched out-of-100
  const allUrlsToReindex = [
    ...new Set([
      ...deindexedUrls.map((d) => d.url),
      ...sitemapUrlsToReindex,
    ]),
  ];

  if (allUrlsToReindex.length > 0) {
    try {
      const indexer = createIndexerService();
      const { taskId } = await indexer.submitUrls(allUrlsToReindex);

      await supabase.from("indexer_tasks").insert({
        task_id: taskId,
        urls: allUrlsToReindex,
        status: "pending",
      });

      // Update deindexed_urls status if any
      if (deindexedUrls.length > 0) {
        await supabase
          .from("deindexed_urls")
          .update({ status: "reindex_submitted", indexer_task_id: taskId })
          .in("url", deindexedUrls.map((d) => d.url))
          .eq("status", "detected");
      }

      console.log(`[CRON] Auto-submitted ${allUrlsToReindex.length} URLs to Rapid Indexer (task ${taskId})`);
    } catch (err) {
      console.error("[CRON] Rapid Indexer auto-submit error:", err);
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
        endpoint: "serp/google/organic/live",
        credits_used: totalApiCalls,
        cost_usd: totalApiCalls * 0.002,
      });
    }
  }

  console.log(`[CRON] Position check complete: ${dedupedArray.length} keywords, ${totalApiCalls} API calls, ${deindexedUrls.length} drops, ${outOf100.length} out-of-100, ${sitemapMatched} sitemap matches`);

  return NextResponse.json({
    checked: dedupedArray.length,
    totalKeywords: keywords.length,
    deduplicated: keywords.length - dedupedArray.length,
    deindexed: deindexedUrls.length,
    outOf100: outOf100.length,
    sitemapMatched,
    reindexSubmitted: allUrlsToReindex.length,
    apiCalls: totalApiCalls,
    errors: errors.length > 0 ? errors : undefined,
  });
}

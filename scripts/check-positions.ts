// ---------------------------------------------------------------------------
// Standalone script: Check keyword positions via DataForSEO
// Run: npx tsx --env-file=.env scripts/check-positions.ts
// ---------------------------------------------------------------------------

import { createAdminClient } from "@/lib/supabase/admin";
import { DataForSeoClient } from "@/lib/dataforseo/client";
import { createIndexerService } from "@/lib/indexer/factory";
import { discoverSitemapUrls } from "@/lib/sitemap/parser";
import { extractSlugFromUrl } from "@/lib/sitemap/slug";

async function main() {
  console.log("[CHECK-POSITIONS] Starting...");
  const startTime = Date.now();

  const supabase = createAdminClient();

  const { data: keywords, error } = await supabase
    .from("keywords")
    .select(
      "id, keyword, location_code, site_id, sites(domain), locations(default_language)"
    );

  if (error) {
    console.error("[CHECK-POSITIONS] DB error:", error.message);
    process.exit(1);
  }

  if (!keywords || keywords.length === 0) {
    console.log("[CHECK-POSITIONS] No keywords to check");
    process.exit(0);
  }

  // Deduplicate: group by (keyword + location_code)
  const deduped = new Map<
    string,
    {
      keyword: string;
      locationCode: number;
      language: string;
      entries: Array<{ keywordId: string; siteId: string; domain: string }>;
    }
  >();

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
  const deindexedUrls: Array<{
    siteId: string;
    keywordId: string;
    url: string;
  }> = [];
  const outOf100: Array<{
    siteId: string;
    keywordId: string;
    domain: string;
    keyword: string;
  }> = [];
  const errors: string[] = [];

  console.log(
    `[CHECK-POSITIONS] Checking ${dedupedArray.length} unique keywords (${keywords.length} total entries)...`
  );

  for (const [, data] of dedupedArray) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const response: any = await dataforseo.getSerpLive(
        data.keyword,
        data.locationCode,
        data.language
      );
      totalApiCalls++;

      const task = response?.tasks?.[0];
      if (!task || task.status_code !== 20000) {
        errors.push(
          `${data.keyword}: task error ${task?.status_code} - ${task?.status_message}`
        );
        continue;
      }

      const items = task.result?.[0]?.items ?? [];

      for (const entry of data.entries) {
        const domainClean = entry.domain.replace(/^www\./, "").toLowerCase();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const found = items.find((item: any) => {
          if (item.type !== "organic") return false;
          const itemDomain = (item.domain || "")
            .replace(/^www\./, "")
            .toLowerCase();
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

      // Progress log every 10 calls
      if (totalApiCalls % 10 === 0) {
        console.log(
          `[CHECK-POSITIONS] Progress: ${totalApiCalls}/${dedupedArray.length} keywords checked`
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${data.keyword}: ${msg}`);
      console.error(
        `[CHECK-POSITIONS] DataForSEO error for "${data.keyword}":`,
        msg
      );
    }
  }

  // ── Sitemap matching for ALL out-of-100 keywords ──
  const sitemapUrlsToReindex: string[] = [];
  let sitemapMatched = 0;
  let missingPages = 0;

  if (outOf100.length > 0) {
    console.log(
      `[CHECK-POSITIONS] ${outOf100.length} keywords out of top 100, matching against sitemaps...`
    );

    const byDomain = new Map<string, typeof outOf100>();
    for (const entry of outOf100) {
      const arr = byDomain.get(entry.domain) ?? [];
      arr.push(entry);
      byDomain.set(entry.domain, arr);
    }

    for (const [domain, entries] of byDomain) {
      try {
        const sitemapUrls = await discoverSitemapUrls(domain);
        const sitemapEntries = sitemapUrls
          .map((url) => ({
            slug: extractSlugFromUrl(url).toLowerCase(),
            url,
          }))
          .filter((e) => e.slug);

        for (const entry of entries) {
          const kwSlug = entry.keyword.toLowerCase().replace(/\s+/g, "-");
          const matched = sitemapEntries.find((e) => e.slug.includes(kwSlug));
          const matchedUrl = matched?.url;

          if (matchedUrl) {
            sitemapMatched++;
            sitemapUrlsToReindex.push(matchedUrl);

            await supabase.from("site_pages").upsert(
              {
                site_id: entry.siteId,
                url: matchedUrl,
                source: "sitemap",
                index_status: "not_indexed",
                last_checked_at: new Date().toISOString(),
              },
              { onConflict: "site_id,url" }
            );
          } else {
            missingPages++;
            const expectedUrl = `https://${domain}/${kwSlug}/`;
            await supabase.from("site_pages").upsert(
              {
                site_id: entry.siteId,
                url: expectedUrl,
                source: "missing",
                index_status: "missing",
                last_checked_at: new Date().toISOString(),
              },
              { onConflict: "site_id,url" }
            );
          }
        }
      } catch (err) {
        console.error(
          `[CHECK-POSITIONS] Sitemap fetch error for ${domain}:`,
          err
        );
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

  // ── Submit not-indexed URLs for reindexation (skip recently submitted) ──
  const candidateUrls = [
    ...new Set([
      ...deindexedUrls.map((d) => d.url),
      ...sitemapUrlsToReindex,
    ]),
  ];

  // Filter out URLs already submitted in the last 3 days
  let allUrlsToReindex = candidateUrls;
  if (candidateUrls.length > 0) {
    const threeDaysAgo = new Date();
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);

    const { data: recentlySubmitted } = await supabase
      .from("site_pages")
      .select("url")
      .in("url", candidateUrls)
      .eq("index_status", "reindex_submitted")
      .gte("last_checked_at", threeDaysAgo.toISOString());

    const recentSet = new Set(
      (recentlySubmitted ?? []).map((r) => r.url)
    );

    allUrlsToReindex = candidateUrls.filter((u) => !recentSet.has(u));

    if (recentSet.size > 0) {
      console.log(
        `[CHECK-POSITIONS] Skipping ${recentSet.size} URLs already submitted in last 3 days`
      );
    }
  }

  if (allUrlsToReindex.length > 0) {
    try {
      const indexer = createIndexerService();
      const { taskId } = await indexer.submitUrls(allUrlsToReindex);

      await supabase.from("indexer_tasks").insert({
        task_id: taskId,
        urls: allUrlsToReindex,
        status: "pending",
      });

      if (deindexedUrls.length > 0) {
        await supabase
          .from("deindexed_urls")
          .update({ status: "reindex_submitted", indexer_task_id: taskId })
          .in(
            "url",
            deindexedUrls.map((d) => d.url)
          )
          .eq("status", "detected");
      }

      // Mark URLs as reindex_submitted so they won't be re-sent within 7 days
      for (let i = 0; i < allUrlsToReindex.length; i += 100) {
        const batch = allUrlsToReindex.slice(i, i + 100);
        await supabase
          .from("site_pages")
          .update({
            index_status: "reindex_submitted",
            last_checked_at: new Date().toISOString(),
          })
          .in("url", batch);
      }

      console.log(
        `[CHECK-POSITIONS] Submitted ${allUrlsToReindex.length} URLs for reindexation (task ${taskId})`
      );
    } catch (err) {
      console.error("[CHECK-POSITIONS] Indexer submit error:", err);
    }
  }

  // ── Log API usage ──
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

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(
    `[CHECK-POSITIONS] Complete in ${elapsed}s: ${dedupedArray.length} keywords, ${totalApiCalls} API calls, ${deindexedUrls.length} drops, ${outOf100.length} out-of-100, ${sitemapMatched} matched, ${missingPages} missing, ${allUrlsToReindex.length} reindex submitted`
  );

  if (errors.length > 0) {
    console.error(`[CHECK-POSITIONS] Errors (${errors.length}):`, errors);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("[CHECK-POSITIONS] Fatal error:", err);
  process.exit(1);
});

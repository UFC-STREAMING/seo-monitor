import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { NextRequest, NextResponse } from "next/server";
import { XMLParser } from "fast-xml-parser";

export const maxDuration = 120;

/**
 * GET /api/gsc/not-indexed
 *
 * Discovers product URLs from sitemaps, cross-references with GSC data.
 * URLs in sitemap but NOT appearing in GSC (0 impressions in last 30 days) = not indexed.
 *
 * Query params:
 *   - site_id: filter by specific site (optional, defaults to all)
 *   - days: lookback period for GSC data (default 30)
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const siteId = searchParams.get("site_id");
    const days = parseInt(searchParams.get("days") ?? "30", 10);

    const admin = createAdminClient();

    // Get user's sites with GSC properties
    let sitesQuery = admin
      .from("sites")
      .select("id, domain, user_id, gsc_properties(id)")
      .eq("user_id", user.id)
      .eq("is_active", true);

    if (siteId) {
      sitesQuery = sitesQuery.eq("id", siteId);
    }

    const { data: sites } = await sitesQuery;
    if (!sites || sites.length === 0) {
      return NextResponse.json({ sites: [], total_sitemap: 0, total_not_indexed: 0 });
    }

    const sinceDate = new Date();
    sinceDate.setDate(sinceDate.getDate() - days);
    const dateStr = sinceDate.toISOString().split("T")[0];

    const results: Array<{
      domain: string;
      site_id: string;
      sitemap_urls: number;
      indexed_urls: number;
      not_indexed_urls: string[];
      indexation_rate: number;
    }> = [];

    for (const site of sites) {
      const gscProps = site.gsc_properties as unknown as Array<{ id: string }> | null;
      const gscPropId = gscProps?.[0]?.id;
      if (!gscPropId) continue;

      // Fetch sitemap URLs
      const sitemapUrls = await discoverSitemapUrls(site.domain);
      if (sitemapUrls.length === 0) continue;

      // Get pages that appear in GSC with impressions (= indexed)
      const { data: gscPages } = await admin
        .from("gsc_search_data")
        .select("page")
        .eq("gsc_property_id", gscPropId)
        .gte("date", dateStr)
        .gt("impressions", 0)
        .not("page", "is", null);

      const indexedPages = new Set(
        (gscPages ?? [])
          .filter((p: { page: string | null }) => p.page !== null)
          .map((p: { page: string | null }) => normalizeUrl(p.page as string))
      );

      const notIndexed = sitemapUrls.filter(
        (url) => !indexedPages.has(normalizeUrl(url))
      );

      const rate = sitemapUrls.length > 0
        ? Math.round(((sitemapUrls.length - notIndexed.length) / sitemapUrls.length) * 1000) / 10
        : 100;

      results.push({
        domain: site.domain,
        site_id: site.id,
        sitemap_urls: sitemapUrls.length,
        indexed_urls: sitemapUrls.length - notIndexed.length,
        not_indexed_urls: notIndexed,
        indexation_rate: rate,
      });
    }

    return NextResponse.json({
      sites: results,
      total_sitemap: results.reduce((s, r) => s + r.sitemap_urls, 0),
      total_not_indexed: results.reduce((s, r) => s + r.not_indexed_urls.length, 0),
      total_indexed: results.reduce((s, r) => s + r.indexed_urls, 0),
    });
  } catch (err) {
    console.error("Not-indexed error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// ── Sitemap helpers ─────────────────────────────────────────────────────────

function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`.replace(/\/$/, "");
  } catch {
    return url.replace(/\/$/, "");
  }
}

async function discoverSitemapUrls(domain: string): Promise<string[]> {
  const urls = new Set<string>();
  const origins = [`https://${domain}`, `https://www.${domain}`];

  for (const origin of origins) {
    try {
      // Try sitemap index first
      const indexUrls = await fetchSitemap(`${origin}/sitemap_index.xml`);
      if (indexUrls.length > 0) {
        // It's a sitemap index — fetch each child sitemap
        for (const childUrl of indexUrls) {
          const childUrls = await fetchSitemap(childUrl);
          childUrls.forEach((u) => urls.add(u));
        }
        break;
      }

      // Try plain sitemap
      const plainUrls = await fetchSitemap(`${origin}/sitemap.xml`);
      if (plainUrls.length > 0) {
        plainUrls.forEach((u) => urls.add(u));
        break;
      }
    } catch {
      continue;
    }
  }

  return Array.from(urls);
}

async function fetchSitemap(url: string): Promise<string[]> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "SEOMonitor/1.0" },
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) return [];

    const xml = await res.text();
    const parser = new XMLParser({ ignoreAttributes: false });
    const parsed = parser.parse(xml);

    // Sitemap index
    if (parsed?.sitemapindex?.sitemap) {
      const sitemaps = Array.isArray(parsed.sitemapindex.sitemap)
        ? parsed.sitemapindex.sitemap
        : [parsed.sitemapindex.sitemap];
      return sitemaps.map((s: { loc: string }) => s.loc).filter(Boolean);
    }

    // Regular sitemap
    if (parsed?.urlset?.url) {
      const entries = Array.isArray(parsed.urlset.url)
        ? parsed.urlset.url
        : [parsed.urlset.url];
      return entries.map((u: { loc: string }) => u.loc).filter(Boolean);
    }

    return [];
  } catch {
    return [];
  }
}

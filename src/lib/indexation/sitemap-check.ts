import { XMLParser } from "fast-xml-parser";

export interface SitemapDiscoveryResult {
  urls: string[];
  source: string | null;
}

export function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`.replace(/\/$/, "");
  } catch {
    return url.replace(/\/$/, "");
  }
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

    if (parsed?.sitemapindex?.sitemap) {
      const sitemaps = Array.isArray(parsed.sitemapindex.sitemap)
        ? parsed.sitemapindex.sitemap
        : [parsed.sitemapindex.sitemap];
      return sitemaps.map((s: { loc: string }) => s.loc).filter(Boolean);
    }

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

const CANDIDATE_PATHS = [
  "/product-sitemap.xml",
  "/wp-sitemap-posts-product-1.xml",
  "/sitemap_index.xml",
  "/sitemap.xml",
  "/wp-sitemap.xml",
];

export async function discoverSitemapUrls(domain: string): Promise<SitemapDiscoveryResult> {
  const urls = new Set<string>();
  let bestSource: string | null = null;
  let bestCount = 0;

  for (const origin of [`https://${domain}`, `https://www.${domain}`]) {
    for (const path of CANDIDATE_PATHS) {
      const fullUrl = `${origin}${path}`;
      const result = await fetchSitemap(fullUrl);
      if (result.length === 0) continue;

      const firstUrl = result[0] || "";
      if (firstUrl.endsWith(".xml")) {
        const collected = new Set<string>();
        for (const childUrl of result) {
          const childResult = await fetchSitemap(childUrl);
          childResult.forEach((u) => collected.add(u));
        }
        if (collected.size > bestCount) {
          urls.clear();
          collected.forEach((u) => urls.add(u));
          bestSource = fullUrl;
          bestCount = collected.size;
        }
      } else {
        if (result.length > bestCount) {
          urls.clear();
          result.forEach((u) => urls.add(u));
          bestSource = fullUrl;
          bestCount = result.length;
        }
      }

      if (bestCount > 0) break;
    }
    if (bestCount > 0) break;
  }

  return {
    urls: Array.from(urls).filter((u) => {
      const normalized = normalizeUrl(u).toLowerCase();
      return !normalized.endsWith("/cart") &&
             !normalized.endsWith("/checkout") &&
             !normalized.endsWith("/my-account") &&
             !normalized.endsWith("/shop") &&
             !normalized.includes("/page/") &&
             !normalized.includes("/category/");
    }),
    source: bestSource,
  };
}

export interface IndexationResult {
  site_id: string;
  domain: string;
  template_type: string | null;
  sitemap_urls_count: number;
  indexed_urls_count: number;
  not_indexed_urls_count: number;
  not_indexed_urls: string[];
  indexation_rate: number;
  sitemap_source: string | null;
  error?: string;
}

interface SiteRow {
  id: string;
  domain: string;
  template_type?: string | null;
  gsc_properties?: { id: string }[] | null;
}

interface GscPageRow {
  page: string | null;
}

interface SupabaseClientLike {
  from(table: string): {
    select(cols: string): {
      eq(col: string, val: unknown): {
        gte(col: string, val: unknown): {
          gt(col: string, val: number): {
            not(col: string, op: string, val: unknown): Promise<{ data: GscPageRow[] | null }>;
          };
        };
      };
    };
  };
}

export async function computeIndexationForSite(
  site: SiteRow,
  supabase: SupabaseClientLike,
  lookbackDays = 30
): Promise<IndexationResult> {
  const base: IndexationResult = {
    site_id: site.id,
    domain: site.domain,
    template_type: site.template_type ?? null,
    sitemap_urls_count: 0,
    indexed_urls_count: 0,
    not_indexed_urls_count: 0,
    not_indexed_urls: [],
    indexation_rate: 0,
    sitemap_source: null,
  };

  try {
    const { urls: sitemapUrls, source } = await discoverSitemapUrls(site.domain);
    base.sitemap_urls_count = sitemapUrls.length;
    base.sitemap_source = source;

    if (sitemapUrls.length === 0) {
      base.error = "no_sitemap_found";
      return base;
    }

    const gscProps = site.gsc_properties ?? [];
    const gscPropId = gscProps[0]?.id;
    if (!gscPropId) {
      base.error = "no_gsc_property";
      base.not_indexed_urls = sitemapUrls;
      base.not_indexed_urls_count = sitemapUrls.length;
      return base;
    }

    const sinceDate = new Date();
    sinceDate.setDate(sinceDate.getDate() - lookbackDays);
    const dateStr = sinceDate.toISOString().split("T")[0];

    const { data: gscPages } = await supabase
      .from("gsc_search_data")
      .select("page")
      .eq("gsc_property_id", gscPropId)
      .gte("date", dateStr)
      .gt("impressions", 0)
      .not("page", "is", null);

    const indexedPages = new Set(
      (gscPages ?? [])
        .filter((p) => p.page !== null)
        .map((p) => normalizeUrl(p.page as string))
    );

    const notIndexed = sitemapUrls.filter((url) => !indexedPages.has(normalizeUrl(url)));

    base.indexed_urls_count = sitemapUrls.length - notIndexed.length;
    base.not_indexed_urls = notIndexed;
    base.not_indexed_urls_count = notIndexed.length;
    base.indexation_rate = sitemapUrls.length > 0
      ? Math.round(((sitemapUrls.length - notIndexed.length) / sitemapUrls.length) * 1000) / 10
      : 0;

    return base;
  } catch (e) {
    base.error = e instanceof Error ? e.message : "unknown_error";
    return base;
  }
}

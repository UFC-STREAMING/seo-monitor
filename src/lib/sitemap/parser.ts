import { XMLParser } from "fast-xml-parser";

const parser = new XMLParser({
  ignoreAttributes: false,
  isArray: (name) => name === "url" || name === "sitemap",
});

/**
 * Fetch and parse a sitemap XML (or sitemap index) to extract all page URLs.
 * Handles recursive sitemap indexes (sitemap of sitemaps).
 */
export async function parseSitemap(sitemapUrl: string): Promise<string[]> {
  const urls: string[] = [];

  try {
    const res = await fetch(sitemapUrl, {
      headers: { "User-Agent": "SEO-Monitor-Bot/1.0" },
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      console.error(`Sitemap fetch failed: ${res.status} ${sitemapUrl}`);
      return [];
    }

    const xml = await res.text();
    const parsed = parser.parse(xml);

    // Sitemap index: contains <sitemapindex><sitemap><loc>...</loc></sitemap></sitemapindex>
    if (parsed.sitemapindex?.sitemap) {
      const sitemaps = Array.isArray(parsed.sitemapindex.sitemap)
        ? parsed.sitemapindex.sitemap
        : [parsed.sitemapindex.sitemap];

      for (const sm of sitemaps) {
        const loc = sm.loc;
        if (loc && typeof loc === "string") {
          const childUrls = await parseSitemap(loc);
          urls.push(...childUrls);
        }
      }
    }

    // Regular sitemap: contains <urlset><url><loc>...</loc></url></urlset>
    if (parsed.urlset?.url) {
      const entries = Array.isArray(parsed.urlset.url)
        ? parsed.urlset.url
        : [parsed.urlset.url];

      for (const entry of entries) {
        const loc = entry.loc;
        if (loc && typeof loc === "string") {
          urls.push(loc);
        }
      }
    }
  } catch (err) {
    console.error(`Sitemap parse error for ${sitemapUrl}:`, err);
  }

  return urls;
}

/**
 * Try common sitemap URLs for a domain and return all found page URLs.
 */
export async function discoverSitemapUrls(domain: string): Promise<string[]> {
  const candidates = [
    `https://${domain}/sitemap.xml`,
    `https://${domain}/sitemap_index.xml`,
    `https://${domain}/wp-sitemap.xml`,
    `https://${domain}/post-sitemap.xml`,
    `https://${domain}/product-sitemap.xml`,
  ];

  for (const url of candidates) {
    const urls = await parseSitemap(url);
    if (urls.length > 0) {
      return urls;
    }
  }

  return [];
}

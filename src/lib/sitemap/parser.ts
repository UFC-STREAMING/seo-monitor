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

/** Paths that are NOT product pages (WooCommerce / generic site pages) */
const EXCLUDED_PATHS = [
  "/panier/", "/cart/", "/checkout/",
  "/mon-compte/", "/my-account/",
  "/boutique/", "/shop/",
  "/contact/", "/a-propos/", "/about/",
  "/mentions-legales/", "/legal/",
  "/politique-de-confidentialite/", "/privacy-policy/",
  "/politique-de-retour/", "/refund-policy/", "/return-policy/",
  "/conditions-generales", "/terms/",
  "/livraison/", "/shipping/",
  "/paiement/", "/payment/",
  "/notre-equipe/", "/team/",
  "/programme-affiliation/", "/affiliate/",
];

/**
 * Filter out non-product URLs (homepage, legal pages, cart, etc.)
 * Keeps only URLs with a meaningful slug (product pages).
 */
export function filterProductUrls(urls: string[]): string[] {
  return urls.filter((url) => {
    try {
      const { pathname } = new URL(url);
      // Exclude homepage
      if (pathname === "/" || pathname === "") return false;
      // Exclude known non-product paths
      const pathLower = pathname.toLowerCase();
      return !EXCLUDED_PATHS.some((exc) => pathLower.includes(exc));
    } catch {
      return false;
    }
  });
}

/**
 * Try common sitemap URLs for a domain and return all found page URLs.
 * Prioritizes product-specific sitemaps (WooCommerce product-sitemap.xml).
 * Filters out non-product pages by default.
 */
export async function discoverSitemapUrls(
  domain: string,
  { productsOnly = true }: { productsOnly?: boolean } = {},
): Promise<string[]> {
  // Try product-specific sitemaps first
  const productSitemaps = [
    `https://${domain}/product-sitemap.xml`,
    `https://${domain}/wp-sitemap-posts-product-1.xml`,
  ];

  for (const url of productSitemaps) {
    const urls = await parseSitemap(url);
    if (urls.length > 0) {
      return productsOnly ? filterProductUrls(urls) : urls;
    }
  }

  // Fallback to general sitemaps
  const generalSitemaps = [
    `https://${domain}/sitemap.xml`,
    `https://${domain}/sitemap_index.xml`,
    `https://${domain}/wp-sitemap.xml`,
  ];

  for (const url of generalSitemaps) {
    const urls = await parseSitemap(url);
    if (urls.length > 0) {
      return productsOnly ? filterProductUrls(urls) : urls;
    }
  }

  return [];
}

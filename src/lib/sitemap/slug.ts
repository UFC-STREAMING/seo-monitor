/**
 * Extract the last meaningful path segment (slug) from a URL.
 * Examples:
 *   https://dr-mounier.fr/vigueur-active/ → "vigueur-active"
 *   https://site.com/produit/brazilian-wood-avis/ → "brazilian-wood-avis"
 *   https://site.com/shop/product-name → "product-name"
 */
export function extractSlugFromUrl(url: string): string {
  try {
    const { pathname } = new URL(url);
    // Remove trailing slash, split by /, take last non-empty segment
    const segments = pathname.replace(/\/$/, "").split("/").filter(Boolean);
    return segments[segments.length - 1] ?? "";
  } catch {
    return "";
  }
}

/**
 * Convert a URL slug to a search keyword.
 * Replaces hyphens/underscores with spaces.
 * Examples:
 *   "vigueur-active" → "vigueur active"
 *   "brazilian-wood-avis" → "brazilian wood avis"
 */
export function slugToKeyword(slug: string): string {
  return slug.replace(/[-_]/g, " ").trim();
}

/**
 * Check if a result URL contains the expected slug.
 * Used to verify that the correct page appears in Google results,
 * not just other pages from the same site (due to internal links).
 */
export function urlContainsSlug(resultUrl: string, expectedSlug: string): boolean {
  try {
    const { pathname } = new URL(resultUrl);
    const normalizedPath = pathname.toLowerCase();
    const normalizedSlug = expectedSlug.toLowerCase();
    return normalizedPath.includes(normalizedSlug);
  } catch {
    return false;
  }
}

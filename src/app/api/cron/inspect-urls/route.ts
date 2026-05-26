import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { gscClient } from "@/lib/google/search-console";
import { discoverSitemapUrls } from "@/lib/indexation/sitemap-check";

export const maxDuration = 300;

// Rate limit GSC urlInspection: 2000 req/day/property, 600/min.
// We add a small delay between requests to stay well under 600/min.
const DELAY_MS = 150;

// Scope: only ACTIVE NUTRA sites with at least one linked GSC property.
// Other niches (casino, money, emd, pbn) are not inspected here.
const ALLOWED_NICHE = "nutra";

interface SiteRow {
  id: string;
  domain: string;
  gsc_properties: { id: string; site_url: string }[] | null;
}

export async function GET(request: NextRequest) {
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
  const { searchParams } = new URL(request.url);
  const onlyDomain = searchParams.get("domain"); // optional: inspect single site

  let sitesQuery = supabase
    .from("sites")
    .select("id, domain, gsc_properties(id, site_url)")
    .eq("is_active", true)
    .eq("niche", ALLOWED_NICHE);

  if (onlyDomain) {
    sitesQuery = sitesQuery.eq("domain", onlyDomain);
  }

  const { data: sites, error: sitesErr } = await sitesQuery;
  if (sitesErr || !sites) {
    return NextResponse.json(
      { error: "Failed to fetch sites", details: sitesErr },
      { status: 500 }
    );
  }

  const reports = [];
  let totalChecked = 0;
  let totalIndexed = 0;
  let totalNotIndexed = 0;

  for (const siteRaw of sites as SiteRow[]) {
    const gscProps = siteRaw.gsc_properties ?? [];
    if (gscProps.length === 0) {
      reports.push({ domain: siteRaw.domain, error: "no_gsc_property", checked: 0 });
      continue;
    }

    // Pick the first GSC property as the canonical one to inspect against.
    // Domain properties (sc-domain:foo.tld) cover all subdomains/protocols.
    const property = gscProps.find((p) => p.site_url.startsWith("sc-domain:"))
      ?? gscProps[0];

    const { urls: sitemapUrls } = await discoverSitemapUrls(siteRaw.domain);
    if (sitemapUrls.length === 0) {
      reports.push({ domain: siteRaw.domain, error: "no_sitemap_found", checked: 0 });
      continue;
    }

    let siteChecked = 0;
    let siteIndexed = 0;
    let siteNotIndexed = 0;
    let siteErrors = 0;

    for (const url of sitemapUrls) {
      const { result, error } = await gscClient.inspectUrl(property.site_url, url);
      siteChecked++;
      totalChecked++;

      const row: Record<string, unknown> = {
        site_id: siteRaw.id,
        url,
        gsc_property: property.site_url,
        inspected_at: new Date().toISOString(),
      };

      if (!result) {
        row.verdict = "ERROR";
        row.error = error ?? "unknown";
        siteErrors++;
      } else {
        row.verdict = result.verdict ?? "VERDICT_UNSPECIFIED";
        row.coverage_state = result.coverageState ?? null;
        row.indexing_state = result.indexingState ?? null;
        row.page_fetch_state = result.pageFetchState ?? null;
        row.robots_txt_state = result.robotsTxtState ?? null;
        row.last_crawl_time = result.lastCrawlTime ?? null;
        row.crawled_as = result.crawledAs ?? null;
        row.google_canonical = result.googleCanonical ?? null;
        row.user_canonical = result.userCanonical ?? null;
        row.error = null;

        if (result.verdict === "PASS") {
          siteIndexed++;
          totalIndexed++;
        } else {
          siteNotIndexed++;
          totalNotIndexed++;
        }
      }

      await (supabase as never as {
        from: (t: string) => {
          upsert: (
            r: Record<string, unknown>,
            o: { onConflict: string }
          ) => Promise<unknown>;
        };
      })
        .from("url_inspections")
        .upsert(row, { onConflict: "site_id,url" });

      await new Promise((r) => setTimeout(r, DELAY_MS));
    }

    reports.push({
      domain: siteRaw.domain,
      gsc_property: property.site_url,
      checked: siteChecked,
      indexed: siteIndexed,
      not_indexed: siteNotIndexed,
      errors: siteErrors,
    });
  }

  return NextResponse.json({
    success: true,
    summary: {
      total_sites: sites.length,
      total_checked: totalChecked,
      total_indexed: totalIndexed,
      total_not_indexed: totalNotIndexed,
    },
    reports,
  });
}

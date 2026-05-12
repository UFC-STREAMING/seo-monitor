import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 30;

/**
 * GET /api/agent/indexation
 *
 * Returns latest indexation snapshot for all sites. Read-only, fast.
 * Computed daily by /api/cron/check-indexation.
 *
 * Auth: Bearer ${CRON_SECRET}
 *
 * Query params:
 *   - site_id: filter to one site
 *   - problems_only=true: only return sites with not_indexed > 0 OR indexation_rate < 80
 *   - include_urls=false: skip the not_indexed_urls[] array (lighter response)
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();
  const { searchParams } = new URL(request.url);
  const siteId = searchParams.get("site_id");
  const problemsOnly = searchParams.get("problems_only") === "true";
  const includeUrls = searchParams.get("include_urls") !== "false";

  const sbAny = supabase as never as {
    from: (t: string) => {
      select: (cols: string) => {
        order: (col: string, opts: { ascending: boolean }) => {
          eq: (c: string, v: unknown) => { limit: (n: number) => Promise<{ data: unknown; error: unknown }> };
          limit: (n: number) => Promise<{ data: unknown; error: unknown }>;
        };
      };
    };
  };

  const baseQuery = sbAny
    .from("indexation_snapshots")
    .select(`
      site_id,
      snapshot_date,
      sitemap_urls_count,
      indexed_urls_count,
      not_indexed_urls_count,
      indexation_rate,
      not_indexed_urls,
      sitemap_source,
      template_type,
      error,
      sites!inner(id, domain, is_active)
    `)
    .order("snapshot_date", { ascending: false });

  const { data, error } = siteId
    ? await baseQuery.eq("site_id", siteId).limit(7)
    : await baseQuery.limit(200);

  if (error) {
    return NextResponse.json({ error: "Query failed", details: error }, { status: 500 });
  }

  type Row = {
    snapshot_date: string;
    sitemap_urls_count: number;
    indexed_urls_count: number;
    not_indexed_urls_count: number;
    indexation_rate: number;
    not_indexed_urls: string[];
    sitemap_source: string | null;
    template_type: string | null;
    error: string | null;
    sites: { id: string; domain: string; is_active: boolean };
  };

  const rows = (data ?? []) as unknown as Row[];

  const latestPerSite = new Map<string, Row>();
  for (const row of rows) {
    if (!row.sites?.is_active) continue;
    const dKey = row.sites.id;
    if (!latestPerSite.has(dKey)) {
      latestPerSite.set(dKey, row);
    }
  }

  let sitesArr = Array.from(latestPerSite.values()).map((row) => ({
    site_id: row.sites.id,
    domain: row.sites.domain,
    snapshot_date: row.snapshot_date,
    template_type: row.template_type,
    sitemap_urls: row.sitemap_urls_count,
    indexed: row.indexed_urls_count,
    not_indexed: row.not_indexed_urls_count,
    indexation_rate: row.indexation_rate,
    sitemap_source: row.sitemap_source,
    error: row.error,
    not_indexed_urls: includeUrls ? row.not_indexed_urls : undefined,
  }));

  if (problemsOnly) {
    sitesArr = sitesArr.filter((s) => s.not_indexed > 0 || s.indexation_rate < 80 || s.error);
  }

  sitesArr.sort((a, b) => b.not_indexed - a.not_indexed);

  const totalSitemap = sitesArr.reduce((s, r) => s + r.sitemap_urls, 0);
  const totalIndexed = sitesArr.reduce((s, r) => s + r.indexed, 0);
  const totalNotIndexed = sitesArr.reduce((s, r) => s + r.not_indexed, 0);

  return NextResponse.json({
    snapshot_date: sitesArr[0]?.snapshot_date ?? null,
    summary: {
      total_sites: sitesArr.length,
      total_sitemap_urls: totalSitemap,
      total_indexed: totalIndexed,
      total_not_indexed: totalNotIndexed,
      global_indexation_rate: totalSitemap > 0
        ? Math.round((totalIndexed / totalSitemap) * 1000) / 10
        : 0,
    },
    sites: sitesArr,
  });
}

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
 *   - source=urlinspection: read the real GSC urlInspection verdicts (table url_inspections)
 *     instead of the inferred snapshot (default). urlInspection is the source of truth —
 *     use it when "indexed = a recu des impressions" is too loose.
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
  const source = searchParams.get("source"); // "urlinspection" | null (default = snapshot)

  if (source === "urlinspection") {
    return urlInspectionResponse(supabase, { siteId, problemsOnly, includeUrls });
  }

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

interface InspectionRow {
  url: string;
  verdict: string;
  coverage_state: string | null;
  page_fetch_state: string | null;
  inspected_at: string;
  sites: { id: string; domain: string; is_active: boolean };
}

async function urlInspectionResponse(
  supabase: ReturnType<typeof createAdminClient>,
  opts: { siteId: string | null; problemsOnly: boolean; includeUrls: boolean }
) {
  const sbAny = supabase as never as {
    from: (t: string) => {
      select: (cols: string) => {
        eq: (c: string, v: unknown) => {
          limit: (n: number) => Promise<{ data: unknown; error: unknown }>;
        };
      };
    };
  };

  const baseSelect = `
    url,
    verdict,
    coverage_state,
    page_fetch_state,
    inspected_at,
    sites!inner(id, domain, is_active)
  `;

  // PostgREST default cap is 1000 rows; without an explicit .limit() large sites
  // (e.g. diabetologie-hagen.de with 109 product URLs) get their inspection set
  // truncated and the dashboard reports wrong indexation counts.
  const filtered = opts.siteId
    ? sbAny.from("url_inspections").select(baseSelect).eq("site_id", opts.siteId)
    : sbAny.from("url_inspections").select(baseSelect).eq("sites.is_active", true);
  const { data, error } = await filtered.limit(100000);
  if (error) {
    return NextResponse.json({ error: "Query failed", details: error }, { status: 500 });
  }

  const rows = (data ?? []) as unknown as InspectionRow[];

  type SiteAcc = {
    site_id: string;
    domain: string;
    total: number;
    indexed: number;
    not_indexed: number;
    errors: number;
    not_indexed_urls: { url: string; verdict: string; coverage_state: string | null }[];
    last_inspected_at: string | null;
  };

  const bySite = new Map<string, SiteAcc>();
  for (const r of rows) {
    if (!r.sites?.is_active) continue;
    let acc = bySite.get(r.sites.id);
    if (!acc) {
      acc = {
        site_id: r.sites.id,
        domain: r.sites.domain,
        total: 0,
        indexed: 0,
        not_indexed: 0,
        errors: 0,
        not_indexed_urls: [],
        last_inspected_at: null,
      };
      bySite.set(r.sites.id, acc);
    }
    acc.total++;
    if (r.verdict === "PASS") {
      acc.indexed++;
    } else if (r.verdict === "ERROR") {
      acc.errors++;
    } else {
      acc.not_indexed++;
      acc.not_indexed_urls.push({
        url: r.url,
        verdict: r.verdict,
        coverage_state: r.coverage_state,
      });
    }
    if (!acc.last_inspected_at || r.inspected_at > acc.last_inspected_at) {
      acc.last_inspected_at = r.inspected_at;
    }
  }

  let sitesArr = Array.from(bySite.values()).map((s) => ({
    site_id: s.site_id,
    domain: s.domain,
    last_inspected_at: s.last_inspected_at,
    sitemap_urls: s.total,
    indexed: s.indexed,
    not_indexed: s.not_indexed,
    errors: s.errors,
    indexation_rate: s.total > 0 ? Math.round((s.indexed / s.total) * 1000) / 10 : 0,
    not_indexed_urls: opts.includeUrls ? s.not_indexed_urls : undefined,
  }));

  if (opts.problemsOnly) {
    sitesArr = sitesArr.filter((s) => s.not_indexed > 0 || s.indexation_rate < 80);
  }

  sitesArr.sort((a, b) => b.not_indexed - a.not_indexed);

  const totalSitemap = sitesArr.reduce((s, r) => s + r.sitemap_urls, 0);
  const totalIndexed = sitesArr.reduce((s, r) => s + r.indexed, 0);
  const totalNotIndexed = sitesArr.reduce((s, r) => s + r.not_indexed, 0);

  return NextResponse.json({
    source: "urlinspection",
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

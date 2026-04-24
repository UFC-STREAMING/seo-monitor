import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 60;

/**
 * GET /api/gsc/sites-ranking
 *
 * Classement des sites par performance GSC.
 * Utilise une RPC SQL pour agréger côté base (évite la limite 1000 rows).
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = createAdminClient();

    const authHeader = request.headers.get("authorization");
    const isCron = authHeader === `Bearer ${process.env.CRON_SECRET}`;
    if (!isCron) {
      const { createClient } = await import("@/lib/supabase/server");
      const userSupabase = await createClient();
      const { data: { user }, error } = await userSupabase.auth.getUser();
      if (error || !user) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
    }

    const { searchParams } = new URL(request.url);
    const days = parseInt(searchParams.get("days") ?? "28", 10);
    const sort = searchParams.get("sort") ?? "clicks";
    const countryFilter = searchParams.get("country");

    // Get sites
    let sitesQuery = supabase
      .from("sites")
      .select("id, domain, location_code, is_active, niche, site_type")
      .eq("is_active", true);

    if (countryFilter) {
      sitesQuery = sitesQuery.eq("location_code", parseInt(countryFilter, 10));
    }

    const { data: sites } = await sitesQuery;
    if (!sites || sites.length === 0) {
      return NextResponse.json({ sites: [], period: { days } });
    }

    // Get GSC properties linked to sites
    const siteIds = sites.map((s) => s.id);
    const { data: properties } = await supabase
      .from("gsc_properties")
      .select("id, site_id")
      .in("site_id", siteIds)
      .eq("is_active", true);

    if (!properties || properties.length === 0) {
      return NextResponse.json({ sites: [], period: { days } });
    }

    const propToSite = new Map(properties.map((p) => [p.id, p.site_id]));

    // Date ranges
    const now = new Date();
    const currentEnd = now.toISOString().split("T")[0];
    const currentStart = new Date(now);
    currentStart.setDate(currentStart.getDate() - days);
    const currentStartStr = currentStart.toISOString().split("T")[0];
    const prevStart = new Date(currentStart);
    prevStart.setDate(prevStart.getDate() - days);
    const prevStartStr = prevStart.toISOString().split("T")[0];

    // Aggregate via SQL RPC — returns one row per gsc_property_id
    // Call the SQL function via Supabase REST (bypass typed client for custom RPC)
    const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

    async function callRpc(dateFrom: string, dateTo: string) {
      const res = await fetch(`${sbUrl}/rest/v1/rpc/get_sites_ranking`, {
        method: "POST",
        headers: {
          "apikey": sbKey,
          "Authorization": `Bearer ${sbKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ p_date_from: dateFrom, p_date_to: dateTo }),
      });
      if (!res.ok) return [];
      return res.json();
    }

    const [currentAgg, prevAgg] = await Promise.all([
      callRpc(currentStartStr, currentEnd),
      callRpc(prevStartStr, currentStartStr),
    ]);

    // Map to site_id
    interface AggRow {
      gsc_property_id: string;
      total_clicks: number;
      total_impressions: number;
      avg_ctr: number;
      avg_position: number;
      query_count: number;
    }

    const currentStats = new Map<string, AggRow>();
    for (const row of (currentAgg ?? []) as AggRow[]) {
      const siteId = propToSite.get(row.gsc_property_id);
      if (!siteId) continue;
      const existing = currentStats.get(siteId);
      if (existing) {
        // Multiple properties for same site — merge
        existing.total_clicks += row.total_clicks;
        existing.total_impressions += row.total_impressions;
        existing.avg_ctr = (existing.avg_ctr + row.avg_ctr) / 2;
        existing.avg_position = (existing.avg_position + row.avg_position) / 2;
        existing.query_count += row.query_count;
      } else {
        currentStats.set(siteId, { ...row });
      }
    }

    const prevStats = new Map<string, { total_clicks: number; total_impressions: number }>();
    for (const row of (prevAgg ?? []) as AggRow[]) {
      const siteId = propToSite.get(row.gsc_property_id);
      if (!siteId) continue;
      const existing = prevStats.get(siteId);
      if (existing) {
        existing.total_clicks += row.total_clicks;
        existing.total_impressions += row.total_impressions;
      } else {
        prevStats.set(siteId, { total_clicks: row.total_clicks, total_impressions: row.total_impressions });
      }
    }

    // Build result
    const result = sites.map((site) => {
      const current = currentStats.get(site.id);
      const prev = prevStats.get(site.id);

      const clicks = current?.total_clicks ?? 0;
      const impressions = current?.total_impressions ?? 0;
      const avgCtr = current?.avg_ctr ?? 0;
      const avgPosition = current?.avg_position ?? 0;
      const prevClicks = prev?.total_clicks ?? 0;
      const clicksTrend = prevClicks > 0
        ? Math.round(((clicks - prevClicks) / prevClicks) * 1000) / 10
        : clicks > 0 ? 100 : 0;
      const prevImpressions = prev?.total_impressions ?? 0;
      const impressionsTrend = prevImpressions > 0
        ? Math.round(((impressions - prevImpressions) / prevImpressions) * 1000) / 10
        : impressions > 0 ? 100 : 0;

      let status: "star" | "growing" | "stable" | "declining" | "dead";
      if (clicks === 0 && impressions === 0) status = "dead";
      else if (clicksTrend > 20) status = "growing";
      else if (clicksTrend < -30) status = "declining";
      else if (clicks > 5000) status = "star";
      else status = "stable";

      return {
        site_id: site.id,
        domain: site.domain,
        location_code: site.location_code,
        niche: site.niche,
        site_type: site.site_type,
        clicks,
        impressions,
        avg_ctr: Math.round(avgCtr * 10000) / 10000,
        avg_position: Math.round(avgPosition * 10) / 10,
        clicks_trend_pct: clicksTrend,
        impressions_trend_pct: impressionsTrend,
        prev_clicks: prevClicks,
        prev_impressions: prevImpressions,
        unique_queries: current?.query_count ?? 0,
        status,
      };
    });

    // Sort
    const sortFn: Record<string, (a: typeof result[0], b: typeof result[0]) => number> = {
      clicks: (a, b) => b.clicks - a.clicks,
      impressions: (a, b) => b.impressions - a.impressions,
      ctr: (a, b) => b.avg_ctr - a.avg_ctr,
      position: (a, b) => (a.avg_position || 999) - (b.avg_position || 999),
      trend: (a, b) => b.clicks_trend_pct - a.clicks_trend_pct,
    };
    result.sort(sortFn[sort] ?? sortFn.clicks);

    return NextResponse.json({
      sites: result,
      period: { days, from: currentStartStr, to: currentEnd },
      totals: {
        clicks: result.reduce((s, r) => s + r.clicks, 0),
        impressions: result.reduce((s, r) => s + r.impressions, 0),
        active_sites: result.filter((r) => r.clicks > 0).length,
        dead_sites: result.filter((r) => r.status === "dead").length,
      },
    });
  } catch (err) {
    console.error("Sites ranking error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

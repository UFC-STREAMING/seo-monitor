import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 60;

/**
 * GET /api/linking/opportunities
 *
 * Utilise une RPC SQL qui fait toute l'agrégation côté base.
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
    const minImpressions = parseInt(searchParams.get("min_impressions") ?? "50", 10);
    const maxWinnerPosition = parseFloat(searchParams.get("max_winner_position") ?? "15");
    const countryFilter = searchParams.get("country");
    const limit = parseInt(searchParams.get("limit") ?? "50", 10);

    // Get properties → site map (needed to resolve domain/page)
    const { data: sites } = await supabase
      .from("sites")
      .select("id, domain, location_code")
      .eq("is_active", true);

    const { data: properties } = await supabase
      .from("gsc_properties")
      .select("id, site_id")
      .eq("is_active", true);

    if (!sites || !properties) {
      return NextResponse.json({ opportunities: [] });
    }

    const propToSite = new Map(properties.map((p) => [p.id, p.site_id]));
    const siteMap = new Map(sites.map((s) => [s.id, s]));

    // Date range
    const currentStart = new Date();
    currentStart.setDate(currentStart.getDate() - days);
    const currentDateStr = currentStart.toISOString().split("T")[0];

    // Call the full-aggregation RPC
    const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

    const res = await fetch(`${sbUrl}/rest/v1/rpc/get_linking_opportunities`, {
      method: "POST",
      headers: {
        "apikey": sbKey,
        "Authorization": `Bearer ${sbKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        p_date_from: currentDateStr,
        p_min_impressions: minImpressions,
        p_max_winner_position: maxWinnerPosition,
      }),
    });

    if (!res.ok) {
      console.error("Linking RPC error:", await res.text());
      return NextResponse.json({ opportunities: [], total: 0 });
    }

    interface RpcRow {
      query: string;
      country: string;
      winner_prop_id: string;
      winner_page: string;
      winner_position: number;
      winner_clicks: number;
      winner_impressions: number;
      linking_count: number;
      linkers: Array<{
        prop_id: string;
        page: string;
        position: number;
        impressions: number;
      }>;
    }

    const rpcData = (await res.json()) as RpcRow[];

    // Transform: resolve domains from prop_id, apply country filter
    const opportunities = rpcData
      .filter((row) => {
        if (countryFilter && row.country.toUpperCase() !== countryFilter.toUpperCase()) return false;
        // Winner must have a linked site
        const winnerSiteId = propToSite.get(row.winner_prop_id);
        return winnerSiteId && siteMap.has(winnerSiteId);
      })
      .map((row) => {
        const winnerSiteId = propToSite.get(row.winner_prop_id)!;
        const winnerSite = siteMap.get(winnerSiteId)!;

        const linkingSites = (row.linkers ?? [])
          .map((l) => {
            const siteId = propToSite.get(l.prop_id);
            if (!siteId) return null;
            const site = siteMap.get(siteId);
            if (!site) return null;
            return {
              domain: site.domain,
              page: l.page,
              position: Math.round(l.position * 10) / 10,
              impressions: l.impressions,
            };
          })
          .filter((l): l is NonNullable<typeof l> => l !== null);

        return {
          query: row.query,
          country: row.country,
          winner_domain: winnerSite.domain,
          winner_page: row.winner_page,
          winner_position: Math.round(row.winner_position * 10) / 10,
          winner_clicks: row.winner_clicks,
          winner_impressions: row.winner_impressions,
          linking_sites: linkingSites,
          potential_boost: linkingSites.length,
        };
      })
      .filter((o) => o.linking_sites.length > 0);

    const result = opportunities.slice(0, limit);

    return NextResponse.json({
      opportunities: result,
      total: opportunities.length,
      period: { days },
      thresholds: { min_impressions: minImpressions, max_winner_position: maxWinnerPosition },
    });
  } catch (err) {
    console.error("Linking opportunities error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/gsc/timeseries
 *
 * Returns daily clicks + impressions aggregated per site (or all sites).
 * Used by the dashboard chart.
 *
 * Query params:
 *   - days: number of days (default 28)
 *   - site_id: filter by specific site (optional)
 *   - granularity: "daily" (default) or "per_site" (one series per site)
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
    const days = parseInt(searchParams.get("days") ?? "28", 10);
    const siteId = searchParams.get("site_id");
    const granularity = searchParams.get("granularity") ?? "daily";

    // Get user's properties
    let propsQuery = supabase
      .from("gsc_properties")
      .select("id, site_id, site_url, sites(domain)")
      .eq("user_id", user.id)
      .eq("is_active", true);

    if (siteId) {
      propsQuery = propsQuery.eq("site_id", siteId);
    }

    const { data: properties } = await propsQuery;
    if (!properties || properties.length === 0) {
      return NextResponse.json({ series: [] });
    }

    const propIds = properties.map((p) => p.id);

    const sinceDate = new Date();
    sinceDate.setDate(sinceDate.getDate() - days);
    const dateStr = sinceDate.toISOString().split("T")[0];

    // Fetch raw data grouped by date
    const { data, error } = await supabase
      .from("gsc_search_data")
      .select("date, clicks, impressions, gsc_property_id")
      .in("gsc_property_id", propIds)
      .gte("date", dateStr);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const propToSite = new Map(
      properties.map((p) => [
        p.id,
        {
          site_id: p.site_id,
          domain: (p.sites as unknown as { domain: string })?.domain ?? p.site_url,
        },
      ])
    );

    if (granularity === "per_site") {
      // One series per site, each point = { date, clicks, impressions }
      const bySite = new Map<
        string,
        { domain: string; data: Map<string, { clicks: number; impressions: number }> }
      >();

      for (const row of data ?? []) {
        const site = propToSite.get(row.gsc_property_id);
        if (!site?.domain) continue;

        if (!bySite.has(site.domain)) {
          bySite.set(site.domain, { domain: site.domain, data: new Map() });
        }

        const entry = bySite.get(site.domain)!;
        const existing = entry.data.get(row.date) ?? { clicks: 0, impressions: 0 };
        existing.clicks += row.clicks;
        existing.impressions += row.impressions;
        entry.data.set(row.date, existing);
      }

      const series = Array.from(bySite.values()).map((s) => ({
        domain: s.domain,
        data: Array.from(s.data.entries())
          .map(([date, values]) => ({ date, ...values }))
          .sort((a, b) => a.date.localeCompare(b.date)),
      }));

      return NextResponse.json({ series });
    }

    // Default: aggregate all sites into one series
    const byDate = new Map<string, { clicks: number; impressions: number }>();

    for (const row of data ?? []) {
      const existing = byDate.get(row.date) ?? { clicks: 0, impressions: 0 };
      existing.clicks += row.clicks;
      existing.impressions += row.impressions;
      byDate.set(row.date, existing);
    }

    const series = Array.from(byDate.entries())
      .map(([date, values]) => ({ date, ...values }))
      .sort((a, b) => a.date.localeCompare(b.date));

    return NextResponse.json({ series });
  } catch (err) {
    console.error("Timeseries error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

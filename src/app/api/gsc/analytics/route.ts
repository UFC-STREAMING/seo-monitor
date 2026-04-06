import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

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
    const mode = searchParams.get("mode") ?? "traffic_drops";
    const days = parseInt(searchParams.get("days") ?? "7", 10);
    const propertyId = searchParams.get("property_id");

    // Get user's property IDs
    const { data: properties } = await supabase
      .from("gsc_properties")
      .select("id, site_url")
      .eq("user_id", user.id)
      .eq("is_active", true);

    if (!properties || properties.length === 0) {
      return NextResponse.json([]);
    }

    const validIds = propertyId
      ? properties.filter((p) => p.id === propertyId).map((p) => p.id)
      : properties.map((p) => p.id);

    if (validIds.length === 0) {
      return NextResponse.json({ error: "Property not found" }, { status: 404 });
    }

    const propertyUrlMap = new Map(properties.map((p) => [p.id, p.site_url]));

    switch (mode) {
      case "traffic_drops":
        return handleTrafficDrops(supabase, validIds, propertyUrlMap, days, searchParams);
      case "opportunities":
        return handleOpportunities(supabase, validIds, propertyUrlMap, days, searchParams);
      case "power_score":
        return handlePowerScore(supabase, validIds, propertyUrlMap, days, searchParams);
      default:
        return NextResponse.json({ error: "Invalid mode" }, { status: 400 });
    }
  } catch (err) {
    console.error("GSC analytics error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleTrafficDrops(
  supabase: any,
  propertyIds: string[],
  propertyUrlMap: Map<string, string>,
  days: number,
  searchParams: URLSearchParams,
) {
  const threshold = parseInt(searchParams.get("threshold") ?? "20", 10);

  const now = new Date();
  const currentStart = new Date(now);
  currentStart.setDate(currentStart.getDate() - days);
  const prevStart = new Date(currentStart);
  prevStart.setDate(prevStart.getDate() - days);

  const currentDateStr = currentStart.toISOString().split("T")[0];
  const prevDateStr = prevStart.toISOString().split("T")[0];

  // Fetch current period data (grouped by page)
  const { data: currentData } = await supabase
    .from("gsc_search_data")
    .select("page, clicks, gsc_property_id")
    .in("gsc_property_id", propertyIds)
    .gte("date", currentDateStr)
    .not("page", "is", null);

  // Fetch previous period data (grouped by page)
  const { data: prevData } = await supabase
    .from("gsc_search_data")
    .select("page, clicks, gsc_property_id")
    .in("gsc_property_id", propertyIds)
    .gte("date", prevDateStr)
    .lt("date", currentDateStr)
    .not("page", "is", null);

  // Aggregate by page
  const currentMap = new Map<string, { clicks: number; propertyId: string }>();
  (currentData ?? []).forEach((row: { page: string; clicks: number; gsc_property_id: string }) => {
    const existing = currentMap.get(row.page);
    if (existing) {
      existing.clicks += row.clicks;
    } else {
      currentMap.set(row.page, { clicks: row.clicks, propertyId: row.gsc_property_id });
    }
  });

  const prevMap = new Map<string, number>();
  (prevData ?? []).forEach((row: { page: string; clicks: number }) => {
    prevMap.set(row.page, (prevMap.get(row.page) ?? 0) + row.clicks);
  });

  // Find drops
  const drops: Array<{
    page: string;
    clicks_before: number;
    clicks_after: number;
    pct_change: number;
    property_site_url: string;
  }> = [];

  for (const [page, prevClicks] of prevMap) {
    if (prevClicks === 0) continue;
    const current = currentMap.get(page);
    const currentClicks = current?.clicks ?? 0;
    const pctChange = ((currentClicks - prevClicks) / prevClicks) * 100;

    if (pctChange < -threshold) {
      drops.push({
        page,
        clicks_before: prevClicks,
        clicks_after: currentClicks,
        pct_change: Math.round(pctChange * 10) / 10,
        property_site_url: propertyUrlMap.get(current?.propertyId ?? "") ?? "",
      });
    }
  }

  // Sort by worst drop first
  drops.sort((a, b) => a.pct_change - b.pct_change);

  // Fetch top queries for dropped pages (limit to top 20 drops)
  const topDrops = drops.slice(0, 50);
  const droppedPages = topDrops.map((d) => d.page);

  let topQueriesMap = new Map<string, Array<{ query: string; clicks: number }>>();
  if (droppedPages.length > 0) {
    const { data: queryData } = await supabase
      .from("gsc_search_data")
      .select("page, query, clicks")
      .in("gsc_property_id", propertyIds)
      .in("page", droppedPages)
      .gte("date", currentDateStr)
      .order("clicks", { ascending: false });

    (queryData ?? []).forEach((row: { page: string; query: string; clicks: number }) => {
      const existing = topQueriesMap.get(row.page) ?? [];
      if (existing.length < 5) {
        // Check for duplicates
        if (!existing.some((q) => q.query === row.query)) {
          existing.push({ query: row.query, clicks: row.clicks });
          topQueriesMap.set(row.page, existing);
        }
      }
    });
  }

  const result = topDrops.map((d) => ({
    ...d,
    top_queries: topQueriesMap.get(d.page) ?? [],
  }));

  return NextResponse.json(result);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleOpportunities(
  supabase: any,
  propertyIds: string[],
  propertyUrlMap: Map<string, string>,
  days: number,
  searchParams: URLSearchParams,
) {
  const minImpressions = parseInt(searchParams.get("min_impressions") ?? "100", 10);
  const minPosition = parseFloat(searchParams.get("min_position") ?? "5");
  const limit = parseInt(searchParams.get("limit") ?? "50", 10);

  const sinceDate = new Date();
  sinceDate.setDate(sinceDate.getDate() - days);
  const dateStr = sinceDate.toISOString().split("T")[0];

  const { data } = await supabase
    .from("gsc_search_data")
    .select("query, page, country, clicks, impressions, ctr, position, gsc_property_id")
    .in("gsc_property_id", propertyIds)
    .gte("date", dateStr);

  // Aggregate by query+country
  const aggregated = new Map<
    string,
    {
      query: string;
      country: string;
      total_impressions: number;
      total_clicks: number;
      sum_position: number;
      sum_ctr: number;
      count: number;
      top_page: string | null;
      top_page_clicks: number;
      property_site_url: string;
    }
  >();

  (data ?? []).forEach(
    (row: {
      query: string;
      country: string;
      clicks: number;
      impressions: number;
      ctr: number;
      position: number;
      page: string | null;
      gsc_property_id: string;
    }) => {
      const key = `${row.query}::${row.country}`;
      const existing = aggregated.get(key);

      if (!existing) {
        aggregated.set(key, {
          query: row.query,
          country: row.country,
          total_impressions: row.impressions,
          total_clicks: row.clicks,
          sum_position: row.position,
          sum_ctr: row.ctr,
          count: 1,
          top_page: row.page,
          top_page_clicks: row.clicks,
          property_site_url: propertyUrlMap.get(row.gsc_property_id) ?? "",
        });
      } else {
        existing.total_impressions += row.impressions;
        existing.total_clicks += row.clicks;
        existing.sum_position += row.position;
        existing.sum_ctr += row.ctr;
        existing.count++;
        if (row.clicks > existing.top_page_clicks) {
          existing.top_page = row.page;
          existing.top_page_clicks = row.clicks;
        }
      }
    }
  );

  const results = Array.from(aggregated.values())
    .map((a) => ({
      query: a.query,
      country: a.country,
      impressions: a.total_impressions,
      clicks: a.total_clicks,
      avg_position: Math.round((a.sum_position / a.count) * 10) / 10,
      avg_ctr: Math.round((a.sum_ctr / a.count) * 1000) / 1000,
      top_page: a.top_page,
      property_site_url: a.property_site_url,
    }))
    .filter((r) => r.avg_position > minPosition && r.impressions >= minImpressions)
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, limit);

  return NextResponse.json(results);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handlePowerScore(
  supabase: any,
  propertyIds: string[],
  propertyUrlMap: Map<string, string>,
  days: number,
  searchParams: URLSearchParams,
) {
  const minPosition = parseFloat(searchParams.get("min_position") ?? "10");
  const maxPosition = parseFloat(searchParams.get("max_position") ?? "100");
  const minImpressions = parseInt(searchParams.get("min_impressions") ?? "50", 10);
  const limit = parseInt(searchParams.get("limit") ?? "50", 10);

  const sinceDate = new Date();
  sinceDate.setDate(sinceDate.getDate() - days);
  const dateStr = sinceDate.toISOString().split("T")[0];

  const { data } = await supabase
    .from("gsc_search_data")
    .select("query, country, clicks, impressions, position, gsc_property_id")
    .in("gsc_property_id", propertyIds)
    .gte("date", dateStr);

  // Aggregate by query+country
  const aggregated = new Map<
    string,
    {
      query: string;
      country: string;
      total_impressions: number;
      total_clicks: number;
      sum_position: number;
      sum_ctr: number;
      count: number;
      property_site_url: string;
    }
  >();

  (data ?? []).forEach(
    (row: {
      query: string;
      country: string;
      clicks: number;
      impressions: number;
      position: number;
      gsc_property_id: string;
    }) => {
      const key = `${row.query}::${row.country}`;
      const existing = aggregated.get(key);

      if (!existing) {
        aggregated.set(key, {
          query: row.query,
          country: row.country,
          total_impressions: row.impressions,
          total_clicks: row.clicks,
          sum_position: row.position,
          sum_ctr: 0,
          count: 1,
          property_site_url: propertyUrlMap.get(row.gsc_property_id) ?? "",
        });
      } else {
        existing.total_impressions += row.impressions;
        existing.total_clicks += row.clicks;
        existing.sum_position += row.position;
        existing.count++;
      }
    }
  );

  const results = Array.from(aggregated.values())
    .map((a) => {
      const avgPosition = a.sum_position / a.count;
      const powerScore = a.total_impressions / Math.log(avgPosition + 1);
      const estimatedTrafficTop3 = Math.round(a.total_impressions * 0.25);

      return {
        query: a.query,
        country: a.country,
        impressions: a.total_impressions,
        clicks: a.total_clicks,
        avg_position: Math.round(avgPosition * 10) / 10,
        power_score: Math.round(powerScore),
        estimated_traffic_top3: estimatedTrafficTop3,
        property_site_url: a.property_site_url,
      };
    })
    .filter(
      (r) =>
        r.avg_position >= minPosition &&
        r.avg_position <= maxPosition &&
        r.impressions >= minImpressions
    )
    .sort((a, b) => b.power_score - a.power_score)
    .slice(0, limit);

  return NextResponse.json(results);
}

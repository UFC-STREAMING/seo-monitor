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
    const propertyId = searchParams.get("property_id");
    const country = searchParams.get("country");
    const minClicks = parseInt(searchParams.get("min_clicks") ?? "0", 10);
    const limit = parseInt(searchParams.get("limit") ?? "100", 10);
    const days = parseInt(searchParams.get("days") ?? "7", 10);
    const mode = searchParams.get("mode") ?? "top_queries"; // top_queries | top_pages | by_country

    // Get user's property IDs for security filtering
    const { data: properties } = await supabase
      .from("gsc_properties")
      .select("id")
      .eq("user_id", user.id);

    if (!properties || properties.length === 0) {
      return NextResponse.json([]);
    }

    const propertyIds = propertyId
      ? [propertyId]
      : properties.map((p) => p.id);

    // Verify ownership
    const validIds = propertyIds.filter((id) =>
      properties.some((p) => p.id === id)
    );

    if (validIds.length === 0) {
      return NextResponse.json({ error: "Property not found" }, { status: 404 });
    }

    const sinceDate = new Date();
    sinceDate.setDate(sinceDate.getDate() - days);
    const dateStr = sinceDate.toISOString().split("T")[0];

    let query = supabase
      .from("gsc_search_data")
      .select(
        "query, page, country, clicks, impressions, ctr, position, gsc_property_id, gsc_properties(site_url)"
      )
      .in("gsc_property_id", validIds)
      .gte("date", dateStr)
      .gte("clicks", minClicks)
      .order("clicks", { ascending: false })
      .limit(limit);

    if (country) {
      query = query.eq("country", country.toUpperCase());
    }

    const { data, error } = await query;

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Aggregate by query+country for top_queries mode
    if (mode === "top_queries") {
      const aggregated = new Map<
        string,
        {
          query: string;
          country: string;
          total_clicks: number;
          total_impressions: number;
          avg_position: number;
          avg_ctr: number;
          top_page: string | null;
          property_site_url: string;
          count: number;
        }
      >();

      (data ?? []).forEach((row) => {
        const key = `${row.query}::${row.country}`;
        const existing = aggregated.get(key);
        const siteUrl =
          (row.gsc_properties as unknown as { site_url: string })?.site_url ??
          "";

        if (!existing) {
          aggregated.set(key, {
            query: row.query,
            country: row.country,
            total_clicks: row.clicks,
            total_impressions: row.impressions,
            avg_position: row.position,
            avg_ctr: row.ctr,
            top_page: row.page,
            property_site_url: siteUrl,
            count: 1,
          });
        } else {
          existing.total_clicks += row.clicks;
          existing.total_impressions += row.impressions;
          existing.avg_position =
            (existing.avg_position * existing.count + row.position) /
            (existing.count + 1);
          existing.avg_ctr =
            (existing.avg_ctr * existing.count + row.ctr) /
            (existing.count + 1);
          if (row.clicks > 0 && (!existing.top_page || row.clicks > 0)) {
            existing.top_page = row.page;
          }
          existing.count++;
        }
      });

      const result = Array.from(aggregated.values())
        .sort((a, b) => b.total_clicks - a.total_clicks)
        .slice(0, limit);

      return NextResponse.json(result);
    }

    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

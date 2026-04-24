import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { NextRequest, NextResponse } from "next/server";
import { gscClient } from "@/lib/google/search-console";

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!gscClient.isConfigured()) {
      return NextResponse.json(
        { error: "Google Service Account not configured" },
        { status: 500 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const propertyId = body.property_id;

    // Get properties to sync
    let query = supabase
      .from("gsc_properties")
      .select("id, site_url")
      .eq("user_id", user.id)
      .eq("is_active", true);

    if (propertyId) {
      query = query.eq("id", propertyId);
    }

    const { data: properties, error } = await query;

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!properties || properties.length === 0) {
      return NextResponse.json({ message: "No properties to sync" });
    }

    const admin = createAdminClient();

    // Date range: last 90 days (to support 3-month view)
    const endDate = new Date();
    endDate.setDate(endDate.getDate() - 2); // GSC data has ~2 day delay
    const startDate = new Date(endDate);
    startDate.setDate(startDate.getDate() - 90);

    const startStr = startDate.toISOString().split("T")[0];
    const endStr = endDate.toISOString().split("T")[0];

    let totalRows = 0;
    let syncedProperties = 0;

    for (const prop of properties) {
      try {
        // Fetch with "date" dimension for per-day data
        const rows = await gscClient.searchAnalytics(
          prop.site_url,
          startStr,
          endStr,
          ["date", "query", "page", "country"],
          25000,
          "all" // fresh data (~4-6h delay)
        );

        if (rows.length > 0) {
          const CHUNK_SIZE = 500;
          for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
            const chunk = rows.slice(i, i + CHUNK_SIZE).map((row) => ({
              gsc_property_id: prop.id,
              date: row.keys[0], // actual date from GSC
              query: row.keys[1],
              page: row.keys[2] || "",
              country: (row.keys[3] || "ZZZ").toUpperCase(),
              clicks: row.clicks,
              impressions: row.impressions,
              ctr: row.ctr,
              position: row.position,
            }));

            const { error: upsertErr } = await admin
              .from("gsc_search_data")
              .upsert(chunk, {
                onConflict: "gsc_property_id,date,query,page,country",
                ignoreDuplicates: false,
              });

            if (upsertErr) {
              console.error(`Upsert error for ${prop.site_url}:`, upsertErr.message);
            }
          }

          totalRows += rows.length;
        }

        // Update last_synced_at
        await admin
          .from("gsc_properties")
          .update({ last_synced_at: new Date().toISOString() })
          .eq("id", prop.id);

        syncedProperties++;
      } catch (err) {
        console.error(`Failed to sync property ${prop.site_url}:`, err);
      }
    }

    // Log API usage
    await admin.from("api_usage_log").insert({
      user_id: user.id,
      service: "gsc",
      endpoint: "searchAnalytics/query",
      credits_used: syncedProperties,
      cost_usd: 0, // GSC API is free
    });

    return NextResponse.json({
      message: `Synced ${syncedProperties} properties, ${totalRows} data rows`,
      synced_properties: syncedProperties,
      total_rows: totalRows,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

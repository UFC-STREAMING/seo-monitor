import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { gscClient } from "@/lib/google/search-console";

export const maxDuration = 300;

export async function GET(request: Request) {
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

  // Get all active GSC properties
  const { data: properties, error } = await supabase
    .from("gsc_properties")
    .select("id, site_url, user_id, is_active")
    .eq("is_active", true);

  if (error || !properties || properties.length === 0) {
    return NextResponse.json({
      message: "No active GSC properties",
      error: error?.message,
    });
  }

  // Date range: last 7 days including TODAY (dataState: "all" gives fresh data)
  const endDate = new Date();
  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - 7);

  const startStr = startDate.toISOString().split("T")[0];
  const endStr = endDate.toISOString().split("T")[0];

  let totalRows = 0;
  let syncedProperties = 0;
  let failedProperties = 0;

  for (const prop of properties) {
    try {
      const rows = await gscClient.searchAnalytics(
        prop.site_url,
        startStr,
        endStr,
        ["date", "query", "page", "country"],
        25000,
        "all" // fresh data (~4-6h delay) instead of "final" (2-3j delay)
      );

      if (rows.length > 0) {
        const CHUNK_SIZE = 500;
        for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
          const chunk = rows.slice(i, i + CHUNK_SIZE).map((row) => ({
            gsc_property_id: prop.id,
            date: row.keys[0],
            query: row.keys[1],
            page: row.keys[2] || "",
            country: (row.keys[3] || "ZZZ").toUpperCase(),
            clicks: row.clicks,
            impressions: row.impressions,
            ctr: row.ctr,
            position: row.position,
          }));

          await supabase.from("gsc_search_data").upsert(chunk, {
            onConflict: "gsc_property_id,date,query,page,country",
            ignoreDuplicates: false,
          });
        }

        totalRows += rows.length;
      }

      await supabase
        .from("gsc_properties")
        .update({ last_synced_at: new Date().toISOString() })
        .eq("id", prop.id);

      syncedProperties++;
    } catch (err) {
      console.error(`Cron sync-gsc: failed for ${prop.site_url}:`, err);
      failedProperties++;
    }
  }

  // Auto-create sites for GSC properties without a linked site
  let sitesCreated = 0;
  {
    const { data: unlinkedProps } = await supabase
      .from("gsc_properties")
      .select("id, site_url, user_id")
      .is("site_id", null)
      .eq("is_active", true);

    if (unlinkedProps && unlinkedProps.length > 0) {
      for (const prop of unlinkedProps) {
        // Extract domain from site_url
        let domain = prop.site_url;
        if (domain.startsWith("sc-domain:")) {
          domain = domain.replace("sc-domain:", "");
        } else {
          try { domain = new URL(domain).hostname; } catch { continue; }
        }

        // Check if site already exists for this user+domain
        const { data: existingSite } = await supabase
          .from("sites")
          .select("id")
          .eq("user_id", prop.user_id)
          .eq("domain", domain)
          .maybeSingle();

        if (existingSite) {
          // Link existing site
          await supabase
            .from("gsc_properties")
            .update({ site_id: existingSite.id })
            .eq("id", prop.id);
          continue;
        }

        // Detect location_code from GSC data (country with most clicks)
        let locationCode: number | null = null;
        const { data: topCountry } = await supabase
          .from("gsc_search_data")
          .select("country")
          .eq("gsc_property_id", prop.id)
          .order("clicks", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (topCountry?.country) {
          const { data: mapping } = await supabase
            .from("country_code_mapping")
            .select("location_code")
            .eq("alpha3", topCountry.country.toUpperCase())
            .maybeSingle();
          locationCode = mapping?.location_code ?? null;
        }

        // Create the site
        const { data: newSite } = await supabase
          .from("sites")
          .insert({
            user_id: prop.user_id,
            domain,
            niche: "nutra",
            site_type: "nutra",
            location_code: locationCode,
          })
          .select("id")
          .single();

        if (newSite) {
          await supabase
            .from("gsc_properties")
            .update({ site_id: newSite.id })
            .eq("id", prop.id);
          sitesCreated++;
        }
      }
    }
  }

  // Run auto-detection for each user with active rules
  const userIds = [...new Set(properties.map((p) => p.user_id))];
  let autoDetectedTotal = 0;
  let autoAddedTotal = 0;

  for (const userId of userIds) {
    try {
      const { data: rules } = await supabase
        .from("gsc_auto_rules")
        .select("*")
        .eq("user_id", userId)
        .maybeSingle();

      const autoAddEnabled = rules?.auto_add_enabled ?? true;
      if (!autoAddEnabled) continue;

      const minClicksDaily = rules?.min_clicks_keyword ?? 5;
      const userProps = properties.filter((p) => p.user_id === userId);
      const propIds = userProps.map((p) => p.id);

      // Get country mappings
      const { data: countryMappings } = await supabase
        .from("country_code_mapping")
        .select("alpha3, location_code");

      const countryMap = new Map(
        (countryMappings ?? []).map((m) => [
          m.alpha3.toUpperCase(),
          m.location_code,
        ])
      );

      // Get user's sites
      const { data: userSites } = await supabase
        .from("sites")
        .select("id, location_code")
        .eq("user_id", userId);

      if (!userSites || userSites.length === 0) continue;

      // Get existing keywords
      const siteIds = userSites.map((s) => s.id);
      const { data: existingKw } = await supabase
        .from("keywords")
        .select("keyword, location_code, site_id")
        .in("site_id", siteIds);

      const existingSet = new Set(
        (existingKw ?? []).map(
          (k) =>
            `${k.keyword.toLowerCase()}::${k.location_code}::${k.site_id}`
        )
      );

      // Simple rule: keywords with minClicksDaily+ clicks on any single day
      const { data: hotKeywords } = await supabase
        .from("gsc_search_data")
        .select("query, country")
        .in("gsc_property_id", propIds)
        .gte("clicks", minClicksDaily)
        .limit(5000);

      // Deduplicate
      const seen = new Set<string>();
      const inserts: Array<{
        site_id: string;
        keyword: string;
        location_code: number;
      }> = [];

      (hotKeywords ?? []).forEach((row) => {
        const dedupKey = `${row.query.toLowerCase()}::${row.country}`;
        if (seen.has(dedupKey)) return;
        seen.add(dedupKey);

        const locationCode = countryMap.get(row.country.toUpperCase());
        if (!locationCode) return;

        autoDetectedTotal++;

        const matchingSites = userSites.filter(
          (s) => s.location_code === locationCode
        );

        matchingSites.forEach((s) => {
          const kwKey = `${row.query.toLowerCase()}::${locationCode}::${s.id}`;
          if (!existingSet.has(kwKey)) {
            inserts.push({
              site_id: s.id,
              keyword: row.query.trim(),
              location_code: locationCode,
            });
            existingSet.add(kwKey);
          }
        });
      });

      if (inserts.length > 0) {
        const CHUNK = 100;
        for (let i = 0; i < inserts.length; i += CHUNK) {
          const chunk = inserts.slice(i, i + CHUNK);
          const { error: insertError } = await supabase
            .from("keywords")
            .upsert(chunk, {
              onConflict: "site_id,keyword,location_code",
              ignoreDuplicates: true,
            });
          if (!insertError) {
            autoAddedTotal += chunk.length;
          }
        }
      }

      // Log API usage
      await supabase.from("api_usage_log").insert({
        user_id: userId,
        service: "gsc",
        endpoint: "cron/sync-gsc",
        credits_used: userProps.length,
        cost_usd: 0,
      });
    } catch (err) {
      console.error(`Cron sync-gsc: auto-detect failed for user ${userId}:`, err);
    }
  }

  return NextResponse.json({
    synced_properties: syncedProperties,
    failed_properties: failedProperties,
    total_rows: totalRows,
    auto_detected: autoDetectedTotal,
    auto_added: autoAddedTotal,
  });
}

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { NextResponse } from "next/server";

export async function POST() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const admin = createAdminClient();

    // Get user's rules (or defaults)
    const { data: rules } = await supabase
      .from("gsc_auto_rules")
      .select("*")
      .eq("user_id", user.id)
      .single();

    const minClicksDaily = rules?.min_clicks_keyword ?? 5;
    const autoAddEnabled = rules?.auto_add_enabled ?? true;

    if (!autoAddEnabled) {
      return NextResponse.json({
        message: "Auto-add is disabled",
        detected: 0,
        added: 0,
      });
    }

    // Get user's active GSC properties
    const { data: properties } = await supabase
      .from("gsc_properties")
      .select("id, site_url, site_id")
      .eq("user_id", user.id)
      .eq("is_active", true);

    if (!properties || properties.length === 0) {
      return NextResponse.json({
        message: "No active GSC properties",
        detected: 0,
        added: 0,
      });
    }

    // Get country code mapping
    const { data: countryMappings } = await admin
      .from("country_code_mapping")
      .select("alpha3, alpha2, location_code");

    const countryMap = new Map(
      (countryMappings ?? []).map((m) => [
        m.alpha3.toUpperCase(),
        { alpha2: m.alpha2, locationCode: m.location_code },
      ])
    );

    // Get user's sites
    const { data: userSites } = await supabase
      .from("sites")
      .select("id, domain, location_code")
      .eq("user_id", user.id);

    if (!userSites || userSites.length === 0) {
      return NextResponse.json({
        message: "No sites configured",
        detected: 0,
        added: 0,
      });
    }

    // Get existing keywords to avoid duplicates
    const { data: existingKeywords } = await supabase
      .from("keywords")
      .select("keyword, location_code, site_id")
      .in(
        "site_id",
        userSites.map((s) => s.id)
      );

    const existingSet = new Set(
      (existingKeywords ?? []).map(
        (k) => `${k.keyword.toLowerCase()}::${k.location_code}::${k.site_id}`
      )
    );

    let detected = 0;
    let added = 0;
    const propertyIds = properties.map((p) => p.id);

    // Simple rule: any keyword with >= minClicksDaily clicks on a single day
    const { data: hotKeywords } = await admin
      .from("gsc_search_data")
      .select("query, country, clicks, gsc_property_id")
      .in("gsc_property_id", propertyIds)
      .gte("clicks", minClicksDaily)
      .order("clicks", { ascending: false })
      .limit(5000);

    // Deduplicate by (query, country) — keep highest clicks
    const seen = new Map<
      string,
      { query: string; country: string; clicks: number }
    >();

    (hotKeywords ?? []).forEach((row) => {
      const key = `${row.query.toLowerCase()}::${row.country}`;
      const existing = seen.get(key);
      if (!existing || row.clicks > existing.clicks) {
        seen.set(key, {
          query: row.query,
          country: row.country,
          clicks: row.clicks,
        });
      }
    });

    // Build insert list
    const inserts: Array<{
      site_id: string;
      keyword: string;
      location_code: number;
    }> = [];

    seen.forEach(({ query, country }) => {
      const mapping = countryMap.get(country.toUpperCase());
      if (!mapping?.locationCode) return;

      const locationCode = mapping.locationCode;
      detected++;

      const matchingSites = userSites.filter(
        (s) => s.location_code === locationCode
      );

      matchingSites.forEach((site) => {
        const dedupKey = `${query.toLowerCase()}::${locationCode}::${site.id}`;
        if (!existingSet.has(dedupKey)) {
          inserts.push({
            site_id: site.id,
            keyword: query.trim(),
            location_code: locationCode,
          });
          existingSet.add(dedupKey);
        }
      });
    });

    // Insert in chunks
    if (inserts.length > 0) {
      const CHUNK_SIZE = 100;
      for (let i = 0; i < inserts.length; i += CHUNK_SIZE) {
        const chunk = inserts.slice(i, i + CHUNK_SIZE);
        const { error } = await admin.from("keywords").upsert(chunk, {
          onConflict: "site_id,keyword,location_code",
          ignoreDuplicates: true,
        });

        if (!error) {
          added += chunk.length;
        }
      }
    }

    return NextResponse.json({
      message: `${detected} keywords with ${minClicksDaily}+ clicks/day found, ${added} new keywords added`,
      detected,
      added,
      threshold: minClicksDaily,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

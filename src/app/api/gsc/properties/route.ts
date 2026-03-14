import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { NextRequest, NextResponse } from "next/server";
import { gscClient } from "@/lib/google/search-console";

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
    const days = parseInt(searchParams.get("days") ?? "7", 10);

    // Get properties with aggregated stats
    const { data: properties, error } = await supabase
      .from("gsc_properties")
      .select("*, sites(domain, niche, site_type)")
      .eq("user_id", user.id)
      .order("site_url");

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const propertyIds = (properties ?? []).map((p) => p.id);

    if (propertyIds.length > 0) {
      const sinceDate = new Date();
      sinceDate.setDate(sinceDate.getDate() - days);
      const dateStr = sinceDate.toISOString().split("T")[0];

      const { data: stats } = await supabase
        .from("gsc_search_data")
        .select("gsc_property_id, clicks, impressions")
        .in("gsc_property_id", propertyIds)
        .gte("date", dateStr);

      // Aggregate stats per property
      const statsMap = new Map<
        string,
        { clicks: number; impressions: number }
      >();
      (stats ?? []).forEach((row) => {
        const existing = statsMap.get(row.gsc_property_id) ?? {
          clicks: 0,
          impressions: 0,
        };
        existing.clicks += row.clicks;
        existing.impressions += row.impressions;
        statsMap.set(row.gsc_property_id, existing);
      });

      const enriched = (properties ?? []).map((p) => ({
        ...p,
        stats_7d: statsMap.get(p.id) ?? { clicks: 0, impressions: 0 },
      }));

      return NextResponse.json(enriched);
    }

    return NextResponse.json(
      (properties ?? []).map((p) => ({
        ...p,
        stats_7d: { clicks: 0, impressions: 0 },
      }))
    );
  } catch (err) {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/** Sync properties from GSC API */
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

    if (!gscClient.isConfigured()) {
      return NextResponse.json(
        { error: "Google Service Account not configured" },
        { status: 500 }
      );
    }

    const sites = await gscClient.listSites();

    if (sites.length === 0) {
      return NextResponse.json({
        message: "No GSC properties found. Add the service account as a user on your GSC properties.",
        service_account: gscClient.getServiceAccountEmail(),
      });
    }

    // Upsert properties
    const toUpsert = sites.map((site) => ({
      user_id: user.id,
      site_url: site.siteUrl,
      permission_level: site.permissionLevel,
    }));

    const { error } = await supabase
      .from("gsc_properties")
      .upsert(toUpsert, { onConflict: "user_id,site_url" });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Auto-link to existing sites by domain matching
    const { data: properties } = await supabase
      .from("gsc_properties")
      .select("id, site_url, site_id")
      .eq("user_id", user.id);

    const { data: userSites } = await supabase
      .from("sites")
      .select("id, domain")
      .eq("user_id", user.id);

    let sitesCreated = 0;
    const admin = createAdminClient();

    if (properties && userSites) {
      for (const prop of properties) {
        if (prop.site_id) continue; // already linked

        // Extract domain from site_url (e.g. "sc-domain:example.com" or "https://example.com/")
        let propDomain = prop.site_url;
        if (propDomain.startsWith("sc-domain:")) {
          propDomain = propDomain.replace("sc-domain:", "");
        } else {
          try {
            propDomain = new URL(propDomain).hostname;
          } catch {
            continue;
          }
        }

        const match = userSites.find(
          (s) =>
            s.domain === propDomain ||
            s.domain === `www.${propDomain}` ||
            `www.${s.domain}` === propDomain
        );

        if (match) {
          await supabase
            .from("gsc_properties")
            .update({ site_id: match.id })
            .eq("id", prop.id);
        } else {
          // Auto-create site for unlinked GSC property
          // Detect location_code from GSC data (country with most clicks)
          let locationCode: number | null = null;
          const { data: topCountry } = await admin
            .from("gsc_search_data")
            .select("country")
            .eq("gsc_property_id", prop.id)
            .order("clicks", { ascending: false })
            .limit(1)
            .maybeSingle();

          if (topCountry?.country) {
            const { data: mapping } = await admin
              .from("country_code_mapping")
              .select("location_code")
              .eq("alpha3", topCountry.country.toUpperCase())
              .maybeSingle();
            locationCode = mapping?.location_code ?? null;
          }

          const { data: newSite } = await supabase
            .from("sites")
            .insert({
              user_id: user.id,
              domain: propDomain,
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
            userSites.push({ id: newSite.id, domain: propDomain });
            sitesCreated++;

            // Auto-copy existing keywords for this location
            if (locationCode) {
              const { data: existingKws } = await supabase
                .from("keywords")
                .select("keyword, location_code")
                .eq("location_code", locationCode)
                .neq("site_id", newSite.id);

              const unique = new Map<string, { keyword: string; location_code: number }>();
              (existingKws ?? []).forEach((k) => {
                if (!unique.has(k.keyword)) {
                  unique.set(k.keyword, { keyword: k.keyword, location_code: k.location_code });
                }
              });

              if (unique.size > 0) {
                const kwInserts = Array.from(unique.values()).map((kw) => ({
                  site_id: newSite.id,
                  keyword: kw.keyword,
                  location_code: kw.location_code,
                }));
                await supabase.from("keywords").insert(kwInserts);
              }
            }
          }
        }
      }
    }

    return NextResponse.json({
      message: `Synced ${sites.length} properties, created ${sitesCreated} sites`,
      count: sites.length,
      sites_created: sitesCreated,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** Link a property to a site or toggle active */
export async function PATCH(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { property_id, site_id, is_active } = body;

    if (!property_id) {
      return NextResponse.json(
        { error: "property_id is required" },
        { status: 400 }
      );
    }

    const update: Record<string, unknown> = {};
    if (site_id !== undefined) update.site_id = site_id;
    if (is_active !== undefined) update.is_active = is_active;

    const { error } = await supabase
      .from("gsc_properties")
      .update(update)
      .eq("id", property_id)
      .eq("user_id", user.id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ message: "Updated" });
  } catch (err) {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

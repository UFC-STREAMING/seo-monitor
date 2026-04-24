import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createNutraFactoryClient } from "@/lib/supabase/nutra-factory";
import { sendTelegramMessage, formatBrandAlert } from "@/lib/telegram";

export const maxDuration = 300;

const HOT_THRESHOLD = 300;     // impressions/semaine pour devenir HOT
const COOLING_THRESHOLD = 100; // impressions/semaine pour passer COOLING
const COOLING_WEEKS_TO_REMOVE = 3;

/**
 * GET /api/cron/brand-tracking
 *
 * Cron hebdomadaire : détecte les brands qui montent/descendent en tendance.
 *
 * 1. Récupère les noms de produits depuis Nutra Factory
 * 2. Agrège les impressions GSC par brand + country (semaine courante vs précédente)
 * 3. Applique les seuils d'entrée (HOT) et de sortie (COOLING → REMOVED)
 */
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();

  // --- 1. Récupérer les brands depuis Nutra Factory ---
  let brands: Array<{
    id: string;
    product_name: string;
    category: string | null;
    countries: string[] | null;
    affiliate_url: string | null;
    active: boolean;
  }> = [];
  try {
    const nutra = createNutraFactoryClient();
    const { data, error } = await nutra
      .from("products")
      .select("id, product_name, category, countries, affiliate_url, active")
      .not("product_name", "is", null);

    if (error) throw error;
    brands = (data ?? [])
      .filter((p) => p.product_name && p.product_name.trim().length >= 2)
      .map((p) => ({
        id: p.id,
        product_name: p.product_name,
        category: p.category ?? null,
        countries: p.countries ?? null,
        affiliate_url: p.affiliate_url ?? null,
        active: p.active ?? true,
      }));
  } catch (err) {
    console.error("Brand tracking: failed to fetch Nutra Factory products:", err);
    return NextResponse.json({ error: "Failed to fetch products from Nutra Factory" }, { status: 500 });
  }

  if (brands.length === 0) {
    return NextResponse.json({ message: "No brands found in Nutra Factory" });
  }

  // --- 2. Récupérer les données GSC des 14 derniers jours ---
  const now = new Date();
  const currentWeekEnd = new Date(now);
  currentWeekEnd.setDate(currentWeekEnd.getDate() - 2); // GSC delay
  const currentWeekStart = new Date(currentWeekEnd);
  currentWeekStart.setDate(currentWeekStart.getDate() - 7);
  const prevWeekStart = new Date(currentWeekStart);
  prevWeekStart.setDate(prevWeekStart.getDate() - 7);

  const currentStartStr = currentWeekStart.toISOString().split("T")[0];
  const currentEndStr = currentWeekEnd.toISOString().split("T")[0];
  const prevStartStr = prevWeekStart.toISOString().split("T")[0];

  // Fetch all GSC data for the 2-week window
  const { data: gscData, error: gscError } = await supabase
    .from("gsc_search_data")
    .select("query, country, impressions, date")
    .gte("date", prevStartStr)
    .lte("date", currentEndStr);

  if (gscError) {
    console.error("Brand tracking: GSC fetch error:", gscError);
    return NextResponse.json({ error: "Failed to fetch GSC data" }, { status: 500 });
  }

  // --- 3. Agréger par brand + country ---
  // Normaliser les noms de brands pour le matching
  const brandMap = new Map<string, {
    id: string;
    name: string;
    category: string | null;
    countries: string[] | null;
    affiliateUrl: string | null;
    active: boolean;
  }>();
  for (const b of brands) {
    const normalized = b.product_name.trim().toLowerCase();
    brandMap.set(normalized, {
      id: b.id,
      name: b.product_name.trim(),
      category: b.category,
      countries: b.countries,
      affiliateUrl: b.affiliate_url,
      active: b.active,
    });
  }

  // Structure: brand_key → { current_impressions, previous_impressions }
  interface BrandGeo {
    brandName: string;
    nutraProductId: string;
    country: string;
    currentImpressions: number;
    previousImpressions: number;
    category: string | null;
    productCountries: string[] | null;
    affiliateUrl: string | null;
    productActive: boolean;
  }

  const brandGeoMap = new Map<string, BrandGeo>();

  for (const row of gscData ?? []) {
    const queryLower = row.query.toLowerCase();
    const isCurrentWeek = row.date >= currentStartStr && row.date <= currentEndStr;
    const isPrevWeek = row.date >= prevStartStr && row.date < currentStartStr;

    if (!isCurrentWeek && !isPrevWeek) continue;

    // Check if this query contains any known brand name
    for (const [normalized, brand] of brandMap) {
      if (!queryLower.includes(normalized)) continue;

      const key = `${normalized}::${row.country}`;
      const existing = brandGeoMap.get(key);

      if (existing) {
        if (isCurrentWeek) existing.currentImpressions += row.impressions;
        if (isPrevWeek) existing.previousImpressions += row.impressions;
      } else {
        brandGeoMap.set(key, {
          brandName: brand.name,
          nutraProductId: brand.id,
          country: row.country,
          currentImpressions: isCurrentWeek ? row.impressions : 0,
          previousImpressions: isPrevWeek ? row.impressions : 0,
          category: brand.category,
          productCountries: brand.countries,
          affiliateUrl: brand.affiliateUrl,
          productActive: brand.active,
        });
      }
    }
  }

  // --- 4. Appliquer les seuils et mettre à jour brand_tracking ---
  let newHot = 0;
  let updatedHot = 0;
  let newCooling = 0;
  let removed = 0;

  // Track changes for Telegram notification
  const telegramNewHot: Array<{ brand: string; country: string; impressions: number }> = [];
  const telegramNewCooling: Array<{ brand: string; country: string; impressions: number }> = [];

  // Get existing tracking entries
  const { data: existingTracking } = await supabase
    .from("brand_tracking")
    .select("*")
    .in("status", ["hot", "cooling"]);

  const existingMap = new Map(
    (existingTracking ?? []).map((t) => [`${t.brand_name.toLowerCase()}::${t.country}`, t])
  );

  // Process each brand+geo combination
  for (const [key, data] of brandGeoMap) {
    const existing = existingMap.get(key);

    if (data.currentImpressions >= HOT_THRESHOLD) {
      // Brand is HOT
      if (existing) {
        // Update existing entry
        await supabase
          .from("brand_tracking")
          .update({
            status: "hot",
            impressions_current_week: data.currentImpressions,
            impressions_previous_week: data.previousImpressions,
            cooling_since: null,
            nutra_product_id: data.nutraProductId,
            product_category: data.category,
            product_countries: data.productCountries,
            product_active: data.productActive,
            affiliate_url: data.affiliateUrl,
            last_enriched_at: new Date().toISOString(),
          })
          .eq("id", existing.id);
        updatedHot++;
      } else {
        // New HOT brand
        await supabase
          .from("brand_tracking")
          .upsert({
            brand_name: data.brandName,
            nutra_product_id: data.nutraProductId,
            country: data.country,
            status: "hot",
            impressions_current_week: data.currentImpressions,
            impressions_previous_week: data.previousImpressions,
            entered_at: new Date().toISOString(),
            product_category: data.category,
            product_countries: data.productCountries,
            product_active: data.productActive,
            affiliate_url: data.affiliateUrl,
            last_enriched_at: new Date().toISOString(),
          }, {
            onConflict: "brand_name,country",
          });
        newHot++;
        telegramNewHot.push({ brand: data.brandName, country: data.country, impressions: data.currentImpressions });
      }
      existingMap.delete(key);
    } else if (existing && data.currentImpressions < COOLING_THRESHOLD) {
      // Brand was tracked, now cooling
      const coolingSince = existing.cooling_since ?? new Date().toISOString();
      await supabase
        .from("brand_tracking")
        .update({
          status: "cooling",
          impressions_current_week: data.currentImpressions,
          impressions_previous_week: data.previousImpressions,
          cooling_since: coolingSince,
        })
        .eq("id", existing.id);
      newCooling++;
      if (existing.status === "hot") {
        telegramNewCooling.push({ brand: data.brandName, country: data.country, impressions: data.currentImpressions });
      }
      existingMap.delete(key);
    } else if (existing) {
      // Between thresholds — keep current status, just update impressions
      await supabase
        .from("brand_tracking")
        .update({
          impressions_current_week: data.currentImpressions,
          impressions_previous_week: data.previousImpressions,
        })
        .eq("id", existing.id);
      existingMap.delete(key);
    }
  }

  // Handle tracked brands that had ZERO impressions this period
  for (const [, existing] of existingMap) {
    const coolingSince = existing.cooling_since ?? new Date().toISOString();
    await supabase
      .from("brand_tracking")
      .update({
        status: "cooling",
        impressions_current_week: 0,
        impressions_previous_week: existing.impressions_current_week,
        cooling_since: coolingSince,
      })
      .eq("id", existing.id);
    newCooling++;
  }

  // --- 5. Remove brands cooling for too long ---
  const removeThreshold = new Date();
  removeThreshold.setDate(removeThreshold.getDate() - COOLING_WEEKS_TO_REMOVE * 7);

  const { data: toRemove } = await supabase
    .from("brand_tracking")
    .select("id")
    .eq("status", "cooling")
    .lt("cooling_since", removeThreshold.toISOString());

  if (toRemove && toRemove.length > 0) {
    await supabase
      .from("brand_tracking")
      .update({ status: "removed" })
      .in("id", toRemove.map((r) => r.id));
    removed = toRemove.length;
  }

  // --- 6. Créer des alertes en base ---
  // Get a user_id for the alerts (first active GSC property owner)
  const { data: firstProp } = await supabase
    .from("gsc_properties")
    .select("user_id")
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();

  if (firstProp) {
    const alertInserts = [];
    for (const b of telegramNewHot) {
      alertInserts.push({
        alert_type: "brand_hot" as const,
        severity: "info" as const,
        message: `Brand "${b.brand}" devenue HOT en ${b.country} (${b.impressions.toLocaleString()} imp/sem)`,
      });
    }
    for (const b of telegramNewCooling) {
      alertInserts.push({
        alert_type: "brand_cooling" as const,
        severity: "warning" as const,
        message: `Brand "${b.brand}" en refroidissement en ${b.country} (${b.impressions.toLocaleString()} imp/sem)`,
      });
    }
    if (alertInserts.length > 0) {
      await supabase.from("alerts").insert(alertInserts);
    }
  }

  // --- 7. Notification Telegram ---
  const telegramMsg = formatBrandAlert({
    newHot: telegramNewHot,
    newCooling: telegramNewCooling,
    removed,
  });
  let telegramSent = false;
  if (telegramMsg) {
    telegramSent = await sendTelegramMessage(telegramMsg);
  }

  return NextResponse.json({
    brands_scanned: brands.length,
    gsc_rows_analyzed: (gscData ?? []).length,
    brand_geo_combinations: brandGeoMap.size,
    new_hot: newHot,
    updated_hot: updatedHot,
    new_cooling: newCooling,
    removed,
    telegram_sent: telegramSent,
    thresholds: { hot: HOT_THRESHOLD, cooling: COOLING_THRESHOLD, remove_after_weeks: COOLING_WEEKS_TO_REMOVE },
  });
}

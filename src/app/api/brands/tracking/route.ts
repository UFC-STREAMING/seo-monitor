import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { BrandStatus } from "@/types/database";

export const maxDuration = 30;

/**
 * GET /api/brands/tracking
 *
 * Retourne les brands trackées avec leur statut et métriques.
 * Utilisé par Hermes (via CRON_SECRET) et le dashboard (via session).
 *
 * Query params:
 *   - status: "hot" | "cooling" | "removed" | "all" (défaut: "hot")
 *   - country: filtrer par pays alpha3 (optionnel)
 *   - sort: "impressions" | "position" | "entered" (défaut: "impressions")
 *   - limit: nombre max de résultats (défaut: 50)
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = createAdminClient();

    // Auth: soit CRON_SECRET (pour Hermes), soit session user
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
    const statusParam = searchParams.get("status") ?? "hot";
    const status = statusParam as BrandStatus | "all";
    const country = searchParams.get("country");
    const sort = searchParams.get("sort") ?? "impressions";
    const limit = parseInt(searchParams.get("limit") ?? "50", 10);

    let query = supabase
      .from("brand_tracking")
      .select("*");

    if (status !== "all") {
      query = query.eq("status", status);
    }

    if (country) {
      query = query.eq("country", country.toUpperCase());
    }

    // Sort
    switch (sort) {
      case "position":
        query = query.order("dataforseo_position", { ascending: true, nullsFirst: false });
        break;
      case "entered":
        query = query.order("entered_at", { ascending: false });
        break;
      default:
        query = query.order("impressions_current_week", { ascending: false });
    }

    query = query.limit(limit);

    const { data: brands, error } = await query;

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Compute trend for each brand
    const result = (brands ?? []).map((b) => {
      const trend = b.impressions_previous_week > 0
        ? ((b.impressions_current_week - b.impressions_previous_week) / b.impressions_previous_week) * 100
        : b.impressions_current_week > 0 ? 100 : 0;

      return {
        ...b,
        trend_pct: Math.round(trend * 10) / 10,
      };
    });

    // Summary stats
    const { count: hotCount } = await supabase
      .from("brand_tracking")
      .select("*", { count: "exact", head: true })
      .eq("status", "hot");

    const { count: coolingCount } = await supabase
      .from("brand_tracking")
      .select("*", { count: "exact", head: true })
      .eq("status", "cooling");

    return NextResponse.json({
      brands: result,
      total: result.length,
      summary: {
        hot: hotCount ?? 0,
        cooling: coolingCount ?? 0,
      },
    });
  } catch (err) {
    console.error("Brands tracking error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

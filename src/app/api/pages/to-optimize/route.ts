import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 60;

/**
 * GET /api/pages/to-optimize
 *
 * Retourne les pages qui nécessitent une optimisation de contenu.
 * Utilisé par l'agent Hermes pour déclencher automatiquement
 * l'amélioration de contenu SEO.
 *
 * Critères de détection :
 * 1. CHUTE : pages avec une baisse de clics > threshold% vs période précédente
 * 2. OPPORTUNITÉ : pages avec beaucoup d'impressions mais position > 3 (pas dans le top 3)
 * 3. CTR FAIBLE : pages avec impressions élevées mais CTR < 2% (title/meta à revoir)
 *
 * Query params:
 *   - days: période d'analyse (défaut: 14)
 *   - drop_threshold: % de chute pour détecter (défaut: 20)
 *   - min_impressions: minimum d'impressions pour considérer (défaut: 50)
 *   - min_position: position minimum pour opportunité (défaut: 3)
 *   - limit: nombre max de résultats (défaut: 20)
 *   - property_id: filtrer par propriété GSC (optionnel)
 *
 * Auth: Bearer token (CRON_SECRET) ou Supabase session
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = createAdminClient();

    // Auth: soit CRON_SECRET (pour l'agent), soit session user
    const authHeader = request.headers.get("authorization");
    const isCron = authHeader === `Bearer ${process.env.CRON_SECRET}`;

    if (!isCron) {
      // Vérifier session Supabase
      const { createClient } = await import("@/lib/supabase/server");
      const userSupabase = await createClient();
      const { data: { user }, error } = await userSupabase.auth.getUser();
      if (error || !user) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
    }

    const { searchParams } = new URL(request.url);
    const days = parseInt(searchParams.get("days") ?? "14", 10);
    const dropThreshold = parseInt(searchParams.get("drop_threshold") ?? "20", 10);
    const minImpressions = parseInt(searchParams.get("min_impressions") ?? "50", 10);
    const minPosition = parseFloat(searchParams.get("min_position") ?? "3");
    const limit = parseInt(searchParams.get("limit") ?? "20", 10);
    const propertyId = searchParams.get("property_id");

    // Récupérer les propriétés actives
    let query = supabase
      .from("gsc_properties")
      .select("id, site_url")
      .eq("is_active", true);

    if (propertyId) {
      query = query.eq("id", propertyId);
    }

    const { data: properties } = await query;

    if (!properties || properties.length === 0) {
      return NextResponse.json({ pages: [], total: 0 });
    }

    const propIds = properties.map((p) => p.id);
    const propertyUrlMap = new Map(properties.map((p) => [p.id, p.site_url]));

    const now = new Date();
    const currentStart = new Date(now);
    currentStart.setDate(currentStart.getDate() - days);
    const prevStart = new Date(currentStart);
    prevStart.setDate(prevStart.getDate() - days);

    const currentDateStr = currentStart.toISOString().split("T")[0];
    const prevDateStr = prevStart.toISOString().split("T")[0];

    // Données période actuelle
    const { data: currentData } = await supabase
      .from("gsc_search_data")
      .select("page, query, clicks, impressions, ctr, position, gsc_property_id")
      .in("gsc_property_id", propIds)
      .gte("date", currentDateStr)
      .not("page", "is", null);

    // Données période précédente
    const { data: prevData } = await supabase
      .from("gsc_search_data")
      .select("page, clicks, impressions")
      .in("gsc_property_id", propIds)
      .gte("date", prevDateStr)
      .lt("date", currentDateStr)
      .not("page", "is", null);

    // Agréger par page (période actuelle)
    const currentPages = new Map<string, {
      clicks: number;
      impressions: number;
      sumPosition: number;
      sumCtr: number;
      count: number;
      propertyId: string;
      topQueries: Array<{ query: string; clicks: number; impressions: number; position: number }>;
    }>();

    interface GscRow {
      page: string | null;
      query: string;
      clicks: number;
      impressions: number;
      ctr: number;
      position: number;
      gsc_property_id: string;
    }

    (currentData ?? []).forEach((row: GscRow) => {
      if (!row.page) return;
      const existing = currentPages.get(row.page);
      if (existing) {
        existing.clicks += row.clicks;
        existing.impressions += row.impressions;
        existing.sumPosition += row.position;
        existing.sumCtr += row.ctr;
        existing.count++;
        existing.topQueries.push({
          query: row.query,
          clicks: row.clicks,
          impressions: row.impressions,
          position: row.position,
        });
      } else {
        currentPages.set(row.page, {
          clicks: row.clicks,
          impressions: row.impressions,
          sumPosition: row.position,
          sumCtr: row.ctr,
          count: 1,
          propertyId: row.gsc_property_id,
          topQueries: [{
            query: row.query,
            clicks: row.clicks,
            impressions: row.impressions,
            position: row.position,
          }],
        });
      }
    });

    // Agréger par page (période précédente)
    const prevPages = new Map<string, { clicks: number; impressions: number }>();
    (prevData ?? []).forEach((row: { page: string | null; clicks: number; impressions: number }) => {
      if (!row.page) return;
      const existing = prevPages.get(row.page);
      if (existing) {
        existing.clicks += row.clicks;
        existing.impressions += row.impressions;
      } else {
        prevPages.set(row.page, { clicks: row.clicks, impressions: row.impressions });
      }
    });

    // Analyser et classifier les pages
    const pagesToOptimize: Array<{
      page: string;
      site_url: string;
      reason: "drop" | "opportunity" | "low_ctr";
      priority: "critical" | "high" | "medium";
      clicks: number;
      impressions: number;
      avg_position: number;
      avg_ctr: number;
      clicks_change_pct: number | null;
      top_queries: Array<{ query: string; clicks: number; impressions: number; position: number }>;
      recommendation: string;
    }> = [];

    for (const [page, data] of currentPages) {
      const avgPosition = data.sumPosition / data.count;
      const avgCtr = data.sumCtr / data.count;
      const prev = prevPages.get(page);
      const clicksChangePct = prev && prev.clicks > 0
        ? ((data.clicks - prev.clicks) / prev.clicks) * 100
        : null;

      // Top 5 queries triées par impressions
      const topQueries = data.topQueries
        .sort((a, b) => b.impressions - a.impressions)
        .slice(0, 5);

      const siteUrl = propertyUrlMap.get(data.propertyId) ?? "";

      // 1. CHUTE BRUTALE : baisse > threshold%
      if (clicksChangePct !== null && clicksChangePct < -dropThreshold && (prev?.clicks ?? 0) >= 10) {
        pagesToOptimize.push({
          page,
          site_url: siteUrl,
          reason: "drop",
          priority: clicksChangePct < -50 ? "critical" : "high",
          clicks: data.clicks,
          impressions: data.impressions,
          avg_position: Math.round(avgPosition * 10) / 10,
          avg_ctr: Math.round(avgCtr * 1000) / 1000,
          clicks_change_pct: Math.round(clicksChangePct * 10) / 10,
          top_queries: topQueries,
          recommendation: `Chute de ${Math.abs(Math.round(clicksChangePct))}% des clics. Scraper la SERP pour les mots-clés principaux et enrichir le contenu pour regagner les positions perdues.`,
        });
        continue;
      }

      // 2. OPPORTUNITÉ : impressions élevées + position > 3
      if (data.impressions >= minImpressions && avgPosition > minPosition && avgPosition <= 20) {
        pagesToOptimize.push({
          page,
          site_url: siteUrl,
          reason: "opportunity",
          priority: data.impressions > 500 ? "high" : "medium",
          clicks: data.clicks,
          impressions: data.impressions,
          avg_position: Math.round(avgPosition * 10) / 10,
          avg_ctr: Math.round(avgCtr * 1000) / 1000,
          clicks_change_pct: clicksChangePct ? Math.round(clicksChangePct * 10) / 10 : null,
          top_queries: topQueries,
          recommendation: `Position ${Math.round(avgPosition * 10) / 10} avec ${data.impressions} impressions. Améliorer le contenu pour passer dans le top 3 et capter ~25% du trafic.`,
        });
        continue;
      }

      // 3. CTR FAIBLE : impressions élevées + CTR < 2%
      if (data.impressions >= minImpressions * 2 && avgCtr < 0.02 && avgPosition <= 10) {
        pagesToOptimize.push({
          page,
          site_url: siteUrl,
          reason: "low_ctr",
          priority: "medium",
          clicks: data.clicks,
          impressions: data.impressions,
          avg_position: Math.round(avgPosition * 10) / 10,
          avg_ctr: Math.round(avgCtr * 1000) / 1000,
          clicks_change_pct: clicksChangePct ? Math.round(clicksChangePct * 10) / 10 : null,
          top_queries: topQueries,
          recommendation: `CTR de ${(avgCtr * 100).toFixed(1)}% pour position ${Math.round(avgPosition * 10) / 10}. Revoir le title et la meta description pour améliorer le taux de clic.`,
        });
      }
    }

    // Trier : critical > high > medium, puis par impressions
    const priorityOrder = { critical: 0, high: 1, medium: 2 };
    pagesToOptimize.sort((a, b) => {
      const pDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
      if (pDiff !== 0) return pDiff;
      return b.impressions - a.impressions;
    });

    const result = pagesToOptimize.slice(0, limit);

    return NextResponse.json({
      pages: result,
      total: pagesToOptimize.length,
      period: { days, from: currentDateStr, to: now.toISOString().split("T")[0] },
      thresholds: { drop_threshold: dropThreshold, min_impressions: minImpressions, min_position: minPosition },
    });
  } catch (err) {
    console.error("Pages to-optimize error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

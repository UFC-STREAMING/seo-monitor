import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendTelegramMessage, formatPagesToOptimize } from "@/lib/telegram";

export const maxDuration = 60;

/**
 * GET /api/agent/hermes
 *
 * Endpoint principal pour l'agent Hermes. Retourne un briefing complet :
 * - Brands HOT à surveiller
 * - Pages à optimiser (chutes, opportunités, CTR faible)
 * - Optimisations en cours/pending
 * - Alertes non lues
 *
 * Query params:
 *   - notify: "true" pour envoyer le briefing sur Telegram
 *   - include: liste csv des sections à inclure (défaut: all)
 *     Valeurs: brands, pages, optimizations, alerts, summary
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();
  const { searchParams } = new URL(request.url);
  const notify = searchParams.get("notify") === "true";
  const includeParam = searchParams.get("include") ?? "all";
  const sections = includeParam === "all"
    ? ["brands", "pages", "optimizations", "alerts", "summary"]
    : includeParam.split(",").map((s) => s.trim());

  const result: Record<string, unknown> = {};

  // --- Brands HOT ---
  if (sections.includes("brands")) {
    const { data: hotBrands } = await supabase
      .from("brand_tracking")
      .select("brand_name, country, status, impressions_current_week, impressions_previous_week, dataforseo_position, product_category, affiliate_url, entered_at")
      .eq("status", "hot")
      .order("impressions_current_week", { ascending: false })
      .limit(30);

    result.brands_hot = (hotBrands ?? []).map((b) => ({
      ...b,
      trend_pct: b.impressions_previous_week > 0
        ? Math.round(((b.impressions_current_week - b.impressions_previous_week) / b.impressions_previous_week) * 1000) / 10
        : 100,
    }));
  }

  // --- Pages à optimiser ---
  if (sections.includes("pages")) {
    // Reuse the logic from /api/pages/to-optimize inline
    const { data: properties } = await supabase
      .from("gsc_properties")
      .select("id, site_url")
      .eq("is_active", true);

    if (properties && properties.length > 0) {
      const propIds = properties.map((p) => p.id);
      const propertyUrlMap = new Map(properties.map((p) => [p.id, p.site_url]));

      const now = new Date();
      const days = 14;
      const currentStart = new Date(now);
      currentStart.setDate(currentStart.getDate() - days);
      const prevStart = new Date(currentStart);
      prevStart.setDate(prevStart.getDate() - days);

      const currentDateStr = currentStart.toISOString().split("T")[0];
      const prevDateStr = prevStart.toISOString().split("T")[0];

      const [{ data: currentData }, { data: prevData }] = await Promise.all([
        supabase
          .from("gsc_search_data")
          .select("page, query, clicks, impressions, ctr, position, gsc_property_id")
          .in("gsc_property_id", propIds)
          .gte("date", currentDateStr)
          .not("page", "is", null),
        supabase
          .from("gsc_search_data")
          .select("page, clicks, impressions")
          .in("gsc_property_id", propIds)
          .gte("date", prevDateStr)
          .lt("date", currentDateStr)
          .not("page", "is", null),
      ]);

      // Aggregate by page
      const currentPages = new Map<string, {
        clicks: number; impressions: number; sumPosition: number; sumCtr: number;
        count: number; propertyId: string;
      }>();

      for (const row of currentData ?? []) {
        if (!row.page) continue;
        const e = currentPages.get(row.page);
        if (e) {
          e.clicks += row.clicks;
          e.impressions += row.impressions;
          e.sumPosition += row.position;
          e.sumCtr += row.ctr;
          e.count++;
        } else {
          currentPages.set(row.page, {
            clicks: row.clicks, impressions: row.impressions,
            sumPosition: row.position, sumCtr: row.ctr, count: 1,
            propertyId: row.gsc_property_id,
          });
        }
      }

      const prevPages = new Map<string, { clicks: number }>();
      for (const row of prevData ?? []) {
        if (!row.page) continue;
        const e = prevPages.get(row.page);
        if (e) e.clicks += row.clicks;
        else prevPages.set(row.page, { clicks: row.clicks });
      }

      const pages: Array<{
        page: string; site_url: string; reason: string; priority: string;
        impressions: number; avg_position: number; clicks_change_pct: number | null;
      }> = [];

      for (const [page, data] of currentPages) {
        const avgPosition = Math.round((data.sumPosition / data.count) * 10) / 10;
        const avgCtr = data.sumCtr / data.count;
        const prev = prevPages.get(page);
        const changePct = prev && prev.clicks > 0
          ? Math.round(((data.clicks - prev.clicks) / prev.clicks) * 1000) / 10
          : null;
        const siteUrl = propertyUrlMap.get(data.propertyId) ?? "";

        if (changePct !== null && changePct < -20 && (prev?.clicks ?? 0) >= 10) {
          pages.push({ page, site_url: siteUrl, reason: "drop", priority: changePct < -50 ? "critical" : "high", impressions: data.impressions, avg_position: avgPosition, clicks_change_pct: changePct });
        } else if (data.impressions >= 50 && avgPosition > 3 && avgPosition <= 20) {
          pages.push({ page, site_url: siteUrl, reason: "opportunity", priority: data.impressions > 500 ? "high" : "medium", impressions: data.impressions, avg_position: avgPosition, clicks_change_pct: changePct });
        } else if (data.impressions >= 100 && avgCtr < 0.02 && avgPosition <= 10) {
          pages.push({ page, site_url: siteUrl, reason: "low_ctr", priority: "medium", impressions: data.impressions, avg_position: avgPosition, clicks_change_pct: changePct });
        }
      }

      const priorityOrder: Record<string, number> = { critical: 0, high: 1, medium: 2 };
      pages.sort((a, b) => (priorityOrder[a.priority] ?? 9) - (priorityOrder[b.priority] ?? 9) || b.impressions - a.impressions);

      result.pages_to_optimize = pages.slice(0, 20);

      // Send Telegram notification if requested
      if (notify && pages.length > 0) {
        const msg = formatPagesToOptimize(pages.slice(0, 20));
        if (msg) await sendTelegramMessage(msg);
      }
    } else {
      result.pages_to_optimize = [];
    }
  }

  // --- Optimisations en cours ---
  if (sections.includes("optimizations")) {
    const [{ data: pending }, { data: inProgress }] = await Promise.all([
      supabase
        .from("content_optimizations")
        .select("id, page_url, trigger, status, requested_at, brand_name")
        .eq("status", "pending")
        .order("requested_at", { ascending: false })
        .limit(10),
      supabase
        .from("content_optimizations")
        .select("id, page_url, trigger, status, started_at, agent_name, brand_name")
        .eq("status", "in_progress")
        .order("started_at", { ascending: false })
        .limit(10),
    ]);

    result.optimizations = {
      pending: pending ?? [],
      in_progress: inProgress ?? [],
    };
  }

  // --- Alertes non lues ---
  if (sections.includes("alerts")) {
    const { data: unreadAlerts } = await supabase
      .from("alerts")
      .select("id, alert_type, severity, message, created_at")
      .eq("is_read", false)
      .order("created_at", { ascending: false })
      .limit(20);

    result.unread_alerts = unreadAlerts ?? [];
  }

  // --- Summary ---
  if (sections.includes("summary")) {
    const [
      { count: hotCount },
      { count: coolingCount },
      { count: pendingOptCount },
      { count: unreadCount },
    ] = await Promise.all([
      supabase.from("brand_tracking").select("*", { count: "exact", head: true }).eq("status", "hot"),
      supabase.from("brand_tracking").select("*", { count: "exact", head: true }).eq("status", "cooling"),
      supabase.from("content_optimizations").select("*", { count: "exact", head: true }).eq("status", "pending"),
      supabase.from("alerts").select("*", { count: "exact", head: true }).eq("is_read", false),
    ]);

    result.summary = {
      brands_hot: hotCount ?? 0,
      brands_cooling: coolingCount ?? 0,
      optimizations_pending: pendingOptCount ?? 0,
      unread_alerts: unreadCount ?? 0,
      generated_at: new Date().toISOString(),
    };
  }

  return NextResponse.json(result);
}

/**
 * POST /api/agent/hermes
 *
 * Actions que Hermes peut déclencher :
 *   - action: "create_optimization" → créer une tâche d'optimisation
 *   - action: "report_optimization" → reporter le résultat d'une optimisation
 *   - action: "send_message" → envoyer un message Telegram custom
 */
export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { action } = body;

  const supabase = createAdminClient();

  switch (action) {
    case "create_optimization": {
      const { page_url, trigger, metrics_before, brand_name } = body;
      if (!page_url || !trigger) {
        return NextResponse.json({ error: "page_url and trigger required" }, { status: 400 });
      }

      // Avoid duplicates
      const { data: existing } = await supabase
        .from("content_optimizations")
        .select("id")
        .eq("page_url", page_url)
        .in("status", ["pending", "in_progress"])
        .maybeSingle();

      if (existing) {
        return NextResponse.json({ message: "Already queued", id: existing.id });
      }

      const { data, error } = await supabase
        .from("content_optimizations")
        .insert({
          page_url,
          trigger,
          metrics_before: metrics_before ?? {},
          agent_name: "hermes",
          brand_name: brand_name ?? null,
        })
        .select("id")
        .single();

      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ id: data.id, status: "pending" }, { status: 201 });
    }

    case "report_optimization": {
      const { id, status, changes_made, metrics_after } = body;
      if (!id || !status) {
        return NextResponse.json({ error: "id and status required" }, { status: 400 });
      }

      const update: Record<string, unknown> = { status };
      if (status === "in_progress") update.started_at = new Date().toISOString();
      if (status === "completed" || status === "failed") update.completed_at = new Date().toISOString();
      if (changes_made) update.changes_made = changes_made;
      if (metrics_after) update.metrics_after = metrics_after;

      const { error } = await supabase
        .from("content_optimizations")
        .update(update)
        .eq("id", id);

      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ id, status });
    }

    case "send_message": {
      const { text } = body;
      if (!text) {
        return NextResponse.json({ error: "text required" }, { status: 400 });
      }
      const sent = await sendTelegramMessage(text);
      return NextResponse.json({ sent });
    }

    default:
      return NextResponse.json(
        { error: `Unknown action: ${action}`, available: ["create_optimization", "report_optimization", "send_message"] },
        { status: 400 }
      );
  }
}

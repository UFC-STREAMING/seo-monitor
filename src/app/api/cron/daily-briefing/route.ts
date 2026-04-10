import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendTelegramMessage } from "@/lib/telegram";

export const maxDuration = 120;

/**
 * GET /api/cron/daily-briefing
 *
 * Cron quotidien : briefing Telegram ACTIONNABLE pour Hermes.
 *
 * Différences vs l'ancienne version :
 *  - Auto-archive des alertes > 7 jours (stop le bruit)
 *  - Top 3 actions prioritaires triées par VOLUME de clics perdus (pas %)
 *  - Pattern detection : si >= 5 sites en chute → mega-alerte
 *  - Format "À FAIRE AUJOURD'HUI" au lieu de résumé passif
 */
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();

  // ─────────────────────────────────────────────────────────────
  // STEP 0 — AUTO-ARCHIVE des alertes > 7 jours
  // ─────────────────────────────────────────────────────────────
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const sevenDaysAgoIso = sevenDaysAgo.toISOString();

  // Count before update (Supabase JS update().select() signature doesn't
  // match count: 'exact' → query count separately first).
  const { count: archivedCount } = await supabase
    .from("alerts")
    .select("*", { count: "exact", head: true })
    .lt("created_at", sevenDaysAgoIso)
    .eq("is_read", false);

  await supabase
    .from("alerts")
    .update({ is_read: true })
    .lt("created_at", sevenDaysAgoIso)
    .eq("is_read", false);

  const lines: string[] = ["<b>📊 SEO Monitor — Briefing du matin</b>", ""];

  // Helper pour appeler les RPC SQL
  const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

  async function callRpc<T>(fn: string, params: Record<string, unknown>): Promise<T[]> {
    const res = await fetch(`${sbUrl}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: {
        apikey: sbKey,
        Authorization: `Bearer ${sbKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(params),
    });
    if (!res.ok) return [];
    return res.json() as Promise<T[]>;
  }

  // ─────────────────────────────────────────────────────────────
  // STEP 1 — Charger les sites + stats
  // ─────────────────────────────────────────────────────────────
  const { data: properties } = await supabase
    .from("gsc_properties")
    .select("id, site_id")
    .eq("is_active", true);

  const { data: sites } = await supabase
    .from("sites")
    .select("id, domain, location_code")
    .eq("is_active", true);

  interface SiteStats {
    domain: string;
    clicks: number;
    impressions: number;
    prevClicks: number;
    trendPct: number; // % variation
    clicksLost: number; // volume absolu perdu (positif = perte, négatif = gain)
  }

  let ranked: SiteStats[] = [];

  if (properties && sites && properties.length > 0) {
    const propToSite = new Map(properties.map((p) => [p.id, p.site_id]));

    const now = new Date();
    const d7 = new Date(now);
    d7.setDate(d7.getDate() - 7);
    const d14 = new Date(now);
    d14.setDate(d14.getDate() - 14);
    const d7Str = d7.toISOString().split("T")[0];
    const d14Str = d14.toISOString().split("T")[0];
    const nowStr = now.toISOString().split("T")[0];

    interface RankRow {
      gsc_property_id: string;
      total_clicks: number;
      total_impressions: number;
      avg_ctr: number;
      avg_position: number;
      query_count: number;
    }

    const [currentAgg, prevAgg] = await Promise.all([
      callRpc<RankRow>("get_sites_ranking", { p_date_from: d7Str, p_date_to: nowStr }),
      callRpc<RankRow>("get_sites_ranking", { p_date_from: d14Str, p_date_to: d7Str }),
    ]);

    const currentStats = new Map<string, { clicks: number; impressions: number }>();
    const prevStats = new Map<string, { clicks: number }>();

    for (const row of currentAgg) {
      const sid = propToSite.get(row.gsc_property_id);
      if (!sid) continue;
      const e = currentStats.get(sid);
      if (e) {
        e.clicks += row.total_clicks;
        e.impressions += row.total_impressions;
      } else {
        currentStats.set(sid, { clicks: row.total_clicks, impressions: row.total_impressions });
      }
    }
    for (const row of prevAgg) {
      const sid = propToSite.get(row.gsc_property_id);
      if (!sid) continue;
      const e = prevStats.get(sid);
      if (e) e.clicks += row.total_clicks;
      else prevStats.set(sid, { clicks: row.total_clicks });
    }

    ranked = sites
      .map((s): SiteStats => {
        const curr = currentStats.get(s.id);
        const prev = prevStats.get(s.id);
        const clicks = curr?.clicks ?? 0;
        const impressions = curr?.impressions ?? 0;
        const prevClicks = prev?.clicks ?? 0;
        const trendPct =
          prevClicks > 0
            ? Math.round(((clicks - prevClicks) / prevClicks) * 100)
            : clicks > 0
              ? 100
              : 0;
        const clicksLost = prevClicks - clicks; // positif = perte
        return { domain: s.domain, clicks, impressions, prevClicks, trendPct, clicksLost };
      })
      .sort((a, b) => b.clicks - a.clicks);
  }

  // ─────────────────────────────────────────────────────────────
  // STEP 2 — DÉTECTION DE PATTERN (mega-alerte si ≥5 sites en chute)
  // ─────────────────────────────────────────────────────────────
  const declining = ranked.filter((s) => s.trendPct < -20 && s.prevClicks > 10);
  const dead = ranked.filter((s) => s.clicks === 0 && s.impressions === 0);

  if (declining.length >= 5) {
    lines.push("🚨 <b>PATTERN DÉTECTÉ — ALERTE ROUGE</b>");
    lines.push(
      `${declining.length} sites en chute simultanée + ${dead.length} morts. Cause probable :`,
    );
    lines.push("  • Google update récent (core ou spam)");
    lines.push("  • Footprint commun détecté (hébergeur, template, analytics, backlinks)");
    lines.push("  • Problème technique batch (robots, sitemap, SSL)");
    lines.push("👉 Diagnostic footprint à lancer aujourd'hui.");
    lines.push("");
  }

  // ─────────────────────────────────────────────────────────────
  // STEP 3 — TOP 3 ACTIONS PRIORITAIRES (triées par clics perdus)
  // ─────────────────────────────────────────────────────────────
  lines.push("<b>🎯 TOP 3 ACTIONS AUJOURD'HUI</b>");
  lines.push("");

  const actions: { priority: string; domain: string; reason: string; impact: string }[] = [];

  // 1) Sites en chute massive triés par volume perdu (pas par %)
  const worstDrops = [...declining]
    .filter((s) => s.clicksLost > 0)
    .sort((a, b) => b.clicksLost - a.clicksLost);

  for (const s of worstDrops.slice(0, 3)) {
    const severity = s.clicksLost >= 500 ? "🔴" : s.clicksLost >= 200 ? "🟠" : "🟡";
    actions.push({
      priority: severity,
      domain: s.domain,
      reason: `chute ${s.trendPct}% → -${s.clicksLost} clicks/sem`,
      impact: `Était ${s.prevClicks} → maintenant ${s.clicks}`,
    });
  }

  // 2) Si aucune action urgente, regarder les sites morts récents
  if (actions.length < 3 && dead.length > 0) {
    for (const d of dead.slice(0, 3 - actions.length)) {
      actions.push({
        priority: "💀",
        domain: d.domain,
        reason: "site mort (0 clicks, 0 impressions)",
        impact: "Désindexation probable → check GSC + robots",
      });
    }
  }

  // 3) Si toujours < 3 actions, regarder les opportunités (sites qui montent)
  if (actions.length < 3) {
    const rising = ranked
      .filter((s) => s.trendPct > 20 && s.prevClicks > 10)
      .sort((a, b) => b.clicks - a.clicks);
    for (const s of rising.slice(0, 3 - actions.length)) {
      actions.push({
        priority: "🟢",
        domain: s.domain,
        reason: `monte +${s.trendPct}% (+${-s.clicksLost} clicks)`,
        impact: "OPPORTUNITÉ : pusher plus de contenu / backlinks",
      });
    }
  }

  if (actions.length === 0) {
    lines.push("  ✅ Rien de critique aujourd'hui. Profite.");
  } else {
    actions.slice(0, 3).forEach((a, i) => {
      lines.push(`${a.priority} <b>${i + 1}. ${a.domain}</b>`);
      lines.push(`   ${a.reason}`);
      lines.push(`   <i>${a.impact}</i>`);
      lines.push("");
    });
  }

  // ─────────────────────────────────────────────────────────────
  // STEP 4 — RÉSUMÉ RÉSEAU (compact)
  // ─────────────────────────────────────────────────────────────
  const active = ranked.filter((r) => r.clicks > 0);
  const totalClicks = active.reduce((s, r) => s + r.clicks, 0);
  const totalPrevClicks = active.reduce((s, r) => s + r.prevClicks, 0);
  const totalTrend =
    totalPrevClicks > 0
      ? Math.round(((totalClicks - totalPrevClicks) / totalPrevClicks) * 100)
      : 0;
  const totalImpressions = active.reduce((s, r) => s + r.impressions, 0);

  const networkArrow = totalTrend > 5 ? "📈" : totalTrend < -5 ? "📉" : "➡️";
  lines.push("<b>📊 Réseau (7j)</b>");
  lines.push(
    `  ${networkArrow} ${totalClicks.toLocaleString()} clicks (${totalTrend > 0 ? "+" : ""}${totalTrend}% vs semaine précédente)`,
  );
  lines.push(`  ${totalImpressions.toLocaleString()} impressions · ${active.length} sites actifs`);

  // ─────────────────────────────────────────────────────────────
  // STEP 5 — Brands HOT (toujours actionnable)
  // ─────────────────────────────────────────────────────────────
  const { data: hotBrands, count: hotCount } = await supabase
    .from("brand_tracking")
    .select("brand_name, country, impressions_current_week", { count: "exact" })
    .eq("status", "hot")
    .order("impressions_current_week", { ascending: false })
    .limit(3);

  if (hotCount && hotCount > 0) {
    lines.push("");
    lines.push(`<b>🔥 Brands HOT (${hotCount})</b>`);
    for (const b of hotBrands ?? []) {
      lines.push(
        `  • ${b.brand_name} (${b.country}) — ${b.impressions_current_week.toLocaleString()} imp/sem`,
      );
    }
  }

  // ─────────────────────────────────────────────────────────────
  // STEP 6 — Compteurs silencieux (juste pour info)
  // ─────────────────────────────────────────────────────────────
  const { count: unreadCount } = await supabase
    .from("alerts")
    .select("*", { count: "exact", head: true })
    .eq("is_read", false);

  const { count: optPendingCount } = await supabase
    .from("content_optimizations")
    .select("*", { count: "exact", head: true })
    .eq("status", "pending");

  const silent: string[] = [];
  if ((unreadCount ?? 0) > 0) silent.push(`🔔 ${unreadCount} alertes`);
  if ((optPendingCount ?? 0) > 0) silent.push(`📝 ${optPendingCount} optimisations`);
  if ((archivedCount ?? 0) > 0) silent.push(`🗄️ ${archivedCount} archivées auto`);

  if (silent.length > 0) {
    lines.push("");
    lines.push(`<i>${silent.join(" · ")}</i>`);
  }

  // Footer
  lines.push("");
  lines.push(
    `<i>${new Date().toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })} — seo-monitor-one.vercel.app</i>`,
  );

  const message = lines.join("\n");
  const sent = await sendTelegramMessage(message);

  return NextResponse.json({
    sent,
    message_length: message.length,
    auto_archived: archivedCount ?? 0,
    actions_count: actions.length,
    pattern_alert: declining.length >= 5,
    timestamp: new Date().toISOString(),
  });
}

// Collecte quotidienne de la section Tracking (Leo 10/10/2026) → table tracking_daily.
//   bing     : impressions / clics Bing + Yahoo + DuckDuckGo (API Bing Webmaster, 1 clé
//              pour tout le compte, sites vérifiés le 09/10)
//   everflow : clics valides sur le bouton (/go/), clics invalides, ventes, revenus,
//              rattachés au site par sub1 (= domaine avec tirets)

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { EVERFLOW_NETWORKS, normalizeDomainKey, cleanSub1 } from "@/lib/everflow/client";
import { clicksOfDay, classifyClick } from "@/lib/tracking/human-clicks";

type Supa = SupabaseClient<Database>;
const BING_API = "https://ssl.bing.com/webmaster/api.svc/json/";
const EFLOW_API = "https://api.eflow.team/v1/affiliates";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

async function emdSites(supabase: Supa) {
  const { data, error } = await supabase.from("sites").select("id, domain").eq("category", "emd");
  if (error) throw new Error(`sites fetch: ${error.message}`);
  return data ?? [];
}

async function upsert(supabase: Supa, rows: Database["public"]["Tables"]["tracking_daily"]["Insert"][]) {
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await supabase
      .from("tracking_daily")
      .upsert(rows.slice(i, i + 500), { onConflict: "site_id,date,source" });
    if (error) throw new Error(`tracking_daily upsert: ${error.message}`);
  }
}

/** Bing : historique jour par jour de chaque site (la réponse contient tout l'historique). */
export async function syncBing(supabase: Supa, days = 30): Promise<{ sites: number; rows: number; errors: string[] }> {
  const key = process.env.BING_WEBMASTER_API_KEY;
  if (!key) return { sites: 0, rows: 0, errors: ["BING_WEBMASTER_API_KEY manquante"] };
  const since = isoDay(new Date(Date.now() - days * 86400_000));
  const rows: Database["public"]["Tables"]["tracking_daily"]["Insert"][] = [];
  const errors: string[] = [];
  const sites = await emdSites(supabase);
  for (const s of sites) {
    try {
      const url = `${BING_API}GetRankAndTrafficStats?apikey=${key}&siteUrl=${encodeURIComponent(`https://${s.domain}/`)}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
      if (!res.ok) { errors.push(`${s.domain}: HTTP ${res.status}`); continue; }
      const json = (await res.json()) as { d?: Array<{ Date: string; Clicks: number; Impressions: number }> };
      for (const p of json.d ?? []) {
        const ms = Number(p.Date.match(/\d+/)?.[0]);
        if (!ms) continue;
        const date = isoDay(new Date(ms));
        if (date < since) continue;
        rows.push({ site_id: s.id, date, source: "bing", impressions: p.Impressions, clicks: p.Clicks, updated_at: new Date().toISOString() });
      }
    } catch (e) {
      errors.push(`${s.domain}: ${e instanceof Error ? e.message : String(e)}`);
    }
    await sleep(150);
  }
  await upsert(supabase, rows);
  return { sites: sites.length, rows: rows.length, errors };
}

/**
 * Everflow : VRAIS clics humains sur le bouton (journal clic par clic, robots/VPN/
 * hébergeurs et nos propres clics exclus), clics humains refusés par l'offre, et
 * ventes/revenus (rapport agrégé, les conversions sont réelles).
 */
export async function syncEverflow(supabase: Supa, days = 3): Promise<{ rows: number; errors: string[] }> {
  const sites = await emdSites(supabase);
  const byKey = new Map(sites.map((s) => [normalizeDomainKey(s.domain), s.id]));
  type Agg = { site_id: string; date: string; go_clicks: number; go_invalid: number; conversions: number; revenue_usd: number; extra: { bots: number; own: number } };
  const agg = new Map<string, Agg>();
  const get = (siteId: string, date: string) => {
    const k = `${siteId}|${date}`;
    let a = agg.get(k);
    if (!a) { a = { site_id: siteId, date, go_clicks: 0, go_invalid: 0, conversions: 0, revenue_usd: 0, extra: { bots: 0, own: 0 } }; agg.set(k, a); }
    return a;
  };
  const errors: string[] = [];
  for (let i = 0; i < days; i++) {
    const date = isoDay(new Date(Date.now() - i * 86400_000));

    // 1. Clics, un par un
    try {
      for (const c of await clicksOfDay(date)) {
        const sub1 = cleanSub1(c.sub1 ?? null);
        const siteId = sub1 ? byKey.get(normalizeDomainKey(sub1)) : undefined;
        if (!siteId) continue;
        const a = get(siteId, date);
        const kind = classifyClick(c);
        if (kind === "human") a.go_clicks++;
        else if (kind === "rejected") a.go_invalid++;
        else if (kind === "bot") a.extra.bots++;
        else a.extra.own++;
      }
    } catch (e) {
      errors.push(`clics ${date}: ${e instanceof Error ? e.message : String(e)}`);
    }

    // 2. Ventes et revenus
    for (const net of EVERFLOW_NETWORKS) {
      const key = process.env[net.tokenEnv];
      if (!key) continue;
      await sleep(250); // Everflow : 5 req/s max par clé
      const res = await fetch(`${EFLOW_API}/reporting/entity`, {
        method: "POST",
        headers: { "X-Eflow-API-Key": key, "Content-Type": "application/json" },
        body: JSON.stringify({ from: date, to: date, timezone_id: 67, currency_id: "USD", query: { filters: [] }, columns: [{ column: "sub1" }] }),
      });
      if (!res.ok) { errors.push(`${net.key} ${date}: HTTP ${res.status}`); continue; }
      const json = JSON.parse((await res.text()).replace(/[\u0000-\u001f]/g, " ")) as {
        table?: Array<{ columns: Array<{ column_type: string; id?: string; label?: string }>; reporting: { cv?: number; revenue?: number } }>;
      };
      for (const row of json.table ?? []) {
        const c = row.columns.find((x) => x.column_type === "sub1");
        const sub1 = cleanSub1(c?.label || c?.id || null);
        const siteId = sub1 ? byKey.get(normalizeDomainKey(sub1)) : undefined;
        if (!siteId || !(row.reporting.cv || row.reporting.revenue)) continue;
        const a = get(siteId, date);
        a.conversions += row.reporting.cv ?? 0;
        a.revenue_usd += row.reporting.revenue ?? 0;
      }
    }
  }
  const rows = [...agg.values()].map((r) => ({ ...r, source: "everflow", updated_at: new Date().toISOString() }));
  await upsert(supabase, rows);
  return { rows: rows.length, errors };
}

/**
 * Clarity : 1 appel par projet et par jour (quota 10/jour/projet), dernières 24 h,
 * rangées sur la veille. Visites = sessions totales − sessions de robots détectées
 * par Clarity. API : https://www.clarity.ms/export-data/api/v1/project-live-insights
 */
export async function syncClarity(supabase: Supa): Promise<{ projects: number; rows: number; errors: string[] }> {
  const { data: projects, error } = await supabase
    .from("clarity_projects")
    .select("site_id, project_id, api_token")
    .not("api_token", "is", null);
  if (error) throw new Error(`clarity_projects: ${error.message}`);
  const date = isoDay(new Date(Date.now() - 86400_000));
  const rows: Database["public"]["Tables"]["tracking_daily"]["Insert"][] = [];
  const errors: string[] = [];
  const num = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));
  const list = projects ?? [];
  for (let i = 0; i < list.length; i += 6) {
    await Promise.all(
      list.slice(i, i + 6).map(async (p) => {
        try {
          // Détail par pays pour exclure nos propres visites (Thaïlande/Bulgarie)
          const res = await fetch("https://www.clarity.ms/export-data/api/v1/project-live-insights?numOfDays=1&dimension1=Country%2FRegion", {
            headers: { Authorization: `Bearer ${p.api_token}`, "Content-Type": "application/json" },
            signal: AbortSignal.timeout(30_000),
          });
          if (!res.ok) { errors.push(`${p.project_id}: HTTP ${res.status}`); return; }
          const json = (await res.json()) as Array<{ metricName: string; information: Array<Record<string, unknown>> }>;
          const OWN = /^(thailand|bulgaria)$/i;
          const rowsOf = (name: string) =>
            (json.find((m) => m.metricName === name)?.information ?? []).filter((r) => !OWN.test(String(r["Country/Region"] ?? r.Country ?? "")));
          const traffic = rowsOf("Traffic");
          const total = traffic.reduce((a, r) => a + (num(r.totalSessionCount) ?? 0), 0);
          const bots = traffic.reduce((a, r) => a + (num(r.totalBotSessionCount) ?? 0), 0);
          const sessions = Math.max(0, total - bots);
          const pages = traffic.reduce((a, r) => a + Math.max(0, (num(r.totalSessionCount) ?? 0) - (num(r.totalBotSessionCount) ?? 0)) * (num(r.PagesPerSessionPercentage) ?? 1), 0);
          const avg = (name: string, field: string) => {
            const v = rowsOf(name).map((r) => num(r[field])).filter((x): x is number => x !== null);
            return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
          };
          const sumOf = (name: string) => rowsOf(name).reduce((a, r) => a + (num(r.subTotal) ?? 0), 0);
          rows.push({
            site_id: p.site_id,
            date,
            source: "clarity",
            sessions,
            pageviews: Math.round(pages),
            scroll_depth: avg("ScrollDepth", "averageScrollDepth"),
            engagement_seconds: avg("EngagementTime", "activeTime"),
            rage_clicks: sumOf("RageClickCount"),
            dead_clicks: sumOf("DeadClickCount"),
            quickbacks: sumOf("QuickbackClick"),
            extra: { bot_sessions: bots },
            updated_at: new Date().toISOString(),
          });
        } catch (e) {
          errors.push(`${p.project_id}: ${e instanceof Error ? e.message : String(e)}`);
        }
      })
    );
  }
  await upsert(supabase, rows);
  return { projects: list.length, rows: rows.length, errors };
}

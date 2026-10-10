import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { findingsFor, severity, type FunnelRow } from "@/lib/tracking/funnel";

export const dynamic = "force-dynamic";

// API de la page /tracking : entonnoir par EMD sur N jours (défaut 28) + totaux.
// Auth : session dashboard OU Bearer CRON_SECRET (agent Hermes EMD).
export async function GET(request: NextRequest) {
  const isCron = request.headers.get("authorization") === `Bearer ${process.env.CRON_SECRET}`;
  if (!isCron) {
    const { data: { user }, error } = await (await createClient()).auth.getUser();
    if (error || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const days = Math.min(180, Math.max(1, Number(request.nextUrl.searchParams.get("days")) || 28));
  const since = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);
  const supabase = createAdminClient();

  const { data: sites, error } = await supabase
    .from("sites")
    .select("id, domain, hosting, affiliate_status, affiliate_detail, is_active")
    .eq("category", "emd")
    .eq("is_active", true);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const ids = (sites ?? []).map((s) => s.id);

  // Mot-clé principal + dernière position Google
  const { data: kws } = await supabase
    .from("keywords")
    .select("id, site_id, keyword, locations(country_iso)")
    .in("site_id", ids)
    .eq("is_primary", true);
  const kwBySite = new Map((kws ?? []).map((k) => [k.site_id, k]));
  const lastPos = new Map<string, number | null>();
  const kwIds = (kws ?? []).map((k) => k.id);
  if (kwIds.length) {
    const { data: pos } = await supabase.rpc("latest_keyword_positions", { p_keyword_ids: kwIds });
    for (const p of (pos ?? []) as Array<{ keyword_id: string; position: number | null }>) lastPos.set(p.keyword_id, p.position);
  }

  // Données quotidiennes sur la période (paginées : plafond 1000 lignes)
  const daily: Array<{ site_id: string; source: string; impressions: number | null; clicks: number | null; sessions: number | null; scroll_depth: number | null; rage_clicks: number | null; go_clicks: number | null; go_invalid: number | null; conversions: number | null; revenue_usd: number | null; date: string }> = [];
  for (let from = 0; ; from += 1000) {
    const { data: page, error: e } = await supabase
      .from("tracking_daily")
      .select("site_id, source, date, impressions, clicks, sessions, scroll_depth, rage_clicks, go_clicks, go_invalid, conversions, revenue_usd")
      .gte("date", since)
      .order("id", { ascending: true })
      .range(from, from + 999);
    if (e) return NextResponse.json({ error: e.message }, { status: 500 });
    daily.push(...(page ?? []));
    if (!page || page.length < 1000) break;
  }

  const rows: FunnelRow[] = (sites ?? []).map((s) => {
    const mine = daily.filter((d) => d.site_id === s.id);
    const sum = (src: string, k: keyof (typeof daily)[number]) =>
      mine.filter((d) => d.source === src).reduce((a, d) => a + Number(d[k] ?? 0), 0);
    const clarity = mine.filter((d) => d.source === "clarity");
    const kw = kwBySite.get(s.id);
    const base = {
      site_id: s.id,
      domain: s.domain,
      hosting: s.hosting ?? null,
      keyword: kw?.keyword ?? null,
      country_iso: (kw?.locations as unknown as { country_iso: string } | null)?.country_iso ?? null,
      position: kw ? lastPos.get(kw.id) ?? null : null,
      position_checked: kw ? lastPos.has(kw.id) : false,
      affiliate_status: s.affiliate_status ?? null,
      affiliate_detail: s.affiliate_detail ?? null,
      bing_impressions: sum("bing", "impressions"),
      bing_clicks: sum("bing", "clicks"),
      sessions: clarity.length ? sum("clarity", "sessions") : null,
      scroll_depth: clarity.length
        ? clarity.reduce((a, d) => a + Number(d.scroll_depth ?? 0), 0) / clarity.length
        : null,
      rage_clicks: clarity.length ? sum("clarity", "rage_clicks") : null,
      go_clicks: sum("everflow", "go_clicks"),
      go_invalid: sum("everflow", "go_invalid"),
      conversions: sum("everflow", "conversions"),
      revenue_usd: sum("everflow", "revenue_usd"),
    };
    return { ...base, findings: findingsFor(base) };
  });
  rows.sort((a, b) => severity(a) - severity(b) || b.revenue_usd - a.revenue_usd || b.go_clicks - a.go_clicks);

  const totals = rows.reduce(
    (t, r) => ({
      bing_impressions: t.bing_impressions + r.bing_impressions,
      bing_clicks: t.bing_clicks + r.bing_clicks,
      sessions: t.sessions + (r.sessions ?? 0),
      go_clicks: t.go_clicks + r.go_clicks,
      conversions: t.conversions + r.conversions,
      revenue_usd: t.revenue_usd + r.revenue_usd,
    }),
    { bing_impressions: 0, bing_clicks: 0, sessions: 0, go_clicks: 0, conversions: 0, revenue_usd: 0 }
  );
  const lastBing = daily.filter((d) => d.source === "bing").map((d) => d.date).sort().pop() ?? null;
  return NextResponse.json({ days, totals, last_bing_date: lastBing, clarity_sites: new Set(daily.filter((d) => d.source === "clarity").map((d) => d.site_id)).size, rows });
}

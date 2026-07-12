import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 60;

// Rapport hebdo consommé par l'agent Hermes EMD (cron lundi 9h, Mac Mini).
// Les positions sont fraîches : le cron check-positions tourne lundi 7h.
// Auth : Bearer CRON_SECRET.
//
// L'agent NE fait plus ses propres appels DataForSEO (double dépense +
// Markdown non requêtable) — il lit ce JSON et produit son rapport Telegram.

const WEEK_MS = 7 * 86400_000;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();

  const { data: sites, error: sitesErr } = await supabase
    .from("sites")
    .select("id, domain, is_active, serp_tracking_enabled")
    .eq("category", "emd")
    .order("domain");
  if (sitesErr || !sites) {
    return NextResponse.json({ error: sitesErr?.message }, { status: 500 });
  }
  const siteIds = sites.map((s) => s.id);

  const { data: keywords } = await supabase
    .from("keywords")
    .select("id, site_id, keyword, location_code, locations(country_iso)")
    .in("site_id", siteIds)
    .eq("is_primary", true);
  const kwBySite = new Map((keywords ?? []).map((k) => [k.site_id, k]));
  const keywordIds = (keywords ?? []).map((k) => k.id);

  const since = new Date(Date.now() - 60 * 86400_000).toISOString();
  const { data: positions } = keywordIds.length
    ? await supabase
        .from("keyword_positions")
        .select("keyword_id, position, url_found, checked_at")
        .in("keyword_id", keywordIds)
        .gte("checked_at", since)
        .order("checked_at", { ascending: true })
    : { data: [] };

  const histByKw = new Map<string, Array<{ position: number | null; checked_at: string }>>();
  for (const p of positions ?? []) {
    const list = histByKw.get(p.keyword_id) ?? [];
    list.push({ position: p.position, checked_at: p.checked_at });
    histByKw.set(p.keyword_id, list);
  }

  const { data: finance } = await supabase
    .from("domain_finance")
    .select("site_id, purchase_price, renewal_price")
    .in("site_id", siteIds);
  const finBySite = new Map((finance ?? []).map((f) => [f.site_id, f]));

  const { data: revenue } = await supabase
    .from("domain_revenue")
    .select("site_id, date, conversions, revenue_usd")
    .in("site_id", siteIds);

  const now = Date.now();
  const revBySite = new Map<
    string,
    { total: number; last7d: number; last30d: number; conversions: number }
  >();
  for (const r of revenue ?? []) {
    const cur =
      revBySite.get(r.site_id) ?? { total: 0, last7d: 0, last30d: 0, conversions: 0 };
    const rev = Number(r.revenue_usd);
    const age = now - new Date(r.date).getTime();
    cur.total += rev;
    cur.conversions += r.conversions;
    if (age <= WEEK_MS) cur.last7d += rev;
    if (age <= 30 * 86400_000) cur.last30d += rev;
    revBySite.set(r.site_id, cur);
  }

  const { data: alerts } = await supabase
    .from("alerts")
    .select("site_id, alert_type, severity, message, created_at")
    .in("site_id", siteIds)
    .eq("is_read", false)
    .order("created_at", { ascending: false })
    .limit(50);

  // Position il y a ~N semaines (le point le plus récent antérieur au seuil)
  function positionAt(hist: Array<{ position: number | null; checked_at: string }>, weeksAgo: number) {
    const threshold = now - weeksAgo * WEEK_MS;
    for (let i = hist.length - 1; i >= 0; i--) {
      if (new Date(hist[i].checked_at).getTime() <= threshold) return hist[i].position;
    }
    return null;
  }

  const report = sites.map((site) => {
    const kw = kwBySite.get(site.id);
    const hist = kw ? histByKw.get(kw.id) ?? [] : [];
    const current = hist.length ? hist[hist.length - 1] : null;
    const pos1wAgo = positionAt(hist, 1);
    const pos4wAgo = positionAt(hist, 4);
    const fin = finBySite.get(site.id);
    const spent = fin ? Number(fin.purchase_price) + Number(fin.renewal_price) : 0;
    const rev = revBySite.get(site.id) ?? { total: 0, last7d: 0, last30d: 0, conversions: 0 };
    const loc = kw?.locations as unknown as { country_iso: string } | null;

    return {
      domain: site.domain,
      tracking_active: site.is_active && site.serp_tracking_enabled && !!kw,
      keyword: kw?.keyword ?? null,
      country: loc?.country_iso ?? null,
      position: current?.position ?? null,
      checked_at: current?.checked_at ?? null,
      position_1w_ago: pos1wAgo,
      position_4w_ago: pos4wAgo,
      delta_1w: current && pos1wAgo !== null ? (pos1wAgo ?? 101) - (current.position ?? 101) : null,
      delta_4w: current && pos4wAgo !== null ? (pos4wAgo ?? 101) - (current.position ?? 101) : null,
      history: hist.slice(-8),
      spent_usd: spent,
      revenue_7d_usd: Math.round(rev.last7d * 100) / 100,
      revenue_30d_usd: Math.round(rev.last30d * 100) / 100,
      revenue_total_usd: Math.round(rev.total * 100) / 100,
      conversions_total: rev.conversions,
      roi_usd: Math.round((rev.total - spent) * 100) / 100,
      open_alerts: (alerts ?? [])
        .filter((a) => a.site_id === site.id)
        .map((a) => ({ type: a.alert_type, severity: a.severity, message: a.message })),
    };
  });

  const inTop100 = report.filter((r) => r.position !== null);

  return NextResponse.json({
    generated_at: new Date().toISOString(),
    summary: {
      emd_count: report.length,
      tracked: report.filter((r) => r.tracking_active).length,
      in_top_100: inTop100.length,
      in_top_10: inTop100.filter((r) => (r.position ?? 999) <= 10).length,
      total_spent_usd: report.reduce((s, r) => s + r.spent_usd, 0),
      total_revenue_usd: Math.round(report.reduce((s, r) => s + r.revenue_total_usd, 0) * 100) / 100,
      revenue_7d_usd: Math.round(report.reduce((s, r) => s + r.revenue_7d_usd, 0) * 100) / 100,
    },
    sites: report,
  });
}

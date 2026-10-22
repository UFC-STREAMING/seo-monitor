import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchTraffic, summarize, type DomainTraffic } from "@/lib/expired/traffic";

export const maxDuration = 300;

// Liste du jour des domaines expirés, poussée par l'agent Dana (Hermes) chaque matin (Bearer CRON_SECRET).
//
// Body JSON :
// {
//   "date": "2026-10-22",                      // jour de la liste (Europe/Paris)
//   "domains": [{
//     "domain": "iris-radiologie.ch",
//     "category": "medical" | "psy" | "sport",
//     "label": "radiologie",                   // type + ville en français
//     "sources": [{ "platform": "catched", "kind": "backorder" | "auction", "price": "40 € HT", "ends_at": "2026-10-22 00:00" }],
//     "traffic_series": [{ "m": "2026-09", "v": 120 }]   // optionnel : trafic déjà relevé, évite de repayer
//   }],
//   "fetch_traffic": true                       // défaut true : relève le trafic des domaines jamais relevés ou relevés il y a > 7 jours
// }
// Idempotent : renvoyer la même liste met à jour prix / fins sans toucher aux cases « backorder posé ».
const PLATFORMS = new Set(["catched", "nicsell", "webexpire", "bloomup", "dynadot", "domainorder", "realtime"]);
const CATEGORIES = new Set(["medical", "psy", "sport"]);
const STALE_MS = 7 * 24 * 3600 * 1000;

type Source = { platform?: string; kind?: string; price?: string | null; ends_at?: string | null };
type InDomain = { domain?: string; category?: string; label?: string | null; sources?: Source[]; traffic_series?: { m: string; v: number }[] };

export async function POST(request: NextRequest) {
  if (request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let body: { date?: string; domains?: InDomain[]; fetch_traffic?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body JSON requis" }, { status: 400 });
  }
  const date = String(body.date ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return NextResponse.json({ error: "date AAAA-MM-JJ requise" }, { status: 400 });
  if (!Array.isArray(body.domains) || body.domains.length === 0) return NextResponse.json({ error: "domains vide" }, { status: 400 });

  // Nettoyage + fusion des doublons (un même .fr listé par plusieurs plateformes = une ligne, plusieurs sources)
  const byDomain = new Map<string, InDomain & { domain: string }>();
  for (const d of body.domains) {
    const domain = String(d.domain ?? "").trim().toLowerCase();
    if (!domain.includes(".")) continue;
    const prev = byDomain.get(domain);
    if (prev) prev.sources = [...(prev.sources ?? []), ...(d.sources ?? [])];
    else byDomain.set(domain, { ...d, domain });
  }
  const domains = [...byDomain.values()];

  const supabase = createAdminClient();
  const names = domains.map((d) => d.domain);
  const known = new Map<string, { first_seen: string; traffic_checked_at: string | null }>();
  for (let i = 0; i < names.length; i += 500) {
    const { data } = await supabase.from("expired_domains").select("domain, first_seen, traffic_checked_at").in("domain", names.slice(i, i + 500));
    for (const r of data ?? []) known.set(r.domain, r);
  }

  const now = new Date().toISOString();
  const given = new Map<string, DomainTraffic>();
  for (const d of domains) {
    if (Array.isArray(d.traffic_series) && d.traffic_series.length) {
      const organic = d.traffic_series.map((p) => ({ year: +p.m.slice(0, 4), month: +p.m.slice(5, 7), etv: p.v }));
      given.set(d.domain, summarize(d.domain, organic));
    }
  }

  const rows = domains.map((d) => {
    const t = given.get(d.domain);
    return {
      domain: d.domain,
      category: CATEGORIES.has(String(d.category)) ? String(d.category) : "medical",
      label: d.label ?? null,
      tld: d.domain.slice(d.domain.indexOf(".")),
      first_seen: known.get(d.domain)?.first_seen ?? date,
      last_seen: date,
      ...(t ? { traffic_current: t.current, traffic_6m: t.six_months, traffic_peak: t.peak, peak_month: t.peak_month, traffic_series: t.series, traffic_checked_at: now } : {}),
    };
  });
  const { error: e1 } = await supabase.from("expired_domains").upsert(rows, { onConflict: "domain" });
  if (e1) return NextResponse.json({ error: e1.message }, { status: 500 });

  const listings = domains.flatMap((d) =>
    (d.sources ?? [])
      .filter((s) => PLATFORMS.has(String(s.platform).toLowerCase()))
      .map((s) => ({
        list_date: date,
        domain: d.domain,
        platform: String(s.platform).toLowerCase(),
        kind: s.kind === "auction" ? "auction" : "backorder",
        price: s.price ?? null,
        ends_at: s.ends_at ?? null,
      })),
  );
  const uniq = [...new Map(listings.map((l) => [`${l.domain}|${l.platform}`, l])).values()];
  const { error: e2 } = await supabase.from("expired_listings").upsert(uniq, { onConflict: "list_date,domain,platform" });
  if (e2) return NextResponse.json({ error: e2.message }, { status: 500 });

  // Trafic : seulement les domaines jamais relevés ou relevés il y a plus de 7 jours
  let traffic: { checked: number; cost_usd: number; error?: string } = { checked: 0, cost_usd: 0 };
  if (body.fetch_traffic !== false) {
    const todo = names.filter((n) => {
      if (given.has(n)) return false;
      const at = known.get(n)?.traffic_checked_at;
      return !at || Date.now() - new Date(at).getTime() > STALE_MS;
    });
    if (todo.length) {
      try {
        const { results, costUsd } = await fetchTraffic(todo);
        for (const t of results) {
          await supabase.from("expired_domains").update({
            traffic_current: t.current, traffic_6m: t.six_months, traffic_peak: t.peak,
            peak_month: t.peak_month, traffic_series: t.series, traffic_checked_at: now,
          }).eq("domain", t.domain);
        }
        traffic = { checked: results.length, cost_usd: costUsd };
      } catch (e) {
        traffic = { checked: 0, cost_usd: 0, error: e instanceof Error ? e.message : String(e) };
      }
    }
  }

  return NextResponse.json({ ok: true, date, domains: rows.length, listings: uniq.length, traffic });
}

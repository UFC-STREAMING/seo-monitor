// Entonnoir des sites expirés nutra (Leo 12/10/2026) : fiche par fiche,
// Search Console (impressions, clics Google, position) → ventes Everflow de la fiche.
// Une vente est rattachée à sa fiche par le site d'origine (referer) + sub1 = nom de la
// page (les workers des shops posent sub1=<slug de la page>).

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { EVERFLOW_NETWORKS, fetchConversions } from "@/lib/everflow/client";

export interface FichePerf {
  host: string;
  path: string;
  slug: string;
  google_clicks: number;
  impressions: number;
  position: number | null;
  top_query: string | null;
  sales: number;
  revenue_usd: number;
  usd_per_100_clicks: number | null;
  offers: string[];
  drcash_leads: number;
  networks: string[];
  measured: boolean; // false = le bouton ne passe par aucun réseau Everflow : ventes invisibles ici
  findings: { level: "bad" | "warn" | "good"; text: string }[];
}

export interface SitePerf {
  host: string;
  google_clicks: number;
  impressions: number;
  sales: number;
  revenue_usd: number;
  usd_per_100_clicks: number | null;
  fiches: number;
}

const EVERFLOW_HOSTS = /clickrtrckr|treejammer|diginear|primesavingslink|premierdiscountlink|tricklyn|spacefaller|pixlbonk|contact-account-manager/i;
// Dr.Cash : trackers doctor*.com, ventes reçues par postback (table network_conversions)
const DRCASH_HOSTS = /(^|\.)doctor[a-z0-9-]*\.com$|drcash\.io$/i;
const MEASURED_HOSTS = (h: string) => EVERFLOW_HOSTS.test(h) || DRCASH_HOSTS.test(h);
const SALE_STATUS = /approv|confirm|accept|sale|paid|success|hold/i;
const slugOf = (path: string) => (path.split("/").filter(Boolean).pop() ?? "").toLowerCase();

export async function expiredFunnel(supabase: SupabaseClient<Database>, days: number) {
  const to = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);

  const [{ data: pages, error }, { data: wins }] = await Promise.all([
    supabase.rpc("gsc_page_stats", { p_days: days }),
    supabase.rpc("gsc_quick_wins", { p_days: days }),
  ]);
  if (error) throw new Error(error.message);

  // Ventes par (site d'origine, sub1)
  const sales = new Map<string, { n: number; rev: number; offers: Set<string> }>();
  const siteSales = new Map<string, { n: number; rev: number }>();
  for (const net of EVERFLOW_NETWORKS) {
    const key = process.env[net.tokenEnv];
    if (!key) continue;
    for (const c of await fetchConversions(key, from, to)) {
      if (!c.refererHost) continue;
      const host = c.refererHost.replace(/^www\./, "");
      const s = siteSales.get(host) ?? { n: 0, rev: 0 };
      s.n++; s.rev += c.revenueUsd; siteSales.set(host, s);
      const k = `${host}|${(c.sub1 ?? "").toLowerCase()}`;
      const f = sales.get(k) ?? { n: 0, rev: 0, offers: new Set<string>() };
      f.n++; f.rev += c.revenueUsd; f.offers.add(c.offerName.split(/ [{([]| - /)[0].replace(/\*\*HOT\*\*|!/g, "").trim());
      sales.set(k, f);
    }
  }

  const { data: nets } = await supabase.from("fiche_networks").select("host, path, targets, everflow");

  // Dr.Cash : leads et ventes validées par code de stream (postbacks)
  const { data: dc } = await supabase
    .from("network_conversions")
    .select("stream, status, payout")
    .eq("network", "drcash")
    .gte("created_at", `${from}T00:00:00Z`);
  const byStream = new Map<string, { leads: number; sales: number; rev: number }>();
  for (const c of dc ?? []) {
    if (!c.stream) continue;
    const v = byStream.get(c.stream) ?? { leads: 0, sales: 0, rev: 0 };
    v.leads++;
    if (SALE_STATUS.test(c.status ?? "")) { v.sales++; v.rev += Number(c.payout ?? 0); }
    byStream.set(c.stream, v);
  }
  const netOf = new Map((nets ?? []).map((n) => [`${n.host}|${n.path}`, n]));

  // Médiane des $ / 100 clics Google des fiches qui vendent, pour juger les autres
  const fiches: FichePerf[] = (pages ?? []).map((p) => {
    const slug = slugOf(p.path);
    const s = sales.get(`${p.host}|${slug}`);
    const clicks = Number(p.clicks);
    // + ventes Dr.Cash des streams présents sur la fiche
    const streams = (netOf.get(`${p.host}|${p.path}`)?.targets ?? []).filter((h) => DRCASH_HOSTS.test(h)).map((h) => h.split(".")[0]);
    const drc = streams.reduce((a, st) => { const v = byStream.get(st); return v ? { leads: a.leads + v.leads, sales: a.sales + v.sales, rev: a.rev + v.rev } : a; }, { leads: 0, sales: 0, rev: 0 });
    const rev = (s?.rev ?? 0) + drc.rev;
    return {
      host: p.host,
      path: p.path,
      slug,
      google_clicks: clicks,
      impressions: Number(p.impressions),
      position: p.position,
      top_query: p.top_query,
      sales: (s?.n ?? 0) + drc.sales,
      drcash_leads: drc.leads,
      revenue_usd: Math.round(rev),
      usd_per_100_clicks: clicks ? Math.round((rev / clicks) * 100 * 10) / 10 : null,
      offers: [...(s?.offers ?? [])],
      networks: netOf.get(`${p.host}|${p.path}`)?.targets ?? [],
      // Mesurée seulement si TOUS les boutons passent par Everflow (sinon une partie des ventes est invisible)
      measured: (() => {
        const t = netOf.get(`${p.host}|${p.path}`)?.targets ?? [];
        return t.length === 0 || t.every(MEASURED_HOSTS);
      })(),
      findings: [],
    };
  });
  const selling = fiches.filter((f) => f.sales > 0 && f.google_clicks >= 30).map((f) => f.usd_per_100_clicks ?? 0).sort((a, b) => a - b);
  const median = selling.length ? selling[Math.floor(selling.length / 2)] : null;

  for (const f of fiches) {
    if (!f.slug) continue; // page d'accueil : pas de fiche produit
    if (!f.measured)
      f.findings.push({ level: "warn", text: `Ventes partiellement mesurées : boutons aussi vers ${f.networks.filter((h) => !MEASURED_HOSTS(h)).slice(0, 3).join(", ")} (réseau non branché)` });
    else if (f.google_clicks >= 100 && f.sales === 0)
      f.findings.push({ level: "bad", text: `${f.google_clicks} clics Google, 0 vente : lien affilié, offre ou bouton de la fiche à vérifier` });
    else if (median && f.google_clicks >= 100 && (f.usd_per_100_clicks ?? 0) < median / 3)
      f.findings.push({ level: "warn", text: `${f.usd_per_100_clicks} $ pour 100 clics contre ${median} $ en médiane : la fiche convertit mal` });
    if (f.sales > 0 && f.position !== null && f.position > 3)
      f.findings.push({ level: "good", text: `Vend (${f.revenue_usd} $) en position ${f.position.toFixed(1)} : la pousser dans le top 3 rapporterait plus` });
    if (f.sales >= 3) f.findings.push({ level: "good", text: `Fiche qui vend : candidat EMD si la marque n'en a pas` });
  }

  const sites = new Map<string, SitePerf>();
  for (const f of fiches) {
    const s = sites.get(f.host) ?? { host: f.host, google_clicks: 0, impressions: 0, sales: 0, revenue_usd: 0, usd_per_100_clicks: null, fiches: 0 };
    s.google_clicks += f.google_clicks; s.impressions += f.impressions; s.fiches += f.slug ? 1 : 0;
    sites.set(f.host, s);
  }
  for (const [host, v] of siteSales) {
    const s = sites.get(host) ?? { host, google_clicks: 0, impressions: 0, sales: 0, revenue_usd: 0, usd_per_100_clicks: null, fiches: 0 };
    s.sales = v.n; s.revenue_usd = Math.round(v.rev);
    sites.set(host, s);
  }
  for (const s of sites.values()) s.usd_per_100_clicks = s.google_clicks ? Math.round((s.revenue_usd / s.google_clicks) * 1000) / 10 : null;

  // Requêtes à gagner sur les fiches qui vendent déjà (plus de rentabilité par position gagnée)
  const sellingKeys = new Set(fiches.filter((f) => f.sales > 0).map((f) => `${f.host}|${f.slug}`));
  const quickWins = (wins ?? [])
    .map((w) => {
      const slug = slugOf(w.page.replace(/^https?:\/\/[^/]+/, ""));
      return { ...w, slug, sells: sellingKeys.has(`${w.host}|${slug}`) };
    })
    .sort((a, b) => Number(b.sells) - Number(a.sells) || Number(b.impressions) - Number(a.impressions))
    .slice(0, 25);

  return {
    median_usd_per_100_clicks: median,
    sites: [...sites.values()].sort((a, b) => b.revenue_usd - a.revenue_usd || b.google_clicks - a.google_clicks),
    fiches: fiches.filter((f) => f.slug).sort((a, b) => (b.findings.some((x) => x.level === "bad") ? 1 : 0) - (a.findings.some((x) => x.level === "bad") ? 1 : 0) || b.google_clicks - a.google_clicks),
    quick_wins: quickWins,
  };
}


/** Cibles des boutons d'une fiche : liens /out/<slug>/<base64url>.<sig>/ décodés + liens directs. */
export function ficheTargets(html: string): string[] {
  const hosts = new Set<string>();
  for (const m of html.matchAll(/\/out\/[^/"]+\/([A-Za-z0-9_-]+)\.[a-f0-9]+\/?"/g)) {
    try {
      const url = Buffer.from(m[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
      hosts.add(new URL(url).hostname.replace(/^www\./, ""));
    } catch { /* lien illisible */ }
  }
  for (const m of html.matchAll(/href="https?:\/\/([^/"]+)[^"]*"/g)) {
    if (EVERFLOW_HOSTS.test(m[1]) || /track|tracker|offer|click|kshop|doctormurin/i.test(m[1])) hosts.add(m[1].replace(/^www\./, ""));
  }
  return [...hosts];
}

/** Scan quotidien des fiches qui ont du trafic Google (sans jamais suivre un lien affilié). */
export async function scanFiches(supabase: SupabaseClient<Database>, days = 28): Promise<{ scanned: number; errors: number }> {
  const { data: pages } = await supabase.rpc("gsc_page_stats", { p_days: days });
  const list = (pages ?? []).filter((p) => Number(p.clicks) >= 10 && slugOf(p.path));
  let scanned = 0, errors = 0;
  for (let i = 0; i < list.length; i += 6) {
    await Promise.all(list.slice(i, i + 6).map(async (p) => {
      try {
        const res = await fetch(`https://${p.host}${p.path.endsWith("/") ? p.path : p.path + "/"}`, {
          headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36" },
          signal: AbortSignal.timeout(15_000),
        });
        if (!res.ok) { errors++; return; }
        const targets = ficheTargets(await res.text());
        await supabase.from("fiche_networks").upsert({ host: p.host, path: p.path, targets, everflow: targets.some((t) => EVERFLOW_HOSTS.test(t)), scanned_at: new Date().toISOString() });
        scanned++;
      } catch { errors++; }
    }));
  }
  return { scanned, errors };
}

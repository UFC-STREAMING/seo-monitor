// Vérification du lien d'affiliation de chaque EMD — SANS JAMAIS toucher le
// tracker. Chaque requête vers clickrtrckr/diginear/premierdiscountlink… est
// un clic facturé (incident « clics fantômes » de septembre 2026).
//
// 1. On repère le chemin des boutons sur la home (/go/, /goto/officiel/…),
//    puis GET de ce chemin en redirect:"manual" → on lit la cible dans
//    l'en-tête Location (ou dans la meta refresh / location.replace si le /go/
//    est une page HTML). La cible n'est jamais requêtée.
// 2. On retrouve l'offre Everflow par le chemin du lien (/<aff>/<offre>/) dans
//    le catalogue alloffers des 3 réseaux → statut d'approbation réel.
// 3. Contrôle du sub1 (= domaine avec tirets, cf. attribution revenus).

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { EVERFLOW_NETWORKS } from "@/lib/everflow/client";
import { syncGeoKeywords } from "@/lib/positions/geo-extra";

const EFLOW_API = "https://api.eflow.team/v1/affiliates";
// MediaScaler renvoie une erreur code=8 au-delà de 100 offres par page
const PAGE_SIZE = 100;

export type AffiliateVerdict = "ok" | "pending" | "ko";

export interface AffiliateCheck {
  domain: string;
  verdict: AffiliateVerdict;
  /** Cible du /go/ (lien tracker), jamais ouverte. */
  target_url: string | null;
  network: string | null;
  offer_id: number | null;
  offer_name: string | null;
  /** Raison lisible (FR) affichée dans le tableau. */
  detail: string;
}

export interface OfferInfo {
  network: string;
  offerId: number;
  name: string;
  offerStatus: string;
  affiliateStatus: string | null;
  trackingUrl: string | null;
}

export interface OfferCatalog {
  /** Offres indexées par chemin de tracker (/<aff>/<offre>/). */
  byTracker: Map<string, OfferInfo>;
  /** Toutes les offres, pour chercher une alternative approuvée. */
  all: OfferInfo[];
}

// Domaines de tracking Everflow connus → réseau
const EVERFLOW_TRACKING_HOSTS: Record<string, string> = {
  "clickrtrckr.com": "MediaScaler",
  "treejammer.com": "MediaScaler",
  "diginear.com": "SmartAdv",
  "premierdiscountlink.com": "SmashLoud",
  "primesavingslink.com": "SmashLoud",
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Clé de correspondance : 2 premiers segments du chemin (/<aff>/<offre>/).
 * Le domaine de tracking varie selon l'offre pour un même code
 * (clickrtrckr ↔ treejammer, premierdiscountlink ↔ primesavingslink).
 */
function trackerKey(url: string): string | null {
  try {
    const u = new URL(url);
    const seg = u.pathname.split("/").filter(Boolean);
    if (seg.length < 2) return null;
    return `${seg[0]}/${seg[1]}`.toLowerCase();
  } catch {
    return null;
  }
}

/** Catalogue des offres des 3 réseaux Everflow, indexé par chemin de tracker. */
export async function loadEverflowOffers(): Promise<OfferCatalog> {
  const index = new Map<string, OfferInfo>();
  const all: OfferInfo[] = [];
  for (const net of EVERFLOW_NETWORKS) {
    const key = process.env[net.tokenEnv];
    if (!key) continue;
    for (let page = 1; page < 200; page++) {
      // Everflow : 5 req/s max par clé ; erreurs code=8 sporadiques → 3 essais
      let text: string | null = null;
      for (let attempt = 0; attempt < 3 && text === null; attempt++) {
        await sleep(attempt ? 1500 : 250);
        const res = await fetch(`${EFLOW_API}/alloffers?page_size=${PAGE_SIZE}&page=${page}`, {
          headers: { "X-Eflow-API-Key": key },
        });
        if (res.ok) text = await res.text();
      }
      if (text === null) throw new Error(`Everflow ${net.key}: page ${page} illisible`);
      const json = JSON.parse(text.replace(/[\u0000-\u001f]/g, " ")) as {
        offers?: Array<{
          network_offer_id: number;
          name: string;
          offer_status: string;
          tracking_url?: string;
          relationship?: { offer_affiliate_status?: string };
        }>;
        paging?: { total_count: number };
      };
      const offers = json.offers ?? [];
      for (const o of offers) {
        const info: OfferInfo = {
          network: net.key,
          offerId: o.network_offer_id,
          name: o.name,
          offerStatus: o.offer_status,
          affiliateStatus: o.relationship?.offer_affiliate_status ?? null,
          trackingUrl: o.tracking_url || null,
        };
        all.push(info);
        const k = o.tracking_url ? trackerKey(o.tracking_url) : null;
        if (k) index.set(k, info);
      }
      if (offers.length < PAGE_SIZE) break;
    }
  }
  return { byTracker: index, all };
}

export interface ClickStats {
  network: string;
  offer: string;
  valid: number;
  invalid: number;
  conversions: number;
}

/**
 * Clics Everflow des 30 derniers jours par sub1 (= domaine avec tirets).
 * C'est LA preuve qu'un lien marche : un clic valide = Everflow accepte le
 * lien, quel que soit le numéro d'offre. Les clics invalides (bots, doublons)
 * sont normaux, même sur des liens qui rapportent.
 */
export async function loadClickStats(): Promise<Map<string, ClickStats>> {
  const out = new Map<string, ClickStats>();
  const to = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);
  for (const net of EVERFLOW_NETWORKS) {
    const key = process.env[net.tokenEnv];
    if (!key) continue;
    await sleep(250);
    const res = await fetch(`${EFLOW_API}/reporting/entity`, {
      method: "POST",
      headers: { "X-Eflow-API-Key": key, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to,
        timezone_id: 67,
        currency_id: "USD",
        query: { filters: [] },
        columns: [{ column: "offer" }, { column: "sub1" }],
      }),
    });
    if (!res.ok) continue;
    const json = JSON.parse((await res.text()).replace(/[\u0000-\u001f]/g, " ")) as {
      table?: Array<{
        columns: Array<{ column_type: string; id?: string; label?: string }>;
        reporting: { total_click?: number; invalid_click?: number; cv?: number };
      }>;
    };
    for (const row of json.table ?? []) {
      const col = (t: string) => row.columns.find((c) => c.column_type === t);
      const sub1 = (col("sub1")?.label || col("sub1")?.id || "").toLowerCase();
      if (!sub1 || sub1 === "n/a") continue;
      const prev = out.get(sub1);
      const valid = row.reporting.total_click ?? 0;
      const stats: ClickStats = {
        network: net.key,
        offer: col("offer")?.label ?? "",
        valid: (prev?.valid ?? 0) + valid,
        invalid: (prev?.invalid ?? 0) + (row.reporting.invalid_click ?? 0),
        conversions: (prev?.conversions ?? 0) + (row.reporting.cv ?? 0),
      };
      // Garder le nom de l'offre qui reçoit le plus de clics valides
      if (prev && prev.valid > valid) stats.offer = prev.offer;
      out.set(sub1, stats);
    }
  }
  return out;
}

const normBrand = (s: string) => s.toLowerCase().normalize("NFD").replace(/[^a-z0-9]/g, "");
// Everflow écrit « UK » pour le Royaume-Uni
const toEverflowCountry = (iso: string) => (iso.toUpperCase() === "GB" ? "UK" : iso.toUpperCase());

const NETWORK_RANK: Record<string, number> = { mediascaler: 0, smartadv: 1, smashloud: 2 };

const countriesCache = new Map<string, string[]>();

/** Pays autorisés d'une offre (ruleset de la relation affilié), lus par l'API. */
export async function offerCountries(offer: OfferInfo): Promise<string[]> {
  const cacheKey = `${offer.network}#${offer.offerId}`;
  const cached = countriesCache.get(cacheKey);
  if (cached) return cached;
  const net = EVERFLOW_NETWORKS.find((n) => n.key === offer.network);
  const key = net ? process.env[net.tokenEnv] : undefined;
  let countries: string[] = [];
  if (key) {
    await sleep(250);
    const res = await fetch(`${EFLOW_API}/offers/${offer.offerId}`, {
      headers: { "X-Eflow-API-Key": key },
    });
    if (res.ok) {
      const json = JSON.parse((await res.text()).replace(/[\u0000-\u001f]/g, " ")) as {
        relationship?: { ruleset?: { countries?: Array<{ country_code?: string }> } };
      };
      countries = (json.relationship?.ruleset?.countries ?? [])
        .map((c) => (c.country_code ?? "").toUpperCase())
        .filter(Boolean);
    }
  }
  countriesCache.set(cacheKey, countries);
  return countries;
}

/**
 * Offre de remplacement : même marque (mot-clé principal du site), active,
 * APPROUVÉE pour nous, et dont le ruleset couvre le pays du site.
 * Ne change rien en prod : c'est une proposition affichée sur le dashboard.
 */
export async function findApprovedAlternative(
  brand: string,
  countryIso: string | null,
  catalog: OfferCatalog,
  exclude?: { network: string | null; offerId: number | null }
): Promise<string | null> {
  const b = normBrand(brand);
  if (b.length < 4) return null;
  const candidates = catalog.all.filter(
    (o) =>
      o.offerStatus === "active" &&
      o.affiliateStatus === "approved" &&
      o.trackingUrl &&
      normBrand(o.name).includes(b) &&
      !(exclude && o.network === exclude.network && o.offerId === exclude.offerId)
  );
  if (!candidates.length) return null;
  // Priorité Leo : MediaScaler > SmartAdv > SmashLoud. SmashLoud en dernier recours :
  // ses landers sont géo-bloqués, impossibles à scraper hors du pays ciblé.
  candidates.sort((a, b) => (NETWORK_RANK[a.network] ?? 9) - (NETWORK_RANK[b.network] ?? 9));
  const country = countryIso ? toEverflowCountry(countryIso) : null;
  for (const o of candidates) {
    const countries = await offerCountries(o);
    if (!country || countries.includes(country)) {
      const warn = o.network === "smashloud" ? " (SmashLoud : seul réseau dispo, lander géo-bloqué)" : "";
      return `${o.network} #${o.offerId} « ${o.name.slice(0, 70)} »${country ? ` — approuvée, couvre ${country}` : " — approuvée"}${warn}`;
    }
  }
  return null;
}

const UA = "Mozilla/5.0 (seo-monitor affiliate check)";
const CTA_HINT = /go|out|visit|offi|buy|order|link|kaufen|comprar|acheter|bonus|play|shop/i;

/**
 * Chemin réellement utilisé par les boutons de la page d'accueil (/go/,
 * /goto/officiel/, /go/psf…) : le lien interne le plus fréquent qui ressemble
 * à un CTA. null = aucun bouton d'affiliation sur la page.
 */
async function findCtaPath(domain: string): Promise<string | null | undefined> {
  try {
    const res = await fetch(`https://${domain}/`, {
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return undefined;
    const html = await res.text();
    const bare = domain.replace(/^www\./, "").replace(/\./g, "\\.");
    const counts = new Map<string, number>();
    for (const m of html.matchAll(/href=["']([^"'#]+)["']/gi)) {
      const href = m[1].replace(new RegExp(`^https?://(www\\.)?${bare}`, "i"), "");
      if (!href.startsWith("/") || href.startsWith("//")) continue;
      const pathOnly = href.split("?")[0];
      if (/\.[a-z0-9]{2,5}$/i.test(pathOnly) || !CTA_HINT.test(pathOnly)) continue;
      counts.set(href, (counts.get(href) ?? 0) + 1);
    }
    const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    return best ? best[0] : null;
  } catch {
    return undefined;
  }
}

/** Lit la cible du CTA sans la suivre. */
async function readGoTarget(
  domain: string,
  ctaPath: string
): Promise<{ status: number | null; target: string | null }> {
  const url = `https://${domain}${ctaPath}`;
  try {
    const res = await fetch(url, {
      redirect: "manual",
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(10_000),
    });
    const loc = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && loc) {
      return { status: res.status, target: new URL(loc, url).toString() };
    }
    if (res.status === 200) {
      const html = (await res.text()).slice(0, 20_000);
      const m =
        html.match(/http-equiv=["']refresh["'][^>]*url=([^"'>\s]+)/i) ??
        html.match(/location\.(?:replace|href)\s*\(?\s*=?\s*["']([^"']+)["']/i);
      return { status: 200, target: m ? m[1].replace(/&amp;/g, "&") : null };
    }
    return { status: res.status, target: null };
  } catch {
    return { status: null, target: null };
  }
}

function expectedSub1(domain: string): string {
  return domain.toLowerCase().replace(/^www\./, "").replace(/\./g, "-");
}

export async function checkAffiliateLink(
  domain: string,
  offers: Map<string, OfferInfo>,
  clicks: Map<string, ClickStats> = new Map()
): Promise<AffiliateCheck> {
  const base = { domain, target_url: null, network: null, offer_id: null, offer_name: null };
  const cta = await findCtaPath(domain);
  if (cta === undefined) return { ...base, verdict: "ko", detail: "Site injoignable" };
  if (cta === null) {
    return { ...base, verdict: "ko", detail: "Aucun bouton d'affiliation sur la page d'accueil" };
  }
  const { status, target } = await readGoTarget(domain, cta);

  if (status === null) return { ...base, verdict: "ko", detail: `${cta} injoignable` };
  if (!target) {
    const why =
      status === 503
        ? `${cta} en 503 : tracker pas encore branché`
        : status === 404
          ? `${cta} introuvable (404)`
          : status === 200
            ? `${cta} ne redirige pas (renvoie une page)`
            : `${cta} répond ${status}`;
    return { ...base, verdict: "ko", detail: why };
  }

  let targetHost = "";
  try {
    targetHost = new URL(target).hostname;
  } catch {
    return { ...base, verdict: "ko", target_url: target, detail: "Cible du /go/ invalide" };
  }
  if (targetHost.replace(/^www\./, "") === domain.replace(/^www\./, "")) {
    return { ...base, verdict: "ko", target_url: target, detail: `${cta} boucle sur le site` };
  }

  const offer = offers.get(trackerKey(target) ?? "");
  if (!offer) {
    const everflowNet = EVERFLOW_TRACKING_HOSTS[targetHost.replace(/^www\./, "")];
    if (!everflowNet) {
      return {
        ...base,
        verdict: "pending",
        target_url: target,
        detail: `Lien direct marchand/autre réseau (${targetHost}) : redirige bien, approbation non vérifiable par API`,
      };
    }
    // Le numéro d'offre du lien n'apparaît pas dans la liste de l'API (offre
    // privée, renumérotée…) : ça ne veut PAS dire que le lien est mort. On juge
    // sur les clics réels. Règle Leo 08/10 : un lien qui marche, on le garde.
    const sub1 = (new URL(target).searchParams.get("sub1") ?? "").toLowerCase();
    const st = sub1 ? clicks.get(sub1) : undefined;
    const name = st?.offer ? ` (« ${st.offer.slice(0, 50)} »)` : "";
    if (st && st.valid > 0) {
      return {
        ...base,
        verdict: "ok",
        target_url: target,
        network: everflowNet,
        offer_name: st.offer || null,
        detail: `Lien actif : ${st.valid} clics valides sur 30 j${st.conversions ? `, ${st.conversions} ventes` : ""}${name}`,
      };
    }
    if (st && st.invalid > 0) {
      return {
        ...base,
        verdict: "ko",
        target_url: target,
        network: everflowNet,
        offer_name: st.offer || null,
        detail: `Everflow refuse tous les clics depuis 30 j (${st.invalid} invalides, 0 valide)${name}`,
      };
    }
    return {
      ...base,
      verdict: "pending",
      target_url: target,
      network: everflowNet,
      detail: `Redirige vers ${everflowNet}, aucun clic sur 30 j : impossible de juger, lien laissé tel quel`,
    };
  }

  const found = {
    ...base,
    target_url: target,
    network: offer.network,
    offer_id: offer.offerId,
    offer_name: offer.name,
  };
  if (offer.offerStatus !== "active") {
    return { ...found, verdict: "ko", detail: `Offre ${offer.offerStatus} chez ${offer.network}` };
  }
  if (offer.affiliateStatus && offer.affiliateStatus !== "approved") {
    return {
      ...found,
      verdict: "ko",
      detail: `Pas approuvé chez ${offer.network} (${offer.affiliateStatus})`,
    };
  }
  const sub1 = new URL(target).searchParams.get("sub1");
  if (sub1 !== expectedSub1(domain)) {
    return {
      ...found,
      verdict: "pending",
      detail: sub1
        ? `Approuvé, mais sub1="${sub1}" au lieu de "${expectedSub1(domain)}" (revenus mal attribués)`
        : "Approuvé, mais sans sub1 (revenus non attribués)",
    };
  }
  return { ...found, verdict: "ok", detail: `Approuvé chez ${offer.network}, sub1 correct` };
}

/** Vérifie tous les EMD actifs et enregistre le résultat sur `sites`. */
export async function runAffiliateChecks(
  supabase: SupabaseClient<Database>
): Promise<AffiliateCheck[]> {
  const { data: sites, error } = await supabase
    .from("sites")
    .select("id, domain, location_code, keywords(keyword, is_primary, location_code)")
    .eq("category", "emd")
    .eq("is_active", true);
  if (error) throw new Error(`sites fetch: ${error.message}`);

  const { data: locations } = await supabase.from("locations").select("code, country_iso");
  const isoByCode = new Map((locations ?? []).map((l) => [l.code, l.country_iso]));

  const catalog = await loadEverflowOffers();
  const clicks = await loadClickStats();
  const results: AffiliateCheck[] = [];
  const list = sites ?? [];
  for (let i = 0; i < list.length; i += 8) {
    const batch = list.slice(i, i + 8);
    const checks = await Promise.all(
      batch.map((s) => checkAffiliateLink(s.domain, catalog.byTracker, clicks))
    );
    for (let j = 0; j < batch.length; j++) {
      const c = checks[j];
      results.push(c);

      // Lien KO seulement → proposer une offre approuvée (jamais de bascule auto)
      let suggestion: string | null = null;
      if (c.verdict === "ko" && c.detail !== "Site injoignable") {
        const kws = (batch[j].keywords ?? []) as Array<{
          keyword: string;
          is_primary: boolean;
          location_code: number | null;
        }>;
        const primary = kws.find((k) => k.is_primary) ?? kws[0];
        const brand = primary?.keyword ?? batch[j].domain.split(".")[0];
        const code = primary?.location_code ?? batch[j].location_code;
        const iso = code ? isoByCode.get(code) ?? null : null;
        suggestion = await findApprovedAlternative(brand, iso, catalog, {
          network: c.network,
          offerId: c.offer_id,
        });
      }

      await supabase
        .from("sites")
        .update({
          affiliate_url: c.target_url,
          affiliate_status: c.verdict,
          affiliate_detail: c.detail,
          affiliate_offer: c.offer_name
            ? `${c.network} #${c.offer_id} — ${c.offer_name}`
            : null,
          affiliate_suggestion: suggestion,
          affiliate_checked_at: new Date().toISOString(),
        })
        .eq("id", batch[j].id);
    }
  }

  // Pays anglophones à suivre en plus pour les EMD .com/.org/.net (relevé de 7h)
  try {
    await syncGeoKeywords(supabase, catalog);
  } catch (err) {
    console.error("syncGeoKeywords", err);
  }
  return results;
}

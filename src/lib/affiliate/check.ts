// Vérification du lien d'affiliation de chaque EMD — SANS JAMAIS toucher le
// tracker. Chaque requête vers clickrtrckr/diginear/premierdiscountlink… est
// un clic facturé (incident « clics fantômes » de septembre 2026).
//
// 1. GET https://<domaine>/go/ en redirect:"manual" → on lit la cible dans
//    l'en-tête Location (ou dans la meta refresh / location.replace si le /go/
//    est une page HTML). La cible n'est jamais requêtée.
// 2. On retrouve l'offre Everflow par le chemin du lien (/<aff>/<offre>/) dans
//    le catalogue alloffers des 3 réseaux → statut d'approbation réel.
// 3. Contrôle du sub1 (= domaine avec tirets, cf. attribution revenus).

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { EVERFLOW_NETWORKS } from "@/lib/everflow/client";

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

interface OfferInfo {
  network: string;
  offerId: number;
  name: string;
  offerStatus: string;
  affiliateStatus: string | null;
}

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
export async function loadEverflowOffers(): Promise<Map<string, OfferInfo>> {
  const index = new Map<string, OfferInfo>();
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
        const k = o.tracking_url ? trackerKey(o.tracking_url) : null;
        if (!k) continue;
        index.set(k, {
          network: net.key,
          offerId: o.network_offer_id,
          name: o.name,
          offerStatus: o.offer_status,
          affiliateStatus: o.relationship?.offer_affiliate_status ?? null,
        });
      }
      if (offers.length < PAGE_SIZE) break;
    }
  }
  return index;
}

/** Lit la cible du /go/ sans la suivre. */
async function readGoTarget(
  domain: string
): Promise<{ status: number | null; target: string | null }> {
  try {
    const res = await fetch(`https://${domain}/go/`, {
      redirect: "manual",
      headers: { "User-Agent": "Mozilla/5.0 (seo-monitor affiliate check)" },
      signal: AbortSignal.timeout(10_000),
    });
    const loc = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && loc) {
      return { status: res.status, target: new URL(loc, `https://${domain}/go/`).toString() };
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
  offers: Map<string, OfferInfo>
): Promise<AffiliateCheck> {
  const base = { domain, target_url: null, network: null, offer_id: null, offer_name: null };
  const { status, target } = await readGoTarget(domain);

  if (status === null) return { ...base, verdict: "ko", detail: "Site injoignable" };
  if (!target) {
    const why =
      status === 503
        ? "/go/ en 503 : tracker pas encore branché"
        : status === 404
          ? "/go/ introuvable (404)"
          : status === 200
            ? "/go/ ne redirige pas (renvoie une page)"
            : `/go/ répond ${status}`;
    return { ...base, verdict: "ko", detail: why };
  }

  let targetHost = "";
  try {
    targetHost = new URL(target).hostname;
  } catch {
    return { ...base, verdict: "ko", target_url: target, detail: "Cible du /go/ invalide" };
  }
  if (targetHost.replace(/^www\./, "") === domain.replace(/^www\./, "")) {
    return { ...base, verdict: "ko", target_url: target, detail: "/go/ boucle sur le site" };
  }

  const offer = offers.get(trackerKey(target) ?? "");
  if (!offer) {
    return {
      ...base,
      verdict: "pending",
      target_url: target,
      detail: `Lien hors Everflow (${targetHost}) : statut non vérifiable par API`,
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
    .select("id, domain")
    .eq("category", "emd")
    .eq("is_active", true);
  if (error) throw new Error(`sites fetch: ${error.message}`);

  const offers = await loadEverflowOffers();
  const results: AffiliateCheck[] = [];
  const list = sites ?? [];
  for (let i = 0; i < list.length; i += 8) {
    const batch = list.slice(i, i + 8);
    const checks = await Promise.all(batch.map((s) => checkAffiliateLink(s.domain, offers)));
    for (let j = 0; j < batch.length; j++) {
      const c = checks[j];
      results.push(c);
      await supabase
        .from("sites")
        .update({
          affiliate_url: c.target_url,
          affiliate_status: c.verdict,
          affiliate_detail: c.detail,
          affiliate_offer: c.offer_name
            ? `${c.network} #${c.offer_id} — ${c.offer_name}`
            : null,
          affiliate_checked_at: new Date().toISOString(),
        })
        .eq("id", batch[j].id);
    }
  }
  return results;
}

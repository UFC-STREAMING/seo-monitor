// Opportunités EMD : quelles offres × pays vendent déjà via les sites expirés
// (shops nutra) et n'ont pas encore d'EMD. Source = conversions Everflow :
// le champ `referer` donne le site d'origine (les shops n'envoient que
// sub1=<slug de page>), `country` le pays de l'acheteur.

import { EVERFLOW_NETWORKS } from "@/lib/everflow/client";

const EFLOW_API = "https://api.eflow.team/v1/affiliates";

export interface EmdOpportunity {
  brand: string;
  offer: string;
  offerId: number | null;
  network: string;
  offerStatus: string;
  country: string;
  conversions: number;
  revenueUsd: number;
  /** Sites d'origine, du plus rentable au moins rentable. */
  sources: { host: string; revenueUsd: number }[];
  /** EMD déjà possédés pour cette marque (tous pays). */
  existingEmds: string[];
}

interface RawConversion {
  referer?: string;
  country?: string;
  revenue?: number;
  is_event?: boolean;
  relationship?: {
    offer?: { name?: string; offer_status?: string; network_offer_id?: number };
    offer_url?: { name?: string };
  };
}

function refererHost(referer: string | undefined): string {
  if (!referer) return "(inconnu)";
  let h = referer.trim().toLowerCase();
  if (h.includes("://")) h = h.split("://")[1];
  h = h.split("/")[0].split(":")[0].replace(/^www\./, "");
  return h || "(inconnu)";
}

/** "**HOT** Lulutox {+Advertorial…} [IT, …]" → "Lulutox". */
export function offerBrand(offerName: string, offerUrlName?: string): string {
  const cleaned = offerName
    .replace(/\*\*HOT\*\*/gi, "")
    .replace(/^[\s!]*HOT OFFER\b/i, "")
    .replace(/^[\s!\-–]+/, "")
    .split(/ [{([]| - | ~ /)[0]
    .replace(/\b(SS|ME)\b/g, "")
    .trim();
  if (cleaned) return cleaned;
  // "! HOT OFFER (…)" : le vrai nom est dans le lien de l'offre
  return (offerUrlName ?? offerName).split(/ [-–] /)[0].trim();
}

const alnum = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

async function fetchRawConversions(apiKey: string, from: string, to: string) {
  const out: RawConversion[] = [];
  for (let page = 1; page <= 25; page++) {
    const res = await fetch(`${EFLOW_API}/reporting/conversions`, {
      method: "POST",
      headers: { "X-Eflow-API-Key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to,
        timezone_id: 67,
        show_conversions: true,
        show_events: false,
        query: { filters: [] },
        paging: { page, page_size: 2000 },
      }),
    });
    if (!res.ok) throw new Error(`Everflow conversions HTTP ${res.status}`);
    const json = (await res.json()) as {
      conversions?: RawConversion[];
      paging?: { total_count?: number };
    };
    out.push(...(json.conversions ?? []));
    if (out.length >= (json.paging?.total_count ?? 0) || !json.conversions?.length) break;
  }
  return out;
}

export async function computeEmdOpportunities(
  emdDomains: string[],
  days = 90
): Promise<EmdOpportunity[]> {
  const to = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);
  const emdSet = new Set(emdDomains.map((d) => d.toLowerCase().replace(/^www\./, "")));

  const groups = new Map<string, EmdOpportunity & { _src: Map<string, number> }>();

  for (const net of EVERFLOW_NETWORKS) {
    const key = process.env[net.tokenEnv];
    if (!key) continue;
    const rows = await fetchRawConversions(key, from, to);
    for (const c of rows) {
      const revenue = c.revenue ?? 0;
      if (c.is_event && revenue === 0) continue;
      const host = refererHost(c.referer);
      // Les ventes faites par un EMD ne sont pas une opportunité, elles sont déjà captées.
      if (emdSet.has(host)) continue;
      const offer = c.relationship?.offer?.name ?? "";
      const brand = offerBrand(offer, c.relationship?.offer_url?.name);
      const country = c.country || "?";
      const k = `${net.key}|${offer}|${country}`;
      let g = groups.get(k);
      if (!g) {
        g = {
          brand,
          offer,
          offerId: c.relationship?.offer?.network_offer_id ?? null,
          network: net.key,
          offerStatus: c.relationship?.offer?.offer_status ?? "?",
          country,
          conversions: 0,
          revenueUsd: 0,
          sources: [],
          existingEmds: [],
          _src: new Map(),
        };
        groups.set(k, g);
      }
      g.conversions += 1;
      g.revenueUsd += revenue;
      g._src.set(host, (g._src.get(host) ?? 0) + revenue);
    }
  }

  return [...groups.values()]
    .map(({ _src, ...g }) => {
      // Premier mot de la marque : « Orivelle Fungus Pen » couvre orivelle-ongles.fr
      const b = alnum(g.brand.split(/\s+/)[0]);
      return {
        ...g,
        revenueUsd: Math.round(g.revenueUsd),
        sources: [..._src.entries()]
          .sort((a, b) => b[1] - a[1])
          .map(([host, rev]) => ({ host, revenueUsd: Math.round(rev) })),
        existingEmds: b.length >= 4 ? emdDomains.filter((d) => alnum(d).includes(b)) : [],
      };
    })
    .sort((a, b) => b.revenueUsd - a.revenueUsd);
}

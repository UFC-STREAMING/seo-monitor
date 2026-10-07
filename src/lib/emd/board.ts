// Encart « EMD à lancer » de /rankings : une ligne par marque × pays, qui a
// soit vendu via les sites expirés (Everflow, 90 j), soit des impressions sur
// leurs fiches produit (Search Console, 28 j). Pour les plus fortes, on regarde
// le top 10 Google du pays : y a-t-il déjà un EMD de la marque ?

import { unstable_cache } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { computeEmdOpportunities } from "@/lib/everflow/opportunities";
import { fetchSerpOrganic } from "@/lib/semscraper/client";
import { COUNTRIES, alnum, brandKeyword, ownsEmdForCountry, isCompetitorEmd } from "@/lib/emd/gaps";

const SALES_DAYS = 90;
const IMPRESSION_DAYS = 28;
/** SERP vérifiées : les N premières par ventes + les N premières par impressions. */
const SERP_TOP = 30;

// Code pays Search Console (alpha-3) → nom de pays Everflow (clé de COUNTRIES).
const ALPHA3: Record<string, string> = {
  FRA: "France", DEU: "Germany", ITA: "Italy", ESP: "Spain", PRT: "Portugal",
  BEL: "Belgium", NLD: "Netherlands", CHE: "Switzerland", AUT: "Austria",
  DNK: "Denmark", SWE: "Sweden", NOR: "Norway", FIN: "Finland", POL: "Poland",
  CZE: "Czechia", ROU: "Romania", HUN: "Hungary", GRC: "Greece", IRL: "Ireland",
  GBR: "United Kingdom", USA: "United States", CAN: "Canada", AUS: "Australia",
  NZL: "New Zealand", JPN: "Japan",
};

/** Clé de rapprochement : 1er mot s'il fait ≥ 5 caractères (« lulutox detox tea »,
 *  « glucotex-blood » → « lulutox », « glucotex »), sinon le nom entier. Même
 *  règle que la fonction SQL emd_brand_impressions. */
function brandKey(name: string): string {
  const first = alnum(name.split(/[\s-]+/)[0] ?? "");
  return first.length >= 5 ? first : alnum(name);
}

const titleCase = (slug: string) =>
  slug.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");

export interface EmdBoardRow {
  brand: string;
  country: string;
  countryIso: string;
  tld: string;
  sales: {
    revenueUsd: number;
    conversions: number;
    network: string;
    offer: string;
    offerStatus: string;
    sources: { host: string; revenueUsd: number }[];
  } | null;
  impressions: {
    impressions: number;
    clicks: number;
    topQuery: string;
    sources: { host: string; impressions: number }[];
  } | null;
  /** Notre EMD sur le TLD du pays, s'il existe. */
  ownEmd: string | null;
  /** null = SERP non vérifiée (hors top). */
  serpBrandDomains: string[] | null;
  serpError?: string;
}

interface ImpressionRow {
  host: string;
  slug: string;
  country: string;
  impressions: number;
  clicks: number;
  top_query: string;
}

export async function computeBoard(): Promise<EmdBoardRow[]> {
  const supabase = createAdminClient();
  const { data: sites, error } = await supabase.from("sites").select("domain").eq("category", "emd");
  if (error) throw new Error(error.message);
  const emdDomains = (sites ?? []).map((s) => s.domain.toLowerCase());
  const ours = new Set(emdDomains);

  const [sales, imp] = await Promise.all([
    computeEmdOpportunities(emdDomains, SALES_DAYS),
    supabase.rpc("emd_brand_impressions", { p_days: IMPRESSION_DAYS }),
  ]);
  if (imp.error) throw new Error(imp.error.message);

  const rows = new Map<string, EmdBoardRow>();
  const rowFor = (name: string, country: string): EmdBoardRow | null => {
    const c = COUNTRIES[country];
    const key = brandKey(name);
    if (!c || key.length < 4) return null;
    const k = `${key}|${c.iso}`;
    let r = rows.get(k);
    if (!r) {
      const mine = emdDomains.filter((d) => alnum(d).includes(key));
      r = {
        brand: name,
        country,
        countryIso: c.iso,
        tld: c.tld,
        sales: null,
        impressions: null,
        ownEmd: ownsEmdForCountry(mine, c.tld),
        serpBrandDomains: null,
      };
      rows.set(k, r);
    }
    return r;
  };

  // Ventes : plusieurs offres d'une même marque × pays sont cumulées.
  for (const o of sales) {
    const r = rowFor(o.brand, o.country);
    if (!r) continue;
    if (!r.sales) {
      r.brand = o.brand;
      r.sales = { revenueUsd: 0, conversions: 0, network: o.network, offer: o.offer, offerStatus: o.offerStatus, sources: [] };
    }
    r.sales.revenueUsd += o.revenueUsd;
    r.sales.conversions += o.conversions;
    for (const s of o.sources) {
      const ex = r.sales.sources.find((x) => x.host === s.host);
      if (ex) ex.revenueUsd += s.revenueUsd;
      else r.sales.sources.push({ ...s });
    }
  }

  // Impressions des fiches produit des sites expirés (pas des EMD).
  for (const i of (imp.data ?? []) as ImpressionRow[]) {
    if (ours.has(i.host)) continue;
    const country = ALPHA3[i.country?.toUpperCase()];
    if (!country) continue;
    const r = rowFor(titleCase(i.slug), country);
    if (!r) continue;
    if (!r.impressions) r.impressions = { impressions: 0, clicks: 0, topQuery: i.top_query, sources: [] };
    r.impressions.impressions += Number(i.impressions);
    r.impressions.clicks += Number(i.clicks);
    r.impressions.sources.push({ host: i.host, impressions: Number(i.impressions) });
  }

  const all = [...rows.values()];
  for (const r of all) {
    r.sales?.sources.sort((a, b) => b.revenueUsd - a.revenueUsd);
    r.impressions?.sources.sort((a, b) => b.impressions - a.impressions);
  }

  // SERP : top ventes + top impressions, sauf si on a déjà l'EMD du pays.
  const unowned = all.filter((r) => !r.ownEmd);
  const toCheck = [
    ...new Set([
      ...unowned.filter((r) => r.sales).sort((a, b) => b.sales!.revenueUsd - a.sales!.revenueUsd).slice(0, SERP_TOP),
      ...unowned.filter((r) => r.impressions).sort((a, b) => b.impressions!.impressions - a.impressions!.impressions).slice(0, SERP_TOP),
    ]),
  ];
  if (toCheck.length) {
    const serps = await fetchSerpOrganic(
      toCheck.map((r) => ({
        keyword: brandKeyword(r.brand),
        countryIso: r.countryIso,
        languageCode: COUNTRIES[r.country].lang,
      }))
    );
    toCheck.forEach((r, idx) => {
      const serp = serps[idx];
      if (serp.error) {
        r.serpError = serp.error;
        return;
      }
      const key = brandKey(r.brand);
      r.serpBrandDomains = [...new Set(serp.domains.slice(0, 10))].filter(
        (d) => !ours.has(d) && isCompetitorEmd(d, key)
      );
    });
  }

  return all;
}

/**
 * Recalculé au plus une fois par 22 h (≈ 60 SERP Semscraper, ~2 min de calcul).
 * Le cron 5h30 UTC (vercel.json) le préchauffe : la page ne paie jamais le calcul.
 */
export const getEmdBoard = unstable_cache(computeBoard, ["emd-board-v1"], { revalidate: 79200 });

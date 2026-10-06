// Trous EMD : une offre × pays vient de vendre via un site expiré (preuve
// Everflow) et aucun EMD de la marque n'est dans le top 10 Google du pays.
// → le Mini (~/emd-sync/emd_gap_launcher.py) lance l'agent Hermes EMD.

import { computeEmdOpportunities, type EmdOpportunity } from "@/lib/everflow/opportunities";
import { fetchSerpOrganic } from "@/lib/semscraper/client";

// Pays Everflow (nom anglais) → ISO, langue Google, TLD à acheter.
export const COUNTRIES: Record<string, { iso: string; lang: string; tld: string }> = {
  France: { iso: "FR", lang: "fr", tld: ".fr" },
  Germany: { iso: "DE", lang: "de", tld: ".de" },
  Italy: { iso: "IT", lang: "it", tld: ".it" },
  Spain: { iso: "ES", lang: "es", tld: ".es" },
  Portugal: { iso: "PT", lang: "pt", tld: ".pt" },
  Belgium: { iso: "BE", lang: "fr", tld: ".be" },
  Netherlands: { iso: "NL", lang: "nl", tld: ".nl" },
  Switzerland: { iso: "CH", lang: "de", tld: ".ch" },
  Austria: { iso: "AT", lang: "de", tld: ".at" },
  Denmark: { iso: "DK", lang: "da", tld: ".dk" },
  Sweden: { iso: "SE", lang: "sv", tld: ".se" },
  Norway: { iso: "NO", lang: "no", tld: ".no" },
  Finland: { iso: "FI", lang: "fi", tld: ".fi" },
  Poland: { iso: "PL", lang: "pl", tld: ".pl" },
  "Czech Republic": { iso: "CZ", lang: "cs", tld: ".cz" },
  Czechia: { iso: "CZ", lang: "cs", tld: ".cz" },
  Romania: { iso: "RO", lang: "ro", tld: ".ro" },
  Hungary: { iso: "HU", lang: "hu", tld: ".hu" },
  Greece: { iso: "GR", lang: "el", tld: ".gr" },
  Ireland: { iso: "IE", lang: "en", tld: ".ie" },
  "United Kingdom": { iso: "GB", lang: "en", tld: ".co.uk" },
  "United States": { iso: "US", lang: "en", tld: ".com" },
  Canada: { iso: "CA", lang: "en", tld: ".ca" },
  Australia: { iso: "AU", lang: "en", tld: ".com.au" },
  "New Zealand": { iso: "NZ", lang: "en", tld: ".co.nz" },
  Japan: { iso: "JP", lang: "ja", tld: ".jp" },
};

export const alnum = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

export interface EmdGap extends EmdOpportunity {
  countryIso: string;
  tld: string;
  /** Domaines du top 10 qui contiennent la marque (hors les nôtres). */
  serpBrandDomains: string[];
  /** true = aucun EMD concurrent → on peut lancer. */
  gap: boolean;
  reason: string;
}

/** Un de nos EMD couvre déjà ce pays (même TLD, ou gTLD pour les US). */
export function ownsEmdForCountry(existing: string[], tld: string): string | null {
  const gtlds = [".com", ".org", ".net"];
  return (
    existing.find((d) => d.endsWith(tld) || (tld === ".com" && gtlds.some((g) => d.endsWith(g)))) ??
    null
  );
}

/** Domaine enregistrable : shop.lulutox.com → lulutox.com, x.co.uk → x.co.uk. */
function registrable(domain: string): string {
  const labels = domain.split(".");
  const n = /^(co|com|org|net|gov|ac)$/.test(labels[labels.length - 2] ?? "") && labels.length > 2 ? 3 : 2;
  return labels.slice(-n).join(".");
}

/**
 * Domaine de la marque considéré comme EMD concurrent. La marque doit être
 * dans le domaine lui-même (lulutox.zendesk.com, x.square.site = plateformes,
 * pas des EMD). Sont écartés les sites officiels de l'annonceur : marque.com
 * et ses sous-domaines, try/get/official + marque en .com (tryemsense.com).
 * vitaslimex.fr reste un EMD : c'est exactement le domaine qu'on viserait.
 */
export function isCompetitorEmd(domain: string, brandKey: string): boolean {
  const reg = registrable(domain);
  if (!alnum(reg).includes(brandKey)) return false;
  const official = [brandKey, `try${brandKey}`, `get${brandKey}`, `official${brandKey}`];
  return !(reg.endsWith(".com") && official.includes(alnum(reg.slice(0, -4))));
}

/** Mot-clé = la marque seule : « Lulutox Detox Tea » → « lulutox ». */
export function brandKeyword(brand: string): string {
  const words = brand.trim().split(/\s+/);
  return (words.length >= 3 ? words[0] : brand).toLowerCase();
}

export async function computeEmdGaps(emdDomains: string[], days = 7): Promise<EmdGap[]> {
  const opportunities = (await computeEmdOpportunities(emdDomains, days)).filter(
    (o) => o.offerStatus === "active"
  );

  const candidates: Array<{ o: EmdOpportunity; c: (typeof COUNTRIES)[string] }> = [];
  const gaps: EmdGap[] = [];
  for (const o of opportunities) {
    const c = COUNTRIES[o.country];
    const base = { ...o, countryIso: c?.iso ?? "", tld: c?.tld ?? "", serpBrandDomains: [] };
    if (!c) {
      gaps.push({ ...base, gap: false, reason: `pays non géré : ${o.country}` });
      continue;
    }
    if (alnum(o.brand).length < 4) {
      gaps.push({ ...base, gap: false, reason: "marque illisible" });
      continue;
    }
    const owned = ownsEmdForCountry(o.existingEmds, c.tld);
    if (owned) {
      gaps.push({ ...base, gap: false, reason: `on a déjà ${owned}` });
      continue;
    }
    candidates.push({ o, c });
  }

  const serps = candidates.length
    ? await fetchSerpOrganic(
        candidates.map(({ o, c }) => ({ keyword: brandKeyword(o.brand), countryIso: c.iso, languageCode: c.lang }))
      )
    : [];

  candidates.forEach(({ o, c }, i) => {
    const serp = serps[i];
    const brandKey = alnum(o.brand.split(/\s+/)[0]);
    const ours = new Set(emdDomains.map((d) => d.toLowerCase()));
    const serpBrandDomains = [...new Set(serp.domains.slice(0, 10))].filter(
      (d) => !ours.has(d) && isCompetitorEmd(d, brandKey)
    );
    const base = { ...o, countryIso: c.iso, tld: c.tld, serpBrandDomains };
    if (serp.error) {
      gaps.push({ ...base, gap: false, reason: serp.error });
    } else if (serpBrandDomains.length > 0) {
      gaps.push({ ...base, gap: false, reason: `EMD déjà en top 10 : ${serpBrandDomains.join(", ")}` });
    } else {
      gaps.push({ ...base, gap: true, reason: "aucun EMD dans le top 10" });
    }
  });

  return gaps.sort((a, b) => Number(b.gap) - Number(a.gap) || b.revenueUsd - a.revenueUsd);
}

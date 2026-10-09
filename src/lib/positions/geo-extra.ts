// Suivi multi-pays des EMD génériques (Leo 09/10/2026) : un EMD en .com/.org/.net
// est relevé dans chaque pays anglophone où sa marque a une offre approuvée
// (twistapure : US + UK + AU). Les ccTLD (.fr, .de…) restent sur leur seul pays.
// Appelé chaque matin par le contrôle affilié (6h40 UTC), avant le relevé de 7h.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { offerCountries, type OfferCatalog } from "@/lib/affiliate/check";

const GENERIC_TLDS = [".com", ".org", ".net"];
// Ordre = priorité ; Everflow écrit « UK » pour le Royaume-Uni
const ANGLO: Array<{ everflow: string; iso: string }> = [
  { everflow: "US", iso: "US" },
  { everflow: "UK", iso: "GB" },
  { everflow: "AU", iso: "AU" },
  { everflow: "CA", iso: "CA" },
];

const alnum = (s: string) => s.toLowerCase().normalize("NFD").replace(/[^a-z0-9]/g, "");

/** Pays d'une offre : ruleset de l'API, sinon les codes entre crochets du nom ([US, UK, AU]). */
async function countriesOf(offer: OfferCatalog["all"][number]): Promise<string[]> {
  const fromApi = await offerCountries(offer);
  if (fromApi.length) return fromApi;
  const tags = offer.name.match(/\[([^\]]+)\]/g) ?? [];
  return tags.flatMap((t) => t.slice(1, -1).split(/[,\s/]+/)).map((c) => c.trim().toUpperCase());
}

export async function syncGeoKeywords(
  supabase: SupabaseClient<Database>,
  catalog: OfferCatalog
): Promise<{ site: string; countries: string[] }[]> {
  const { data: sites, error } = await supabase
    .from("sites")
    .select("id, domain, keywords(id, keyword, location_code, is_primary, geo_extra)")
    .eq("category", "emd")
    .eq("is_active", true);
  if (error) throw new Error(`sites fetch: ${error.message}`);

  const { data: locations } = await supabase.from("locations").select("code, country_iso");
  const codeByIso = new Map((locations ?? []).map((l) => [l.country_iso, l.code]));
  const isoByCode = new Map((locations ?? []).map((l) => [l.code, l.country_iso]));

  const report: { site: string; countries: string[] }[] = [];
  for (const site of sites ?? []) {
    if (!GENERIC_TLDS.some((t) => site.domain.endsWith(t))) continue;
    const kws = (site.keywords ?? []) as Array<{
      id: string; keyword: string; location_code: number; is_primary: boolean; geo_extra: boolean;
    }>;
    const primary = kws.find((k) => k.is_primary);
    if (!primary) continue;

    // Marque = mot-clé principal ; offres approuvées et actives de cette marque
    const brand = alnum(primary.keyword);
    if (brand.length < 4) continue;
    const offers = catalog.all.filter(
      (o) => o.offerStatus === "active" && o.affiliateStatus === "approved" && alnum(o.name).includes(brand)
    );
    const covered = new Set<string>();
    for (const o of offers) for (const c of await countriesOf(o)) covered.add(c);
    const wanted = ANGLO.filter((a) => covered.has(a.everflow) || covered.has(a.iso))
      .map((a) => a.iso)
      .filter((iso) => iso !== isoByCode.get(primary.location_code))
      .slice(0, 3);

    // Ajouter / réactiver les pays voulus, couper ceux qui ne le sont plus (historique gardé)
    for (const iso of wanted) {
      const code = codeByIso.get(iso);
      if (!code) continue;
      const existing = kws.find((k) => k.keyword === primary.keyword && k.location_code === code);
      if (existing && !existing.geo_extra && !existing.is_primary) {
        await supabase.from("keywords").update({ geo_extra: true }).eq("id", existing.id);
      } else if (!existing) {
        await supabase
          .from("keywords")
          .insert({ site_id: site.id, keyword: primary.keyword, location_code: code, is_primary: false, geo_extra: true });
      }
    }
    const wantedCodes = new Set(wanted.map((iso) => codeByIso.get(iso)));
    for (const k of kws) {
      if (k.geo_extra && !wantedCodes.has(k.location_code)) {
        await supabase.from("keywords").update({ geo_extra: false }).eq("id", k.id);
      }
    }
    if (wanted.length) report.push({ site: site.domain, countries: wanted });
  }
  return report;
}

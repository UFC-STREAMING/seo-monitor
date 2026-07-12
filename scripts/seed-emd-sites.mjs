// Seed one-shot : importe les sites EMD live (source : audit hebdo Mac Mini
// emd-weekly-audit-2026-07-06.md) dans seo-monitor avec leur mot-clé principal
// dérivé du domaine (Leo les corrige ensuite inline dans /rankings).
//
// Usage : node --env-file=.env.local scripts/seed-emd-sites.mjs
//
// Idempotent : re-lancer ne crée pas de doublons (sites par domain, keyword
// uniquement si le site n'en a aucun, domain_finance si absent).

import { createClient } from "@supabase/supabase-js";

// [domain, countryIso, keyword, niche]
const EMD_SITES = [
  ["fuelsync-pro.com", "US", "fuelsync pro", "nutra"],
  ["optifuel-france.fr", "FR", "optifuel", "nutra"],
  ["jetterix.es", "ES", "jetterix", "nutra"],
  ["ketonex.fr", "FR", "ketonex", "nutra"],
  ["ozem-plus.fr", "FR", "ozem plus", "nutra"],
  ["bloomwhite.org", "AU", "bloomwhite", "nutra"],
  ["forcevital.ch", "CH", "forcevital", "nutra"],
  ["glyvera-capsules.nl", "NL", "glyvera", "nutra"],
  ["coolizi-coolzy.at", "AT", "coolizi", "nutra"],
  ["novi-glp.com", "US", "novi glp", "nutra"],
  ["fungexin.uk", "GB", "fungexin", "nutra"],
  ["speeder-pro-radar.de", "DE", "speeder pro", "nutra"],
  ["orivelle-fungus-pen.co.uk", "GB", "orivelle fungus pen", "nutra"],
  ["spyfocusaustralia.com", "AU", "spyfocus", "nutra"],
  ["lunavelle-patch.com", "US", "lunavelle", "nutra"],
  ["coldeez-cooling-ace.de", "DE", "coldeez", "nutra"],
  ["jellyfillaustralia.com", "AU", "jellyfill", "nutra"],
  ["rainbetjapan.com", "JP", "rainbet japan", "casino"],
  ["rainbetturkiye.com", "TR", "rainbet turkiye", "casino"],
  ["dominexmaleenhancement.org", "CA", "dominex", "nutra"],
  ["rootahairgrowth.uk", "GB", "roota hair growth", "nutra"],
  ["rainbet-kasino.co.no", "NO", "rainbet kasino", "casino"],
  ["rainbetkasyno.pl", "PL", "rainbet kasyno", "casino"],
  ["pokerdom-kz.icu", "KZ", "pokerdom", "casino"],
  ["manergy-capsules.fr", "FR", "manergy", "nutra"],
  ["orivelle-ongles.fr", "FR", "orivelle", "nutra"],
];

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function main() {
  // 1. Résolution country_iso -> location_code DataForSEO
  const { data: locations, error: locErr } = await supabase
    .from("locations")
    .select("code, country_iso");
  if (locErr) throw new Error(`locations: ${locErr.message}`);
  const locByIso = new Map();
  for (const l of locations) {
    if (!locByIso.has(l.country_iso)) locByIso.set(l.country_iso, l.code);
  }

  // 2. user_id (mono-utilisateur)
  const { data: anySite, error: userErr } = await supabase
    .from("sites")
    .select("user_id")
    .limit(1)
    .single();
  if (userErr) throw new Error(`user_id: ${userErr.message}`);
  const userId = anySite.user_id;

  let created = 0, updated = 0, keywords = 0, finance = 0;

  for (const [domain, iso, keyword, niche] of EMD_SITES) {
    const locationCode = locByIso.get(iso);
    if (!locationCode) {
      console.error(`⚠️  Pas de location_code pour ${iso} (${domain}) — site créé sans keyword`);
    }

    // 3. Site : insert ou reclassement en EMD
    const { data: existing } = await supabase
      .from("sites")
      .select("id, category")
      .eq("domain", domain)
      .maybeSingle();

    let siteId;
    if (!existing) {
      const { data, error } = await supabase
        .from("sites")
        .insert({
          user_id: userId,
          domain,
          niche,
          site_type: "emd",
          category: "emd",
          serp_tracking_enabled: true,
          is_active: true,
          hosting: "cloudflare",
          location_code: locationCode ?? null,
        })
        .select("id")
        .single();
      if (error) throw new Error(`insert site ${domain}: ${error.message}`);
      siteId = data.id;
      created++;
    } else {
      siteId = existing.id;
      const { error } = await supabase
        .from("sites")
        .update({
          site_type: "emd",
          category: "emd",
          serp_tracking_enabled: true,
          is_active: true,
          location_code: locationCode ?? null,
        })
        .eq("id", siteId);
      if (error) throw new Error(`update site ${domain}: ${error.message}`);
      updated++;
    }

    // 4. Mot-clé principal : seulement si le site n'en a encore aucun
    if (locationCode) {
      const { count } = await supabase
        .from("keywords")
        .select("id", { count: "exact", head: true })
        .eq("site_id", siteId);
      if ((count ?? 0) === 0) {
        const { error } = await supabase.from("keywords").insert({
          site_id: siteId,
          keyword,
          location_code: locationCode,
        });
        if (error) throw new Error(`keyword ${domain}: ${error.message}`);
        keywords++;
      }
    }

    // 5. Ligne finance vide (facilite l'édition inline dans /rankings)
    const { data: fin } = await supabase
      .from("domain_finance")
      .select("id")
      .eq("site_id", siteId)
      .maybeSingle();
    if (!fin) {
      const { error } = await supabase
        .from("domain_finance")
        .insert({ site_id: siteId });
      if (error) throw new Error(`finance ${domain}: ${error.message}`);
      finance++;
    }
  }

  console.log(
    `✅ Seed terminé : ${created} sites créés, ${updated} mis à jour, ${keywords} mots-clés, ${finance} lignes finance.`
  );
}

main().catch((e) => {
  console.error("❌", e.message);
  process.exit(1);
});

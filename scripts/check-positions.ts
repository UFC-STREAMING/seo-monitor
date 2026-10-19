/**
 * Relevé quotidien des positions SERP (Semscraper) — lancé par launchd sur le Mac Mini
 * (com.leo.seo-positions, 7h UTC). Né le 15/10/2026 : sur Vercel le relevé (107 mots-clés,
 * ~400 s) dépassait la limite de 300 s et plus rien n'était enregistré depuis le 13/10.
 *   npx tsx scripts/check-positions.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { createAdminClient } from "@/lib/supabase/admin";
import { runPositionChecks } from "@/lib/positions/check";

// Garde-fou : le 16/10 un relevé est resté figé 3 jours (fetch sans délai max) et launchd
// ne relance pas un job encore « running ». Au-delà de 30 min, on coupe.
setTimeout(() => {
  console.error(`${new Date().toISOString()} relevé coupé après 30 min (bloqué)`);
  process.exit(1);
}, 30 * 60_000).unref();

(async () => {
  const t = Date.now();
  const r = await runPositionChecks(createAdminClient(), { timeoutMs: 900_000 });
  const erreurs = r.results.filter((x) => x.error).length;
  console.log(`${new Date().toISOString()} vérifiés ${r.checked}, trouvés ${r.found}, erreurs ${erreurs}, coût ${r.total_cost_usd.toFixed(3)} €, ${Math.round((Date.now() - t) / 1000)} s`);
  process.exit(0);
})();

// Moteur de check de positions SERP (Semscraper, ex-DataForSEO) — logique partagée entre
// /api/positions/check (bouton "Check maintenant") et /api/cron/check-positions
// (cron hebdo lundi 7h, avant le rapport de l'agent Hermes EMD à 9h).
//
// GARDE-FOU PÉRIMÈTRE : seuls les sites category='emd' AND serp_tracking_enabled
// AND is_active sont vérifiés. Les shops e-commerce (GSC gratuit) ne génèrent
// JAMAIS d'appel SERP payant — le filtre est dans la requête SQL, pas en aval.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import {
  checkSerpPositions,
  SemscraperBalanceError,
  type SerpCheckResult,
} from "@/lib/semscraper/client";
import { sendTelegramMessage } from "@/lib/telegram";

// Chute déclenchant une alerte position_drop
const DROP_WARNING = 5;
const DROP_CRITICAL = 15;

interface KeywordToCheck {
  keyword_id: string;
  site_id: string;
  user_id: string;
  domain: string;
  keyword: string;
  location_code: number;
  country_iso: string;
  language_code: string;
}

export interface PositionCheckOutcome {
  domain: string;
  keyword: string;
  position: number | null;
  previous_position: number | null;
  url_found: string | null;
  error?: string;
}

export interface RunResult {
  checked: number;
  found: number;
  /** Coût total (EUR depuis Semscraper — nom gardé pour compat UI/agent). */
  total_cost_usd: number;
  balance_error: boolean;
  results: PositionCheckOutcome[];
}

/**
 * Lance les checks SERP pour tous les mots-clés EMD actifs
 * (ou ceux d'un seul site si siteId est fourni).
 */
export async function runPositionChecks(
  supabase: SupabaseClient<Database>,
  opts: { siteId?: string } = {}
): Promise<RunResult> {
  // 1. Mots-clés éligibles — filtre EMD au niveau SQL
  let query = supabase
    .from("keywords")
    .select(
      "id, keyword, location_code, site_id, sites!inner(id, domain, user_id, category, serp_tracking_enabled, is_active), locations(default_language, country_iso)"
    )
    .eq("sites.category", "emd")
    .eq("sites.serp_tracking_enabled", true)
    .eq("sites.is_active", true)
    // Mot-clé principal + ses pays anglophones en plus (geo_extra, EMD .com/.org/.net).
    // Les keywords hérités du mode shop restent en base sans appel SERP.
    .or("is_primary.eq.true,geo_extra.eq.true");
  if (opts.siteId) query = query.eq("site_id", opts.siteId);

  const { data: rows, error } = await query;
  if (error) throw new Error(`keywords fetch: ${error.message}`);

  const toCheck: KeywordToCheck[] = (rows ?? []).map((r) => {
    const site = r.sites as unknown as { id: string; domain: string; user_id: string };
    const loc = r.locations as unknown as { default_language: string; country_iso: string } | null;
    return {
      keyword_id: r.id,
      site_id: site.id,
      user_id: site.user_id,
      domain: site.domain,
      keyword: r.keyword,
      location_code: r.location_code,
      country_iso: loc?.country_iso ?? "FR",
      language_code: loc?.default_language ?? "en",
    };
  });

  const results: PositionCheckOutcome[] = [];
  let totalCost = 0;
  let balanceError = false;

  // 2. Positions précédentes (pour Δ + alertes position_drop)
  const previousBySite = new Map<string, number | null>();
  for (const k of toCheck) {
    const { data: prev } = await supabase
      .from("keyword_positions")
      .select("position")
      .eq("keyword_id", k.keyword_id)
      .order("checked_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    previousBySite.set(k.keyword_id, prev?.position ?? null);
  }

  // 3. Un seul lot Semscraper (async, polling) pour tous les mots-clés
  // Budget temps : la fonction Vercel est coupée à 800 s et n'écrit qu'à la fin.
  const startedAt = Date.now();
  let checks: SerpCheckResult[] = [];
  try {
    checks = await checkSerpPositions(
      toCheck.map((k) => ({
        keyword: k.keyword,
        countryIso: k.country_iso,
        languageCode: k.language_code,
        targetDomain: k.domain,
      })),
      { timeoutMs: 420_000 }
    );
  } catch (err) {
    if (err instanceof SemscraperBalanceError) balanceError = true;
    const message = err instanceof Error ? err.message : String(err);
    checks = toCheck.map(() => ({
      position: null,
      urlFound: null,
      serpFeatures: [],
      cost: 0,
      error: message,
    }));
  }

  // 3b. Un site classé qui disparaît d'un coup = souvent une SERP incomplète
  // renvoyée par Semscraper (alpha-nerv.fr : 1er le 05/10, « >100 » le 08/10,
  // 2e une heure après). On refait la recherche avant d'enregistrer la chute.
  const lost = toCheck
    .map((k, i) => i)
    .filter((i) => !checks[i].error && checks[i].position === null && previousBySite.get(toCheck[i].keyword_id) != null);
  const remainingMs = 700_000 - (Date.now() - startedAt);
  if (lost.length && !balanceError && remainingMs > 60_000) {
    try {
      const again = await checkSerpPositions(
        lost.map((i) => ({
          keyword: toCheck[i].keyword,
          countryIso: toCheck[i].country_iso,
          languageCode: toCheck[i].language_code,
          targetDomain: toCheck[i].domain,
        })),
        { timeoutMs: Math.min(240_000, remainingMs - 30_000) }
      );
      lost.forEach((i, j) => {
        const r = again[j];
        // 2e échec technique → on n'écrit rien plutôt qu'une fausse chute
        checks[i] = r.error ? { ...r } : { ...r, cost: r.cost + checks[i].cost };
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      for (const i of lost) checks[i] = { ...checks[i], error: `re-vérification impossible : ${message}` };
    }
  }

  for (let i = 0; i < toCheck.length; i++) {
    const k = toCheck[i];
    const check = checks[i];
    const previous = previousBySite.get(k.keyword_id) ?? null;

    // Échec (timeout, crédit...) : on n'écrit RIEN — une ligne null ferait
    // croire à une sortie du top 100 et déclencherait une fausse alerte.
    if (check.error) {
      results.push({
        domain: k.domain,
        keyword: k.keyword,
        position: null,
        previous_position: previous,
        url_found: null,
        error: check.error,
      });
      continue;
    }
    totalCost += check.cost;

    await supabase.from("keyword_positions").insert({
      keyword_id: k.keyword_id,
      site_id: k.site_id,
      position: check.position,
      url_found: check.urlFound,
      serp_features: check.serpFeatures as never,
    });

    await supabase.from("api_usage_log").insert({
      user_id: k.user_id,
      service: "semscraper",
      endpoint: "v1/serp google_search depth=10",
      credits_used: 1,
      cost_usd: check.cost,
    });

    // Alerte position_drop
    if (previous !== null) {
      const droppedOut = check.position === null;
      const drop = check.position !== null ? check.position - previous : 999;
      if (droppedOut || drop >= DROP_WARNING) {
        await supabase.from("alerts").insert({
          site_id: k.site_id,
          alert_type: "position_drop",
          severity: droppedOut || drop >= DROP_CRITICAL ? "critical" : "warning",
          message: droppedOut
            ? `${k.domain} : "${k.keyword}" est sorti du top 100 (était #${previous})`
            : `${k.domain} : "${k.keyword}" #${previous} → #${check.position} (-${drop})`,
        });
      }
    }

    results.push({
      domain: k.domain,
      keyword: k.keyword,
      position: check.position,
      previous_position: previous,
      url_found: check.urlFound,
    });
  }

  // 4. Solde épuisé -> alerte immédiate, on ne perd pas la semaine en silence
  if (balanceError) {
    await sendTelegramMessage(
      `<b>🚨 SEO Monitor — Crédit Semscraper épuisé</b>\n` +
        `Le check hebdo des positions EMD est incomplet (${results.filter((r) => !r.error).length}/${toCheck.length}).\n` +
        `→ Recharger semscraper.com puis relancer le check depuis /rankings.`
    );
  }

  return {
    checked: results.length,
    found: results.filter((r) => r.position !== null).length,
    total_cost_usd: Math.round(totalCost * 10000) / 10000,
    balance_error: balanceError,
    results,
  };
}

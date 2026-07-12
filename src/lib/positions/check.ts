// Moteur de check de positions SERP (DataForSEO) — logique partagée entre
// /api/positions/check (bouton "Check maintenant") et /api/cron/check-positions
// (cron hebdo lundi 7h, avant le rapport de l'agent Hermes EMD à 9h).
//
// GARDE-FOU PÉRIMÈTRE : seuls les sites category='emd' AND serp_tracking_enabled
// AND is_active sont vérifiés. Les shops e-commerce (GSC gratuit) ne génèrent
// JAMAIS d'appel DataForSEO — le filtre est dans la requête SQL, pas en aval.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { checkSerpPosition, DataForSeoBalanceError } from "@/lib/dataforseo/client";
import { sendTelegramMessage } from "@/lib/telegram";

const CONCURRENCY = 5;
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
      "id, keyword, location_code, site_id, sites!inner(id, domain, user_id, category, serp_tracking_enabled, is_active), locations(default_language)"
    )
    .eq("sites.category", "emd")
    .eq("sites.serp_tracking_enabled", true)
    .eq("sites.is_active", true)
    // 1 seul mot-clé payant par domaine (les keywords hérités du mode shop
    // restent en base mais ne déclenchent aucun appel DataForSEO)
    .eq("is_primary", true);
  if (opts.siteId) query = query.eq("site_id", opts.siteId);

  const { data: rows, error } = await query;
  if (error) throw new Error(`keywords fetch: ${error.message}`);

  const toCheck: KeywordToCheck[] = (rows ?? []).map((r) => {
    const site = r.sites as unknown as { id: string; domain: string; user_id: string };
    const loc = r.locations as unknown as { default_language: string } | null;
    return {
      keyword_id: r.id,
      site_id: site.id,
      user_id: site.user_id,
      domain: site.domain,
      keyword: r.keyword,
      location_code: r.location_code,
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

  // 3. Checks par lots (Vercel maxDuration oblige)
  for (let i = 0; i < toCheck.length; i += CONCURRENCY) {
    if (balanceError) break;
    const batch = toCheck.slice(i, i + CONCURRENCY);

    const outcomes = await Promise.all(
      batch.map(async (k): Promise<PositionCheckOutcome> => {
        const previous = previousBySite.get(k.keyword_id) ?? null;
        try {
          const check = await checkSerpPosition({
            keyword: k.keyword,
            locationCode: k.location_code,
            languageCode: k.language_code,
            targetDomain: k.domain,
          });
          totalCost += check.costUsd;

          await supabase.from("keyword_positions").insert({
            keyword_id: k.keyword_id,
            site_id: k.site_id,
            position: check.position,
            url_found: check.urlFound,
            serp_features: check.serpFeatures as never,
          });

          await supabase.from("api_usage_log").insert({
            user_id: k.user_id,
            service: "dataforseo",
            endpoint: "serp/google/organic/live/advanced",
            credits_used: 1,
            cost_usd: check.costUsd,
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

          return {
            domain: k.domain,
            keyword: k.keyword,
            position: check.position,
            previous_position: previous,
            url_found: check.urlFound,
          };
        } catch (err) {
          if (err instanceof DataForSeoBalanceError) {
            balanceError = true;
          }
          return {
            domain: k.domain,
            keyword: k.keyword,
            position: null,
            previous_position: previous,
            url_found: null,
            error: err instanceof Error ? err.message : String(err),
          };
        }
      })
    );
    results.push(...outcomes);
  }

  // 4. Solde épuisé -> alerte immédiate, on ne perd pas la semaine en silence
  if (balanceError) {
    await sendTelegramMessage(
      `<b>🚨 SEO Monitor — Solde DataForSEO épuisé</b>\n` +
        `Le check hebdo des positions EMD est incomplet (${results.filter((r) => !r.error).length}/${toCheck.length}).\n` +
        `→ Recharger le compte puis relancer le check depuis /rankings.`
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

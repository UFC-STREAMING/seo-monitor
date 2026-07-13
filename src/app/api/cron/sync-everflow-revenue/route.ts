import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  EVERFLOW_NETWORKS,
  fetchConversions,
  normalizeDomainKey,
} from "@/lib/everflow/client";

export const maxDuration = 300;

const DEFAULT_RESYNC_DAYS = 7; // ?days=90 pour un backfill étendu

// Sync quotidien des revenus Everflow -> domain_revenue, par domaine EMD.
// Source : rapport de CONVERSIONS détaillé (pas l'agrégat par offre).
// Attribution par PREUVE réelle, dans l'ordre :
//   1. sub1 == domaine (normalisé : "jetterix-es" == jetterix.es) — standard
//      depuis le rollout du 13/07/2026
//   2. referer == domaine — Everflow enregistre le site d'origine du clic ;
//      couvre les conversions historiques d'avant le rollout sub1
// Jamais de matching par nom d'offre (décision Leo 12/07 : les offres sont
// partagées avec les shops, chiffres faux sinon).
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const daysParam = Number(new URL(request.url).searchParams.get("days"));
  const days = Number.isFinite(daysParam) && daysParam > 0 ? Math.min(daysParam, 120) : DEFAULT_RESYNC_DAYS;

  const supabase = createAdminClient();

  const { data: emdSites, error: sitesErr } = await supabase
    .from("sites")
    .select("id, domain")
    .eq("category", "emd");
  if (sitesErr || !emdSites) {
    return NextResponse.json({ error: sitesErr?.message }, { status: 500 });
  }
  const siteByKey = new Map(
    emdSites.map((s) => [normalizeDomainKey(s.domain), { id: s.id, domain: s.domain }])
  );

  const to = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);

  let upserted = 0;
  let attributedRevenue = 0;
  const unmatched = new Map<string, number>();
  const errors: string[] = [];

  for (const network of EVERFLOW_NETWORKS) {
    const apiKey = process.env[network.tokenEnv];
    if (!apiKey) continue;

    let conversions;
    try {
      conversions = await fetchConversions(apiKey, from, to);
    } catch (err) {
      errors.push(`${network.key}: ${err instanceof Error ? err.message : err}`);
      continue;
    }

    // Agrégation site × jour
    const agg = new Map<string, { siteId: string; domain: string; date: string; conversions: number; revenue: number }>();
    for (const c of conversions) {
      const site =
        (c.sub1 ? siteByKey.get(normalizeDomainKey(c.sub1)) : undefined) ??
        (c.refererHost ? siteByKey.get(normalizeDomainKey(c.refererHost)) : undefined);
      if (!site) {
        if (c.revenueUsd > 0) {
          const label = `${c.offerName}${c.refererHost ? ` [ref=${c.refererHost}]` : c.sub1 ? ` [sub1=${c.sub1}]` : " [sans origine]"}`;
          unmatched.set(label, (unmatched.get(label) ?? 0) + c.revenueUsd);
        }
        continue;
      }
      const key = `${site.id}|${c.date}`;
      const cur = agg.get(key) ?? { siteId: site.id, domain: site.domain, date: c.date, conversions: 0, revenue: 0 };
      cur.conversions += 1;
      cur.revenue += c.revenueUsd;
      agg.set(key, cur);
      attributedRevenue += c.revenueUsd;
    }

    for (const row of agg.values()) {
      const { error } = await supabase.from("domain_revenue").upsert(
        {
          site_id: row.siteId,
          date: row.date,
          network: network.key,
          conversions: row.conversions,
          revenue_usd: Math.round(row.revenue * 100) / 100,
        },
        { onConflict: "site_id,date,network" }
      );
      if (error) errors.push(`upsert ${row.domain} ${row.date}: ${error.message}`);
      else upserted++;
    }
  }

  return NextResponse.json({
    success: true,
    window: { from, to, days },
    rows_upserted: upserted,
    attributed_revenue_usd: Math.round(attributedRevenue * 100) / 100,
    unmatched_offers_with_revenue: Object.fromEntries(
      [...unmatched.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)
    ),
    errors,
  });
}

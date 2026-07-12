import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  EVERFLOW_NETWORKS,
  fetchDailyOfferRevenue,
  normalizeDomainKey,
  cleanSub1,
} from "@/lib/everflow/client";

export const maxDuration = 300;

const RESYNC_DAYS = 7; // re-scan glissant : rattrape les conversions tardives

// Sync quotidien des revenus Everflow -> domain_revenue, par domaine EMD.
// Attribution STRICTE : uniquement sub1 == domaine (comparaison normalisée,
// "jetterix-es" == jetterix.es). Aucun matching par nom d'offre (le trafic
// sans sub1 vient aussi des shops/autres sources → chiffres faux sinon).
// Les revenus sans sub1 EMD sont listés dans la réponse pour visibilité.
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();

  const { data: emdSites, error: sitesErr } = await supabase
    .from("sites")
    .select("id, domain")
    .eq("category", "emd");
  if (sitesErr || !emdSites) {
    return NextResponse.json({ error: sitesErr?.message }, { status: 500 });
  }
  // Clé normalisée : "jetterix-es" (sub1 worker) == "jetterix.es" (domaine)
  const siteByKey = new Map(
    emdSites.map((s) => [normalizeDomainKey(s.domain), { id: s.id, domain: s.domain }])
  );

  const days: string[] = [];
  for (let i = 0; i < RESYNC_DAYS; i++) {
    days.push(new Date(Date.now() - i * 86400_000).toISOString().slice(0, 10));
  }

  let upserted = 0;
  const unmatched = new Map<string, number>(); // offerLabel -> revenue
  const errors: string[] = [];

  for (const network of EVERFLOW_NETWORKS) {
    const apiKey = process.env[network.tokenEnv];
    if (!apiKey) continue;

    for (const date of days) {
      let rows;
      try {
        rows = await fetchDailyOfferRevenue(apiKey, date);
      } catch (err) {
        errors.push(`${network.key} ${date}: ${err instanceof Error ? err.message : err}`);
        continue;
      }

      // Agrégation par domaine pour ce jour/réseau — sub1 strict uniquement
      const byDomain = new Map<string, { siteId: string; conversions: number; revenue: number }>();
      for (const row of rows) {
        const sub1 = cleanSub1(row.sub1);
        const site = sub1 ? siteByKey.get(normalizeDomainKey(sub1)) : undefined;
        if (!site) {
          if (row.revenueUsd > 0) {
            const label = `${row.offerLabel}${sub1 ? ` [sub1=${sub1}]` : " [sans sub1]"}`;
            unmatched.set(label, (unmatched.get(label) ?? 0) + row.revenueUsd);
          }
          continue;
        }
        const cur =
          byDomain.get(site.domain) ?? { siteId: site.id, conversions: 0, revenue: 0 };
        cur.conversions += row.conversions;
        cur.revenue += row.revenueUsd;
        byDomain.set(site.domain, cur);
      }

      for (const [domain, agg] of byDomain) {
        const { error } = await supabase.from("domain_revenue").upsert(
          {
            site_id: agg.siteId,
            date,
            network: network.key,
            conversions: agg.conversions,
            revenue_usd: Math.round(agg.revenue * 100) / 100,
          },
          { onConflict: "site_id,date,network" }
        );
        if (error) errors.push(`upsert ${domain} ${date}: ${error.message}`);
        else upserted++;
      }
    }
  }

  return NextResponse.json({
    success: true,
    days_scanned: RESYNC_DAYS,
    rows_upserted: upserted,
    unmatched_offers_with_revenue: Object.fromEntries(
      [...unmatched.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)
    ),
    errors,
  });
}

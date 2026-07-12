import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  EVERFLOW_NETWORKS,
  fetchDailyOfferRevenue,
  matchOfferToDomain,
} from "@/lib/everflow/client";

export const maxDuration = 300;

const RESYNC_DAYS = 7; // re-scan glissant : rattrape les conversions tardives

// Sync quotidien des revenus Everflow -> domain_revenue, par domaine EMD.
// Attribution :
//   1. sub1 == domaine EMD connu (exact, prioritaire — futur standard)
//   2. sinon match strict nom d'offre <-> tokens du domaine (unique, sans
//      ambiguïté) — les offres partagées avec les shops ne matchent pas.
// Les offres avec revenu non attribuées sont remontées dans la réponse.
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
  const siteByDomain = new Map(emdSites.map((s) => [s.domain, s.id]));
  const domains = emdSites.map((s) => s.domain);

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

      // Agrégation par domaine pour ce jour/réseau
      const byDomain = new Map<string, { conversions: number; revenue: number }>();
      for (const row of rows) {
        const domain =
          (row.sub1 && siteByDomain.has(row.sub1) ? row.sub1 : null) ??
          matchOfferToDomain(row.offerLabel, domains);
        if (!domain) {
          if (row.revenueUsd > 0) {
            unmatched.set(
              row.offerLabel,
              (unmatched.get(row.offerLabel) ?? 0) + row.revenueUsd
            );
          }
          continue;
        }
        const cur = byDomain.get(domain) ?? { conversions: 0, revenue: 0 };
        cur.conversions += row.conversions;
        cur.revenue += row.revenueUsd;
        byDomain.set(domain, cur);
      }

      for (const [domain, agg] of byDomain) {
        const siteId = siteByDomain.get(domain)!;
        const { error } = await supabase.from("domain_revenue").upsert(
          {
            site_id: siteId,
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

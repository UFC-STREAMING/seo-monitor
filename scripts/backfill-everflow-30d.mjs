// Backfill one-shot : revenus Everflow des 30 derniers jours, attribution
// STRICTE sub1 == domaine EMD (normalisé). Même logique que le cron
// sync-everflow-revenue (qui lui ne couvre que 7 jours glissants).
// Usage : node --env-file=.env.local scripts/backfill-everflow-30d.mjs

import { createClient } from "@supabase/supabase-js";

const DAYS = 30;
const NETWORKS = [
  { key: "mediascaler", env: "EVERFLOW_MEDIASCALER_KEY" },
  { key: "smartadv", env: "EVERFLOW_SMARTADV_KEY" },
  { key: "smashloud", env: "EVERFLOW_SMASHLOUD_KEY" },
];

const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const { data: sites } = await supabase.from("sites").select("id, domain").eq("category", "emd");
const byKey = new Map(sites.map((s) => [norm(s.domain), s]));

let upserted = 0;
const attributed = [];

for (const net of NETWORKS) {
  const key = process.env[net.env];
  if (!key) continue;
  for (let i = 0; i < DAYS; i++) {
    const date = new Date(Date.now() - i * 86400_000).toISOString().slice(0, 10);
    const res = await fetch("https://api.eflow.team/v1/affiliates/reporting/entity", {
      method: "POST",
      headers: { "X-Eflow-API-Key": key, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: date, to: date, timezone_id: 67, currency_id: "USD",
        query: { filters: [] },
        columns: [{ column: "offer" }, { column: "sub1" }],
      }),
    });
    if (!res.ok) { console.error(`${net.key} ${date}: HTTP ${res.status}`); continue; }
    const json = await res.json();

    const byDomain = new Map();
    for (const row of json.table ?? []) {
      const cols = new Map(row.columns.map((c) => [c.column_type, c.label ?? ""]));
      const cv = row.reporting.cv ?? 0;
      const rev = row.reporting.revenue ?? 0;
      if (!cv && !rev) continue;
      const sub1 = cols.get("sub1");
      if (!sub1 || sub1 === "N/A") continue;
      const site = byKey.get(norm(sub1));
      if (!site) continue;
      const cur = byDomain.get(site.id) ?? { domain: site.domain, cv: 0, rev: 0 };
      cur.cv += cv; cur.rev += rev;
      byDomain.set(site.id, cur);
    }

    for (const [siteId, agg] of byDomain) {
      const { error } = await supabase.from("domain_revenue").upsert(
        { site_id: siteId, date, network: net.key, conversions: agg.cv, revenue_usd: Math.round(agg.rev * 100) / 100 },
        { onConflict: "site_id,date,network" }
      );
      if (error) console.error(`upsert ${agg.domain} ${date}: ${error.message}`);
      else { upserted++; attributed.push(`${date} ${agg.domain} (${net.key}): ${agg.cv} conv, $${agg.rev}`); }
    }
  }
}

console.log(`✅ ${upserted} lignes sur ${DAYS} jours :`);
attributed.sort().forEach((l) => console.log("  " + l));

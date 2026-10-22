// Trafic Google estimé des domaines expirés : DataForSEO Labs « historical bulk traffic estimation »
// appelé via treg (clé injectée côté treg, facturé sur le solde prépayé de l'équipe leo-4).
// Prix mesuré le 21/10/2026 : ~0,12 $ par appel + ~0,0012 $ par domaine, la période ne change rien
// → on demande toujours tout l'historique (depuis 2020-10) en un seul appel, 1000 domaines max.

import { domainToASCII } from "node:url";

const ENDPOINT = "dataforseo.x.dataforseo-labs-google-historical-bulk-traffic-estimation-live";

export interface TrafficPoint { m: string; v: number }
export interface DomainTraffic {
  domain: string;
  current: number;
  six_months: number;
  peak: number;
  peak_month: string | null;
  series: TrafficPoint[];
}

type Item = { target: string; metrics: { organic: { year: number; month: number; etv: number | null }[] | null } };

// Réduit la série brute (du plus récent au plus ancien) en chiffres utiles.
export function summarize(target: string, organic: Item["metrics"]["organic"]): DomainTraffic {
  const series = (organic ?? [])
    .map((p) => ({ m: `${p.year}-${String(p.month).padStart(2, "0")}`, v: Math.round(p.etv ?? 0) }))
    .sort((a, b) => a.m.localeCompare(b.m));
  const last = series[series.length - 1];
  const six = series[series.length - 7];
  const peak = series.reduce<TrafficPoint | null>((best, p) => (!best || p.v > best.v ? p : best), null);
  return {
    domain: target,
    current: last?.v ?? 0,
    six_months: six?.v ?? 0,
    peak: peak?.v ?? 0,
    peak_month: peak && peak.v > 0 ? peak.m : null,
    series,
  };
}

export async function fetchTraffic(domains: string[]): Promise<{ results: DomainTraffic[]; costUsd: number }> {
  const token = process.env.TREG_TOKEN;
  if (!token) throw new Error("TREG_TOKEN manquant");
  const results: DomainTraffic[] = [];
  let costUsd = 0;
  // Un nom accentué (augen-köln.de) fait échouer TOUT l'appel → envoi en punycode, résultat ramené au nom d'origine.
  const ascii = new Map(domains.map((d) => [domainToASCII(d), d]));
  const valid = [...ascii.keys()].filter((d) => /^[a-z0-9.-]+$/.test(d));
  for (let i = 0; i < valid.length; i += 1000) {
    const targets = valid.slice(i, i + 1000);
    const res = await fetch(`https://treg.to/call/${ENDPOINT}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Treg-Token": token,
        "X-Treg-Org": process.env.TREG_ORG || "leo-4",
      },
      body: JSON.stringify([{ targets, date_from: "2020-10-01", item_types: ["organic"] }]),
      signal: AbortSignal.timeout(90_000),
    });
    const json = await res.json();
    const task = json?.tasks?.[0];
    if (!res.ok || task?.status_code !== 20000) {
      throw new Error(`treg/DataForSEO ${res.status} ${task?.status_message ?? json?.status_message ?? json?.error ?? ""}`.trim());
    }
    costUsd += Number(json.cost ?? 0);
    for (const it of (task.result?.[0]?.items ?? []) as Item[]) results.push(summarize(ascii.get(it.target) ?? it.target, it.metrics?.organic));
  }
  return { results, costUsd };
}

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

// 04/11/2026 : 1 518 domaines en lots de 1 000 → treg 502, tout perdu (aucun lot enregistré).
// Maintenant : lots de 250, 2 nouveaux essais par lot, chaque lot enregistré dès réception (onBatch),
// arrêt propre avant la limite Vercel ; ce qui reste est renvoyé dans `remaining` pour une relance.
const BATCH = 250;

async function callBatch(targets: string[], token: string, deadlineMs?: number) {
  let last = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt && deadlineMs && Date.now() > deadlineMs) break; // pas de nouvel essai après l'échéance (limite Vercel 300 s)
    if (attempt) await new Promise((r) => setTimeout(r, 5_000 * attempt));
    try {
      const res = await fetch(`https://treg.to/call/${ENDPOINT}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Treg-Token": token,
          "X-Treg-Org": process.env.TREG_ORG || "leo-4",
        },
        body: JSON.stringify([{ targets, date_from: "2020-10-01", item_types: ["organic"] }]),
        signal: AbortSignal.timeout(75_000),
      });
      const json = await res.json().catch(() => null);
      const task = json?.tasks?.[0];
      if (res.ok && task?.status_code === 20000) return { json, task };
      last = `treg/DataForSEO ${res.status} ${task?.status_message ?? json?.status_message ?? json?.detail ?? json?.error ?? ""}`.trim();
      // clé refusée / solde / requête invalide : inutile de réessayer
      if (res.status === 401 || res.status === 402 || res.status === 403 || (res.ok && task?.status_code && task.status_code < 50000)) break;
    } catch (e) {
      last = `treg/DataForSEO ${e instanceof Error ? e.message : String(e)}`;
    }
  }
  throw new Error(last);
}

export async function fetchTraffic(
  domains: string[],
  opts: { onBatch?: (batch: DomainTraffic[]) => Promise<void>; deadlineMs?: number } = {},
): Promise<{ results: DomainTraffic[]; costUsd: number; remaining: number; error?: string }> {
  const token = process.env.TREG_TOKEN;
  if (!token) throw new Error("TREG_TOKEN manquant");
  const results: DomainTraffic[] = [];
  let costUsd = 0;
  // Un nom accentué (augen-köln.de) fait échouer TOUT l'appel → envoi en punycode, résultat ramené au nom d'origine.
  const ascii = new Map(domains.map((d) => [domainToASCII(d), d]));
  const valid = [...ascii.keys()].filter((d) => /^[a-z0-9.-]+$/.test(d));
  let error: string | undefined;
  let i = 0;
  for (; i < valid.length; i += BATCH) {
    if (opts.deadlineMs && Date.now() > opts.deadlineMs) break;
    let got;
    try {
      got = await callBatch(valid.slice(i, i + BATCH), token, opts.deadlineMs);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      continue; // un lot en panne ne bloque pas les suivants
    }
    costUsd += Number(got.json.cost ?? 0);
    const items = new Map(((got.task.result?.[0]?.items ?? []) as Item[]).map((it) => [it.target, it]));
    // domaine absent de la réponse = aucun trafic connu → relevé à 0 (sinon il resterait « non relevé » pour toujours)
    const batch = valid.slice(i, i + BATCH).map((t) => summarize(ascii.get(t) ?? t, items.get(t)?.metrics?.organic ?? null));
    if (opts.onBatch) await opts.onBatch(batch);
    results.push(...batch);
  }
  return { results, costUsd, remaining: valid.length - results.length, error };
}

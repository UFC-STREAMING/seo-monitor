// Vrais clics d'utilisateurs (Leo 10/10/2026) : le rapport agrégé d'Everflow compte aussi
// les robots (Seznam, hébergeurs, navigateurs sans moteur…) et nos propres clics. On lit
// donc le journal clic par clic (reporting/clicks) et on ne garde que les humains.

import { EVERFLOW_NETWORKS } from "@/lib/everflow/client";

const EFLOW_API = "https://api.eflow.team/v1/affiliates";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Nos propres clics : aucun EMD ne cible ces pays
const OWN_COUNTRIES = new Set(["BG", "TH"]);
// Opérateurs = hébergeurs, clouds, moteurs : pas des internautes
const DATACENTER =
  /amazon|aws|google|microsoft|azure|ovh|hetzner|digitalocean|linode|akamai|cloudflare|oracle|alibaba|tencent|contabo|leaseweb|choopa|vultr|m247|datacamp|zscaler|seznam|yandex|baidu|bytedance|scaleway|online s\.a\.s|hostinger|ionos|godaddy|colocrossing|psychz|fastly|facebook|meta platforms|apple inc/i;

export interface RawClick {
  sub1?: string;
  error_code?: number;
  relationship?: {
    geolocation?: { country_code?: string; isp_name?: string; organization?: string; is_proxy?: boolean };
    device_information?: { platform_name?: string; browser_name?: string; is_robot?: boolean; is_filter?: boolean };
  };
  unix_timestamp?: number;
}

export type ClickKind = "human" | "bot" | "own" | "rejected";

export function classifyClick(c: RawClick): ClickKind {
  const g = c.relationship?.geolocation ?? {};
  const d = c.relationship?.device_information ?? {};
  if (OWN_COUNTRIES.has((g.country_code ?? "").toUpperCase())) return "own";
  if (d.is_robot || d.is_filter || g.is_proxy) return "bot";
  if (!d.browser_name || !d.platform_name || d.platform_name === "Unknown") return "bot";
  if (DATACENTER.test(`${g.isp_name ?? ""} ${g.organization ?? ""}`)) return "bot";
  // Clic d'un humain mais refusé par Everflow (pays hors offre, doublon…)
  if ((c.error_code ?? 0) !== 0) return "rejected";
  return "human";
}

/** Journal des clics d'une période, découpé pour rester sous le plafond de 1000 lignes. */
async function fetchClicks(key: string, fromTs: number, toTs: number, depth = 0): Promise<RawClick[]> {
  const fmt = (t: number) => new Date(t * 1000).toISOString().slice(0, 19).replace("T", " ");
  await sleep(250); // 5 req/s max par clé
  const res = await fetch(`${EFLOW_API}/reporting/clicks`, {
    method: "POST",
    headers: { "X-Eflow-API-Key": key, "Content-Type": "application/json" },
    body: JSON.stringify({ from: fmt(fromTs), to: fmt(toTs), timezone_id: 67, query: { filters: [] } }),
  });
  if (res.status === 429) { await sleep(1500); return fetchClicks(key, fromTs, toTs, depth); }
  if (!res.ok) throw new Error(`Everflow clicks HTTP ${res.status}`);
  const json = JSON.parse((await res.text()).replace(/[\u0000-\u001f]/g, " ")) as { clicks?: RawClick[] };
  const clicks = json.clicks ?? [];
  if (clicks.length >= 1000 && toTs - fromTs > 600 && depth < 8) {
    const mid = Math.floor((fromTs + toTs) / 2);
    return [...(await fetchClicks(key, fromTs, mid, depth + 1)), ...(await fetchClicks(key, mid + 1, toTs, depth + 1))];
  }
  return clicks;
}

/** Clics d'une journée UTC (YYYY-MM-DD) sur les 3 réseaux. */
export async function clicksOfDay(date: string): Promise<RawClick[]> {
  const start = Date.parse(`${date}T00:00:00Z`) / 1000;
  const out: RawClick[] = [];
  for (const net of EVERFLOW_NETWORKS) {
    const key = process.env[net.tokenEnv];
    if (!key) continue;
    out.push(...(await fetchClicks(key, start, start + 86399)));
  }
  return out;
}

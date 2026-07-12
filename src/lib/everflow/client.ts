// Client Everflow (affilié) — revenus par offre/sub1 pour l'attribution
// par domaine EMD. 3 réseaux basés Everflow : MediaScaler, SmartAdv, SmashLoud.

const EFLOW_API = "https://api.eflow.team/v1/affiliates";

export const EVERFLOW_NETWORKS = [
  { key: "mediascaler", tokenEnv: "EVERFLOW_MEDIASCALER_KEY" },
  { key: "smartadv", tokenEnv: "EVERFLOW_SMARTADV_KEY" },
  { key: "smashloud", tokenEnv: "EVERFLOW_SMASHLOUD_KEY" },
] as const;

export interface EverflowOfferRow {
  offerLabel: string;
  sub1: string | null;
  conversions: number;
  revenueUsd: number;
}

/**
 * Reporting d'un jour donné, groupé par offre + sub1.
 * `date` au format YYYY-MM-DD (timezone UTC côté Everflow).
 */
export async function fetchDailyOfferRevenue(
  apiKey: string,
  date: string
): Promise<EverflowOfferRow[]> {
  const res = await fetch(`${EFLOW_API}/reporting/entity`, {
    method: "POST",
    headers: {
      "X-Eflow-API-Key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: date,
      to: date,
      timezone_id: 67, // UTC
      currency_id: "USD",
      query: { filters: [] },
      columns: [{ column: "offer" }, { column: "sub1" }],
    }),
  });
  if (!res.ok) {
    throw new Error(`Everflow HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }

  const json = (await res.json()) as {
    table?: Array<{
      columns: Array<{ column_type: string; label?: string }>;
      reporting: { cv?: number; revenue?: number };
    }>;
  };

  return (json.table ?? [])
    .map((row) => {
      const cols = new Map(row.columns.map((c) => [c.column_type, c.label ?? ""]));
      return {
        offerLabel: cols.get("offer") ?? "",
        sub1: cols.get("sub1") || null,
        conversions: row.reporting.cv ?? 0,
        revenueUsd: row.reporting.revenue ?? 0,
      };
    })
    .filter((r) => r.conversions > 0 || r.revenueUsd > 0);
}

// ── Attribution offre -> domaine EMD ─────────────────────────────────────────

// Mots génériques/géo ignorés lors du matching (présents dans le domaine mais
// pas forcément dans le nom de l'offre).
const GENERIC_TOKENS = new Set([
  "france", "australia", "japan", "turkiye", "deutschland", "espana",
  "kasino", "kasyno", "casino", "capsules", "patch", "pro", "plus",
  "official", "shop", "site", "co", "com", "net", "org", "uk", "fr", "de",
  "es", "at", "ch", "nl", "no", "pl", "kz", "icu", "male", "enhancement",
]);

function domainTokens(domain: string): string[] {
  return domain
    .toLowerCase()
    .replace(/\.[a-z.]+$/, "") // TLD (y compris .co.uk / .co.no)
    .split(/[-.]/)
    .flatMap((t) => t.split(/(?<=[a-z])(?=[0-9])/))
    .filter((t) => t.length >= 3 && !GENERIC_TOKENS.has(t));
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Attribue une offre à UN domaine EMD, ou null si ambigu / aucun match.
 * Règle stricte : tous les tokens significatifs du domaine doivent apparaître
 * dans le label de l'offre, et un seul domaine doit matcher.
 * (Les brands shop — Lulutox, CoreGLP… — ne matchent aucun domaine EMD.)
 */
export function matchOfferToDomain(
  offerLabel: string,
  domains: string[]
): string | null {
  const offerNorm = normalize(offerLabel);
  const matches = domains.filter((domain) => {
    const tokens = domainTokens(domain);
    if (tokens.length === 0) return false;
    return tokens.every((t) => offerNorm.includes(normalize(t)));
  });
  return matches.length === 1 ? matches[0] : null;
}

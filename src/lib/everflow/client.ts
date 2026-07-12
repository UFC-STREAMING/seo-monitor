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

// ── Attribution sub1 -> domaine EMD (STRICT) ─────────────────────────────────
//
// Décision Leo 12/07/2026 : on n'attribue QUE les conversions dont le sub1
// correspond au domaine. Pas de matching par nom d'offre — le trafic sans
// sub1 peut venir des shops WP ou d'autres sources, et gonflait les chiffres
// (ex. 435$ attribués à tort à orivelle-fungus-pen.co.uk).
//
// Les workers EMD envoient le sub1 avec des tirets à la place des points
// (ex. "jetterix-es" pour jetterix.es) → comparaison normalisée.

/** "jetterix.es" / "jetterix-es" / "Jetterix ES" -> "jetterixes" */
export function normalizeDomainKey(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Everflow renvoie le label "N/A" quand le sub1 est vide. */
export function cleanSub1(sub1: string | null): string | null {
  if (!sub1 || sub1 === "N/A" || sub1.toLowerCase() === "n/a") return null;
  return sub1;
}

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

// ── Rapport de conversions détaillé (avec referer = preuve d'origine) ────────

export interface EverflowConversion {
  sub1: string | null;
  /** Domaine d'origine du clic enregistré par Everflow (ex. "orivelle-ongles.fr"). */
  refererHost: string | null;
  revenueUsd: number;
  offerName: string;
  /** Date UTC YYYY-MM-DD de la conversion. */
  date: string;
}

function extractHost(referer: string | null | undefined): string | null {
  if (!referer) return null;
  let h = referer.trim().toLowerCase();
  if (h.includes("://")) h = h.split("://")[1];
  h = h.split("/")[0].split(":")[0].replace(/^www\./, "");
  return h.includes(".") ? h : null;
}

/**
 * Conversions détaillées sur une période (sub1 + referer + revenu).
 * Le referer permet d'attribuer les ventes HISTORIQUES (avant le rollout
 * sub1 du 13/07/2026) avec une preuve réelle.
 */
export async function fetchConversions(
  apiKey: string,
  from: string,
  to: string
): Promise<EverflowConversion[]> {
  const out: EverflowConversion[] = [];
  const PAGE_SIZE = 2000;
  for (let page = 1; page <= 25; page++) {
    const res = await fetch(`${EFLOW_API}/reporting/conversions`, {
      method: "POST",
      headers: { "X-Eflow-API-Key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to,
        timezone_id: 67, // UTC
        show_conversions: true,
        show_events: false,
        query: { filters: [] },
        paging: { page, page_size: PAGE_SIZE },
      }),
    });
    if (!res.ok) {
      throw new Error(`Everflow conversions HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    }
    const json = (await res.json()) as {
      conversions?: Array<{
        sub1?: string;
        referer?: string;
        revenue?: number;
        conversion_unix_timestamp?: number;
        relationship?: { offer?: { name?: string } };
      }>;
    };
    const rows = json.conversions ?? [];
    for (const r of rows) {
      const ts = (r.conversion_unix_timestamp ?? 0) * 1000;
      out.push({
        sub1: cleanSub1(r.sub1 ?? null),
        refererHost: extractHost(r.referer),
        revenueUsd: r.revenue ?? 0,
        offerName: r.relationship?.offer?.name ?? "",
        date: new Date(ts).toISOString().slice(0, 10),
      });
    }
    if (rows.length < PAGE_SIZE) break;
  }
  return out;
}

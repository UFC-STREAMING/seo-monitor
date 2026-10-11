// Analyse « $ récupérables » (Leo 11/10/2026) : pour chaque EMD, l'argent qu'il ferait
// en plus s'il convertissait comme le reste du parc, étape par étape, avec un niveau
// de fiabilité pour ne pas courir après du bruit statistique.
//
//   étape « bouton » : visites (Clarity) → clics humains sur le bouton
//   étape « vente »  : clics humains → ventes (Everflow)
//
// Référence = taux du parc mesuré sur les EMD qui ont assez de volume (pooled).
// Fiabilité = borne haute de Wilson à 90 % du taux du site comparée à la référence.

import type { FunnelRow } from "@/lib/tracking/funnel";

const MIN_CLICKS_REF = 20; // un EMD ne compte dans la référence « vente » qu'à partir de 20 clics
const MIN_SESSIONS_REF = 30;
const Z = 1.645; // 90 %

export type Confidence = "sure" | "probable" | "early";

export interface Opportunity {
  site_id: string;
  domain: string;
  stage: "bouton" | "vente";
  monthly_usd: number;
  confidence: Confidence;
  explanation: string;
}

export interface Benchmarks {
  click_rate: number | null; // clics humains / visites
  conversion_rate: number | null; // ventes / clics humains
  usd_per_sale: number;
  sites_click_rate: number;
  sites_conversion_rate: number;
}

/** Borne haute de Wilson : le meilleur taux plausible vu le petit échantillon. */
function wilsonUpper(successes: number, trials: number): number {
  if (trials === 0) return 1;
  const p = successes / trials;
  const d = 1 + (Z * Z) / trials;
  const c = p + (Z * Z) / (2 * trials);
  const m = Z * Math.sqrt((p * (1 - p)) / trials + (Z * Z) / (4 * trials * trials));
  return (c + m) / d;
}

function confidence(successes: number, trials: number, ref: number): Confidence {
  const upper = wilsonUpper(successes, trials);
  if (upper < ref) return "sure"; // même au mieux, le site reste sous la référence
  if (upper < ref * 1.5 && trials >= 15) return "probable";
  return "early";
}

const pct = (x: number) => `${(x * 100).toFixed(1)} %`;

export function analyze(rows: FunnelRow[], days: number): { benchmarks: Benchmarks; opportunities: Opportunity[] } {
  const toMonth = 30 / days;

  const saleRef = rows.filter((r) => r.go_clicks >= MIN_CLICKS_REF);
  const refClicks = saleRef.reduce((a, r) => a + r.go_clicks, 0);
  const refSales = saleRef.reduce((a, r) => a + r.conversions, 0);
  const conversion_rate = refClicks ? refSales / refClicks : null;

  const clickRef = rows.filter((r) => (r.sessions ?? 0) >= MIN_SESSIONS_REF);
  const refSessions = clickRef.reduce((a, r) => a + (r.sessions ?? 0), 0);
  const refGo = clickRef.reduce((a, r) => a + r.go_clicks, 0);
  const click_rate = refSessions ? refGo / refSessions : null;

  const allSales = rows.reduce((a, r) => a + r.conversions, 0);
  const allRevenue = rows.reduce((a, r) => a + r.revenue_usd, 0);
  const usd_per_sale = allSales ? allRevenue / allSales : 45;

  const opportunities: Opportunity[] = [];
  for (const r of rows) {
    const perSale = r.conversions ? r.revenue_usd / r.conversions : usd_per_sale;

    // Étape vente : clics humains → ventes
    if (conversion_rate && r.go_clicks >= 10) {
      const expected = r.go_clicks * conversion_rate;
      const missing = expected - r.conversions;
      if (missing > 0) {
        const conf = confidence(r.conversions, r.go_clicks, conversion_rate);
        opportunities.push({
          site_id: r.site_id,
          domain: r.domain,
          stage: "vente",
          monthly_usd: Math.round(missing * perSale * toMonth),
          confidence: conf,
          explanation:
            `${r.go_clicks} clics humains → ${r.conversions} vente(s) (${pct(r.conversions / r.go_clicks)}) contre ${pct(conversion_rate)} sur le parc : ` +
            `offre, pays ou page de vente à vérifier`,
        });
      }
    }

    // Étape bouton : visites → clics (seulement quand Clarity a assez de visites)
    if (click_rate && conversion_rate && (r.sessions ?? 0) >= 20) {
      const s = r.sessions ?? 0;
      const missingClicks = s * click_rate - r.go_clicks;
      if (missingClicks > 0) {
        const conf = confidence(r.go_clicks, s, click_rate);
        opportunities.push({
          site_id: r.site_id,
          domain: r.domain,
          stage: "bouton",
          monthly_usd: Math.round(missingClicks * conversion_rate * perSale * toMonth),
          confidence: conf,
          explanation:
            `${s} visites → ${r.go_clicks} clics bouton (${pct(r.go_clicks / s)}) contre ${pct(click_rate)} sur le parc` +
            (r.scroll_depth !== null && r.scroll_depth < 35 ? ` ; scroll moyen ${Math.round(r.scroll_depth)} % : le bouton n'est sans doute pas vu` : "") +
            ` : bouton, accroche ou haut de page à revoir`,
        });
      }
    }
  }

  const order: Record<Confidence, number> = { sure: 0, probable: 1, early: 2 };
  opportunities.sort((a, b) => order[a.confidence] - order[b.confidence] || b.monthly_usd - a.monthly_usd);
  return {
    benchmarks: { click_rate, conversion_rate, usd_per_sale, sites_click_rate: clickRef.length, sites_conversion_rate: saleRef.length },
    opportunities: opportunities.filter((o) => o.monthly_usd >= 5),
  };
}

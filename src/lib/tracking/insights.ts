// « Où ça clique » et « Ce qui marche » (Leo 11/10/2026).
// - clics boutons (table cta_clicks) : répartition haut / milieu / bas / barre fixe, mobile vs ordinateur
// - éléments de page (sites.page_features) : taux visite → clic et clic → vente des EMD
//   qui ont l'élément contre ceux qui ne l'ont pas, sur les mêmes données que l'entonnoir.

import type { FunnelRow } from "@/lib/tracking/funnel";
import type { PageFeatures } from "@/lib/tracking/page-features";

export interface ClickSplit {
  position: string;
  clicks: number;
  share: number;
  mobile: number;
}

export interface FeatureComparison {
  feature: string;
  with: { sites: number; sessions: number; clicks: number; sales: number };
  without: { sites: number; sessions: number; clicks: number; sales: number };
  click_rate_with: number | null;
  click_rate_without: number | null;
  sale_rate_with: number | null;
  sale_rate_without: number | null;
  enough_data: boolean;
}

export function clickSplit(rows: Array<{ position: string | null; device: string | null }>): ClickSplit[] {
  const total = rows.length || 1;
  const by = new Map<string, { n: number; m: number }>();
  for (const r of rows) {
    const k = r.position ?? "inconnu";
    const cur = by.get(k) ?? { n: 0, m: 0 };
    cur.n++;
    if (r.device === "mobile") cur.m++;
    by.set(k, cur);
  }
  const order = ["haut", "milieu", "bas", "barre-fixe", "inconnu"];
  return [...by.entries()]
    .sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]))
    .map(([position, v]) => ({ position, clicks: v.n, share: v.n / total, mobile: v.m }));
}

const FEATURES: Array<{ label: string; test: (f: PageFeatures) => boolean }> = [
  { label: "WordPress (vs statique)", test: (f) => f.platform === "wordpress" },
  { label: "Avis clients affichés", test: (f) => f.reviews },
  { label: "Prix affichés", test: (f) => f.prices },
  { label: "Page longue (> 1 500 mots)", test: (f) => f.words > 1500 },
  { label: "6 boutons ou plus", test: (f) => f.ctas >= 6 },
  { label: "4 images ou plus", test: (f) => f.images >= 4 },
  { label: "Bouton dans l'en-tête / barre fixe", test: (f) => f.sticky_cta },
  { label: "Bouton visible en haut de page", test: (f) => f.cta_in_top },
];

export function compareFeatures(rows: FunnelRow[], features: Map<string, PageFeatures>): FeatureComparison[] {
  const out: FeatureComparison[] = [];
  for (const { label, test } of FEATURES) {
    const acc = { with: { sites: 0, sessions: 0, clicks: 0, sales: 0 }, without: { sites: 0, sessions: 0, clicks: 0, sales: 0 } };
    for (const r of rows) {
      const f = features.get(r.site_id);
      if (!f) continue;
      const g = test(f) ? acc.with : acc.without;
      g.sites++;
      g.sessions += r.sessions ?? 0;
      g.clicks += r.go_clicks;
      g.sales += r.conversions;
    }
    const rate = (a: number, b: number) => (b > 0 ? a / b : null);
    out.push({
      feature: label,
      ...acc,
      click_rate_with: rate(acc.with.clicks, acc.with.sessions),
      click_rate_without: rate(acc.without.clicks, acc.without.sessions),
      sale_rate_with: rate(acc.with.sales, acc.with.clicks),
      sale_rate_without: rate(acc.without.sales, acc.without.clicks),
      // Volumes minimaux des deux côtés pour qu'une différence veuille dire quelque chose
      enough_data:
        acc.with.sites >= 3 && acc.without.sites >= 3 &&
        ((acc.with.sessions >= 200 && acc.without.sessions >= 200) || (acc.with.clicks >= 100 && acc.without.clicks >= 100)),
    });
  }
  return out;
}

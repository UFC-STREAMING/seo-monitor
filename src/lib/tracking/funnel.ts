// Entonnoir par EMD (section Tracking) : position Google → Bing (impressions, clics)
// → visites Clarity → clics bouton Everflow → ventes, + constats automatiques qui
// désignent le maillon qui casse. Règles simples et lisibles, pas d'IA (Leo 10/10).

export interface FunnelRow {
  site_id: string;
  domain: string;
  hosting: string | null;
  keyword: string | null;
  country_iso: string | null;
  position: number | null;
  position_checked: boolean;
  affiliate_status: string | null;
  affiliate_detail: string | null;
  bing_impressions: number;
  bing_clicks: number;
  sessions: number | null; // null = Clarity pas installé
  scroll_depth: number | null;
  rage_clicks: number | null;
  go_clicks: number;
  go_invalid: number;
  conversions: number;
  revenue_usd: number;
  findings: Finding[];
}

export interface Finding {
  level: "bad" | "warn" | "good" | "info";
  text: string;
}

export function findingsFor(r: Omit<FunnelRow, "findings">): Finding[] {
  const f: Finding[] = [];
  if (r.affiliate_status === "ko") f.push({ level: "bad", text: `Lien affilié KO : ${r.affiliate_detail ?? "à vérifier"}` });

  if (!r.position_checked) f.push({ level: "info", text: "Position Google pas encore relevée" });
  else if (r.position === null || r.position > 30)
    f.push({ level: "warn", text: `${r.position === null ? "Hors top 100" : `#${r.position}`} sur Google : contenu et liens à renforcer` });

  if (r.bing_impressions >= 50 && r.bing_clicks === 0)
    f.push({ level: "warn", text: `Vu ${r.bing_impressions} fois sur Bing, 0 clic : revoir le titre et la description` });

  if (r.sessions !== null && r.sessions >= 30) {
    const ctr = r.go_clicks / r.sessions;
    if (ctr < 0.03) f.push({ level: "bad", text: `${r.sessions} visites, ${r.go_clicks} clic(s) bouton (${(ctr * 100).toFixed(1)} %) : bouton ou page à revoir` });
    if (r.scroll_depth !== null && r.scroll_depth < 30) f.push({ level: "warn", text: `Scroll moyen ${Math.round(r.scroll_depth)} % : l'accroche ne retient pas` });
    if (r.rage_clicks !== null && r.rage_clicks >= 5) f.push({ level: "warn", text: `${r.rage_clicks} clics de rage : un élément ne réagit pas comme attendu` });
  }

  if (r.go_clicks >= 20 && r.conversions === 0)
    f.push({ level: "bad", text: `${r.go_clicks} clics bouton, 0 vente : offre, pays ou page de vente à vérifier` });
  if (r.go_invalid >= 20 && r.go_invalid > r.go_clicks * 3)
    f.push({ level: "warn", text: `${r.go_invalid} clics refusés par Everflow pour ${r.go_clicks} valides : trafic hors pays de l'offre ou bots` });
  if (r.position !== null && r.position <= 10 && r.go_clicks === 0 && r.affiliate_status !== "ko")
    f.push({ level: "warn", text: `#${r.position} sur Google mais 0 clic bouton : vérifier le trafic réel et le bouton` });

  if (r.conversions > 0 && r.go_clicks >= 50 && r.conversions / r.go_clicks < 0.03)
    f.push({ level: "warn", text: `${r.go_clicks} clics bouton pour ${r.conversions} vente(s) (${((r.conversions / r.go_clicks) * 100).toFixed(1)} %) : conversion faible, vérifier l'offre et la page de vente` });
  if (r.conversions > 0) f.push({ level: "good", text: `${r.conversions} vente(s), ${Math.round(r.revenue_usd)} $` });
  return f;
}

/** Tri : ce qui casse d'abord, puis ce qui rapporte. */
export function severity(row: FunnelRow): number {
  if (row.findings.some((x) => x.level === "bad")) return 0;
  if (row.findings.some((x) => x.level === "warn")) return 1;
  if (row.findings.some((x) => x.level === "good")) return 2;
  return 3;
}

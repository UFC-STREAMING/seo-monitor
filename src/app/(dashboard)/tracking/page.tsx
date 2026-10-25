"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Activity, AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";

// Section Tracking (Leo 10/10/2026) : entonnoir par EMD sans Google Search Console.
// Google (position) → Bing/Yahoo (impressions, clics) → visites (Clarity) → clics
// bouton (Everflow) → ventes, avec les constats automatiques de lib/tracking/funnel.ts.

interface Finding { level: "bad" | "warn" | "good" | "info"; text: string }
interface Row {
  site_id: string; domain: string; hosting: string | null; keyword: string | null; country_iso: string | null;
  position: number | null; position_checked: boolean; affiliate_status: string | null;
  bing_impressions: number; bing_clicks: number; sessions: number | null; scroll_depth: number | null;
  go_clicks: number; go_invalid: number; go_bots: number; conversions: number; revenue_usd: number; findings: Finding[];
}
interface Opportunity { site_id: string; domain: string; stage: "bouton" | "vente"; monthly_usd: number; confidence: "sure" | "probable" | "early"; explanation: string }
interface FeatureCmp {
  feature: string;
  with: { sites: number; sessions: number; clicks: number; sales: number };
  without: { sites: number; sessions: number; clicks: number; sales: number };
  click_rate_with: number | null; click_rate_without: number | null;
  sale_rate_with: number | null; sale_rate_without: number | null;
  enough_data: boolean;
}
interface Resp {
  insights: {
    cta_clicks: number;
    split: { position: string; clicks: number; share: number; mobile: number }[];
    top_texts: { text: string; clicks: number }[];
    features: FeatureCmp[];
  };
  analysis: {
    benchmarks: { click_rate: number | null; conversion_rate: number | null; usd_per_sale: number; sites_click_rate: number; sites_conversion_rate: number };
    opportunities: Opportunity[];
  };
  days: number; last_bing_date: string | null; clarity_sites: number;
  totals: { bing_impressions: number; bing_clicks: number; sessions: number; go_clicks: number; go_bots: number; conversions: number; revenue_usd: number };
  rows: Row[];
}

const nf = (n: number) => n.toLocaleString("fr-FR");

type CleTri = "position" | "bing_impressions" | "bing_clicks" | "sessions" | "go_clicks" | "taux" | "conversions" | "revenue_usd";
function EnteteTri({ cle, children, className, tri, onTri }: { cle: CleTri; children: React.ReactNode; className?: string; tri: { cle: CleTri; desc: boolean } | null; onTri: (c: CleTri) => void }) {
  return (
    <TableHead className={`${className ?? ""} cursor-pointer select-none hover:text-foreground`} onClick={() => onTri(cle)}>
      {children}{tri?.cle === cle ? (tri.desc ? " ↓" : " ↑") : ""}
    </TableHead>
  );
}
function valeurTri(r: Row, cle: CleTri): number | null {
  if (cle === "taux") return r.sessions ? r.go_clicks / r.sessions : null;
  if (cle === "position") return r.position_checked && r.position !== null ? -r.position : null; // ↓ = meilleure position d'abord
  return r[cle] ?? null;
}
const flag = (iso: string | null) =>
  iso && iso.length === 2 ? iso.toUpperCase().split("").map((c) => String.fromCodePoint(0x1f1e6 + c.charCodeAt(0) - 65)).join("") : "";

function FindingLine({ f }: { f: Finding }) {
  const Icon = f.level === "bad" ? XCircle : f.level === "warn" ? AlertTriangle : f.level === "good" ? CheckCircle2 : Info;
  const color =
    f.level === "bad" ? "text-red-600 dark:text-red-400"
    : f.level === "warn" ? "text-amber-600 dark:text-amber-400"
    : f.level === "good" ? "text-emerald-600 dark:text-emerald-400"
    : "text-muted-foreground";
  return (
    <div className={`flex items-start gap-1.5 text-xs ${color}`}>
      <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span>{f.text}</span>
    </div>
  );
}

function Pos({ r }: { r: Row }) {
  if (!r.position_checked) return <span className="text-xs text-muted-foreground">—</span>;
  if (r.position === null) return <Badge variant="outline" className="text-red-500 border-red-500/40">&gt;100</Badge>;
  const cls = r.position <= 3 ? "bg-green-600 text-white" : r.position <= 10 ? "bg-emerald-500/15 text-emerald-600" : r.position <= 30 ? "bg-yellow-500/15 text-yellow-600" : "";
  return <Badge variant={cls ? "default" : "secondary"} className={`${cls} hover:${cls}`}>#{r.position}</Badge>;
}

export default function TrackingPage() {
  const [days, setDays] = useState(28);
  const [data, setData] = useState<Resp | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "bad" | "good">("all");
  // Tri par colonne (Leo 25/10/2026 : « classer par vrais clics humains »). Clic = décroissant, 2e clic = croissant.
  const [tri, setTri] = useState<{ cle: CleTri; desc: boolean } | null>(null);
  const trier = (cle: CleTri) => setTri((t) => (t && t.cle === cle ? { cle, desc: !t.desc } : { cle, desc: true }));

  useEffect(() => {
    fetch(`/api/tracking?days=${days}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then(setData)
      .catch((e) => setError(`Chargement impossible (${e})`));
  }, [days]);

  const rows = useMemo(() => {
    const all = data?.rows ?? [];
    const filtres = filter === "bad" ? all.filter((r) => r.findings.some((f) => f.level === "bad" || f.level === "warn"))
      : filter === "good" ? all.filter((r) => r.conversions > 0) : all;
    if (!tri) return filtres;
    // Valeur absente (pas de Clarity, pas de position) toujours en bas.
    return [...filtres].sort((a, b) => {
      const va = valeurTri(a, tri.cle), vb = valeurTri(b, tri.cle);
      if (va === null && vb === null) return 0;
      if (va === null) return 1;
      if (vb === null) return -1;
      return tri.desc ? vb - va : va - vb;
    });
  }, [data, filter, tri]);

  const t = data?.totals;
  const steps = t
    ? [
        { label: "Impressions Bing/Yahoo", value: nf(t.bing_impressions) },
        { label: "Clics Bing/Yahoo", value: nf(t.bing_clicks) },
        { label: "Visites (Clarity)", value: data!.clarity_sites ? nf(t.sessions) : "—" },
        { label: `Clics bouton humains (+${nf(t.go_bots)} robots exclus)`, value: nf(t.go_clicks) + (data!.clarity_sites && t.sessions ? ` · ${((t.go_clicks / t.sessions) * 100).toFixed(1)} %` : "") },
        { label: "Ventes", value: nf(t.conversions) },
        { label: "Revenus", value: `${nf(Math.round(t.revenue_usd))} $` },
      ]
    : [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Activity className="h-6 w-6" /> Tracking EMD</h1>
          <p className="text-sm text-muted-foreground">
            Entonnoir par site : position Google → Bing/Yahoo → visites → clics bouton → ventes. Le premier maillon qui casse est en rouge.
          </p>
        </div>
        <div className="flex gap-2">
          {[7, 28, 90].map((d) => (
            <Button key={d} size="sm" variant={days === d ? "default" : "outline"} onClick={() => { setData(null); setDays(d); }}>{d} j</Button>
          ))}
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {t && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
          {steps.map((s) => (
            <Card key={s.label}>
              <CardContent className="py-4">
                <p className="text-xs text-muted-foreground">{s.label}</p>
                <p className="text-xl font-semibold">{s.value}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {data && (
        <p className="text-xs text-muted-foreground">
          Bing : {data.last_bing_date ? `données jusqu'au ${new Date(data.last_bing_date).toLocaleDateString("fr-FR")}` : "en attente (≈48 h après la vérification du 09/10)"}
          {" · "}Clarity : {data.clarity_sites ? `${data.clarity_sites} site(s)` : "pas encore installé"}
          {" · "}Google : position seulement (pas de Search Console sur les EMD)
        </p>
      )}

      {data && (
        <Card className="border-emerald-200 dark:border-emerald-900">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Priorités : $ récupérables par mois</CardTitle>
            <p className="text-sm text-muted-foreground">
              Ce que chaque EMD rapporterait en plus s&apos;il convertissait comme le parc
              {data.analysis.benchmarks.conversion_rate !== null && ` (clic → vente : ${(data.analysis.benchmarks.conversion_rate * 100).toFixed(1)} %, mesuré sur ${data.analysis.benchmarks.sites_conversion_rate} EMD`}
              {data.analysis.benchmarks.click_rate !== null ? ` ; visite → clic : ${(data.analysis.benchmarks.click_rate * 100).toFixed(1)} %)` : data.analysis.benchmarks.conversion_rate !== null ? ")" : ""}
              . Fiabilité : <b>sûr</b> = l&apos;écart reste même au mieux ; <b>probable</b> ; <b>trop tôt</b> = pas assez de volume, ne pas toucher.
            </p>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {data.analysis.opportunities.length === 0 ? (
              <p className="text-sm text-muted-foreground">Rien à récupérer de façon fiable pour l&apos;instant.</p>
            ) : (
              data.analysis.opportunities.slice(0, 15).map((o) => (
                <div key={o.site_id + o.stage} className="grid grid-cols-1 gap-1 rounded-md border px-3 py-2 text-sm md:grid-cols-[7rem_13rem_7rem_1fr] md:items-center">
                  <span className="font-semibold">+{nf(o.monthly_usd)} $/mois</span>
                  <a href={`https://${o.domain}`} target="_blank" rel="noopener noreferrer" className="font-medium truncate text-blue-600 hover:underline dark:text-blue-400">{o.domain}</a>
                  <span>
                    {o.confidence === "sure" ? (
                      <Badge className="bg-red-600 hover:bg-red-600 text-white text-xs">sûr</Badge>
                    ) : o.confidence === "probable" ? (
                      <Badge className="bg-amber-500 hover:bg-amber-500 text-white text-xs">probable</Badge>
                    ) : (
                      <Badge variant="outline" className="text-xs">trop tôt</Badge>
                    )}
                    <span className="ml-1 text-xs text-muted-foreground">étape {o.stage}</span>
                  </span>
                  <span className="text-xs text-muted-foreground">{o.explanation}</span>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      )}

      {data && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Où ça clique ({nf(data.insights.cta_clicks)} clics boutons)</CardTitle>
              <p className="text-sm text-muted-foreground">Emplacement du bouton cliqué, mesuré sur la page (vrais clics, nos pays exclus).</p>
            </CardHeader>
            <CardContent className="space-y-2">
              {data.insights.cta_clicks === 0 ? (
                <p className="text-sm text-muted-foreground">Marquage posé le 11/10 : les premiers clics arrivent dans les prochains jours.</p>
              ) : (
                <>
                  {data.insights.split.map((s) => (
                    <div key={s.position} className="space-y-0.5">
                      <div className="flex justify-between text-sm">
                        <span className="capitalize">{s.position.replace("-", " ")}</span>
                        <span className="text-muted-foreground">{nf(s.clicks)} clics · {Math.round(s.share * 100)} % · {s.clicks ? Math.round((s.mobile / s.clicks) * 100) : 0} % mobile</span>
                      </div>
                      <div className="h-2 rounded bg-muted"><div className="h-2 rounded bg-emerald-600" style={{ width: `${Math.round(s.share * 100)}%` }} /></div>
                    </div>
                  ))}
                  {data.insights.top_texts.length > 0 && (
                    <div className="pt-2 text-xs text-muted-foreground">
                      Textes de bouton les plus cliqués : {data.insights.top_texts.map((t) => `« ${t.text} » (${t.clicks})`).join(", ")}
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Ce qui marche (éléments de page)</CardTitle>
              <p className="text-sm text-muted-foreground">EMD avec l&apos;élément contre EMD sans : visite → clic bouton, puis clic → vente.</p>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Élément</TableHead>
                    <TableHead className="text-right">Visite → clic<br /><span className="font-normal">avec / sans</span></TableHead>
                    <TableHead className="text-right">Clic → vente<br /><span className="font-normal">avec / sans</span></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.insights.features.map((f) => {
                    const p = (x: number | null) => (x === null ? "—" : `${(x * 100).toFixed(1)} %`);
                    return (
                      <TableRow key={f.feature}>
                        <TableCell className="text-sm">
                          {f.feature}
                          <div className="text-xs text-muted-foreground">
                            {f.with.sites} sites avec · {f.without.sites} sans{!f.enough_data && " · trop tôt pour conclure"}
                          </div>
                        </TableCell>
                        <TableCell className={`text-right text-sm ${f.enough_data ? "" : "text-muted-foreground"}`}>{p(f.click_rate_with)} / {p(f.click_rate_without)}</TableCell>
                        <TableCell className={`text-right text-sm ${f.enough_data ? "" : "text-muted-foreground"}`}>{p(f.sale_rate_with)} / {p(f.sale_rate_without)}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      )}

      <Card>
        <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Par EMD ({rows.length})</CardTitle>
          <div className="flex gap-2">
            <Button size="sm" variant={filter === "all" ? "default" : "outline"} onClick={() => setFilter("all")}>Tous</Button>
            <Button size="sm" variant={filter === "bad" ? "default" : "outline"} onClick={() => setFilter("bad")}>À corriger</Button>
            <Button size="sm" variant={filter === "good" ? "default" : "outline"} onClick={() => setFilter("good")}>Qui vendent</Button>
          </div>
        </CardHeader>
        <CardContent>
          {!data ? (
            <p className="py-6 text-sm text-muted-foreground">Chargement…</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>EMD</TableHead>
                    <EnteteTri tri={tri} onTri={trier} cle="position" className="w-20">Google</EnteteTri>
                    <EnteteTri tri={tri} onTri={trier} cle="bing_impressions" className="w-24 text-right">Bing impr.</EnteteTri>
                    <EnteteTri tri={tri} onTri={trier} cle="bing_clicks" className="w-20 text-right">Bing clics</EnteteTri>
                    <EnteteTri tri={tri} onTri={trier} cle="sessions" className="w-20 text-right">Visites</EnteteTri>
                    <EnteteTri tri={tri} onTri={trier} cle="go_clicks" className="w-28 text-right">Clics humains</EnteteTri>
                    <EnteteTri tri={tri} onTri={trier} cle="taux" className="w-20 text-right">% qui cliquent</EnteteTri>
                    <EnteteTri tri={tri} onTri={trier} cle="conversions" className="w-16 text-right">Ventes</EnteteTri>
                    <EnteteTri tri={tri} onTri={trier} cle="revenue_usd" className="w-20 text-right">Revenus</EnteteTri>
                    <TableHead className="min-w-72">Constats</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.site_id}>
                      <TableCell>
                        <a href={`https://${r.domain}`} target="_blank" rel="noopener noreferrer" className="font-medium text-blue-600 underline-offset-2 hover:underline dark:text-blue-400">
                          {r.domain}
                        </a>
                        <div className="text-xs text-muted-foreground">{flag(r.country_iso)} {r.keyword ?? ""}</div>
                      </TableCell>
                      <TableCell><Pos r={r} /></TableCell>
                      <TableCell className="text-right">{nf(r.bing_impressions)}</TableCell>
                      <TableCell className="text-right">{nf(r.bing_clicks)}</TableCell>
                      <TableCell className="text-right">{r.sessions === null ? <span className="text-muted-foreground">—</span> : nf(r.sessions)}</TableCell>
                      <TableCell className="text-right">
                        {nf(r.go_clicks)}
                        {(r.go_bots > 0 || r.go_invalid > 0) && (
                          <div className="text-xs text-muted-foreground">
                            {r.go_bots > 0 && `${nf(r.go_bots)} robots`}
                            {r.go_bots > 0 && r.go_invalid > 0 && " · "}
                            {r.go_invalid > 0 && `${nf(r.go_invalid)} refusés`}
                          </div>
                        )}
                      </TableCell>
                      {/* Part des visiteurs (Clarity) qui cliquent sur le lien d'affiliation (Leo 25/10/2026). */}
                      <TableCell className="text-right">
                        {r.sessions ? `${((r.go_clicks / r.sessions) * 100).toFixed(1)} %` : <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell className="text-right font-medium">{r.conversions || ""}</TableCell>
                      <TableCell className="text-right font-medium">{r.revenue_usd ? `${nf(Math.round(r.revenue_usd))} $` : ""}</TableCell>
                      <TableCell className="space-y-0.5">{r.findings.length ? r.findings.map((f, i) => <FindingLine key={i} f={f} />) : <span className="text-xs text-muted-foreground">RAS</span>}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
      <p className="text-xs text-muted-foreground">Positions et liens affiliés détaillés : <Link href="/rankings" className="underline">Rankings EMD</Link>.</p>
    </div>
  );
}

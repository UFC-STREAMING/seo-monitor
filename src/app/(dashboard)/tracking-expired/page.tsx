"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Activity, AlertTriangle, CheckCircle2, XCircle } from "lucide-react";

// Entonnoir des sites expirés nutra (Leo 12/10/2026) : Search Console par fiche → ventes Everflow.

interface Finding { level: "bad" | "warn" | "good"; text: string }
interface Fiche { host: string; path: string; slug: string; google_clicks: number; impressions: number; position: number | null; top_query: string | null; sales: number; revenue_usd: number; usd_per_100_clicks: number | null; networks: string[]; measured: boolean; findings: Finding[] }
interface Site { host: string; google_clicks: number; impressions: number; sales: number; revenue_usd: number; usd_per_100_clicks: number | null; fiches: number }
interface Win { host: string; page: string; query: string; impressions: number; clicks: number; position: number; sells: boolean }
interface Resp { days: number; median_usd_per_100_clicks: number | null; sites: Site[]; fiches: Fiche[]; quick_wins: Win[] }

const nf = (n: number) => n.toLocaleString("fr-FR");

function Line({ f }: { f: Finding }) {
  const Icon = f.level === "bad" ? XCircle : f.level === "warn" ? AlertTriangle : CheckCircle2;
  const c = f.level === "bad" ? "text-red-600 dark:text-red-400" : f.level === "warn" ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400";
  return <div className={`flex items-start gap-1.5 text-xs ${c}`}><Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" /><span>{f.text}</span></div>;
}

export default function TrackingExpiredPage() {
  const [days, setDays] = useState(28);
  const [data, setData] = useState<Resp | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "bad" | "good">("all");

  useEffect(() => {
    fetch(`/api/tracking/expired?days=${days}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then(setData)
      .catch((e) => setError(`Chargement impossible (${e})`));
  }, [days]);

  const fiches = (data?.fiches ?? []).filter((f) =>
    filter === "bad" ? f.findings.some((x) => x.level !== "good") : filter === "good" ? f.sales > 0 : true
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Activity className="h-6 w-6" /> Tracking sites expirés</h1>
          <p className="text-sm text-muted-foreground">
            Fiche par fiche : impressions et clics Google (Search Console) → ventes Everflow de la fiche.
            {data?.median_usd_per_100_clicks != null && ` Médiane des fiches qui vendent : ${data.median_usd_per_100_clicks} $ pour 100 clics Google.`}
          </p>
        </div>
        <div className="flex gap-2">
          {[7, 28, 90].map((d) => (
            <Button key={d} size="sm" variant={days === d ? "default" : "outline"} onClick={() => { setData(null); setDays(d); }}>{d} j</Button>
          ))}
        </div>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {!data ? <p className="text-sm text-muted-foreground">Chargement (ventes Everflow + Search Console)…</p> : (
        <>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Par site</CardTitle></CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Site</TableHead><TableHead className="text-right">Impressions</TableHead><TableHead className="text-right">Clics Google</TableHead>
                  <TableHead className="text-right">Ventes</TableHead><TableHead className="text-right">Revenus</TableHead><TableHead className="text-right">$ / 100 clics</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {data.sites.filter((s) => s.google_clicks || s.sales).map((s) => (
                    <TableRow key={s.host}>
                      <TableCell><a href={`https://${s.host}`} target="_blank" rel="noopener noreferrer" className="font-medium text-blue-600 hover:underline dark:text-blue-400">{s.host}</a></TableCell>
                      <TableCell className="text-right">{nf(s.impressions)}</TableCell>
                      <TableCell className="text-right">{s.google_clicks ? nf(s.google_clicks) : <span className="text-muted-foreground" title="Pas dans la Search Console">—</span>}</TableCell>
                      <TableCell className="text-right">{s.sales || ""}</TableCell>
                      <TableCell className="text-right font-medium">{s.revenue_usd ? `${nf(s.revenue_usd)} $` : ""}</TableCell>
                      <TableCell className="text-right">{s.usd_per_100_clicks ?? "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base">Par fiche ({fiches.length})</CardTitle>
              <div className="flex gap-2">
                <Button size="sm" variant={filter === "all" ? "default" : "outline"} onClick={() => setFilter("all")}>Toutes</Button>
                <Button size="sm" variant={filter === "bad" ? "default" : "outline"} onClick={() => setFilter("bad")}>À corriger</Button>
                <Button size="sm" variant={filter === "good" ? "default" : "outline"} onClick={() => setFilter("good")}>Qui vendent</Button>
              </div>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Fiche</TableHead><TableHead className="text-right">Clics Google</TableHead><TableHead className="w-16 text-right">Pos.</TableHead>
                  <TableHead className="text-right">Ventes</TableHead><TableHead className="text-right">$ / 100 clics</TableHead><TableHead className="min-w-72">Constats</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {fiches.slice(0, 150).map((f) => (
                    <TableRow key={f.host + f.path}>
                      <TableCell>
                        <a href={`https://${f.host}${f.path}`} target="_blank" rel="noopener noreferrer" className="font-medium text-blue-600 hover:underline dark:text-blue-400">{f.host}{f.path}</a>
                        <div className="text-xs text-muted-foreground">« {f.top_query ?? "—"} »{!f.measured && <Badge variant="outline" className="ml-2 text-[10px]">partiel</Badge>}</div>
                      </TableCell>
                      <TableCell className="text-right">{nf(f.google_clicks)}<div className="text-xs text-muted-foreground">{nf(f.impressions)} impr.</div></TableCell>
                      <TableCell className="text-right">{f.position?.toFixed(1) ?? "—"}</TableCell>
                      <TableCell className="text-right font-medium">{f.sales ? `${f.sales} · ${nf(f.revenue_usd)} $` : ""}</TableCell>
                      <TableCell className="text-right">{f.usd_per_100_clicks ?? "—"}</TableCell>
                      <TableCell className="space-y-0.5">{f.findings.length ? f.findings.map((x, i) => <Line key={i} f={x} />) : <span className="text-xs text-muted-foreground">RAS</span>}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Requêtes à gagner (position 4 à 15)</CardTitle>
              <p className="text-sm text-muted-foreground">Requêtes avec du volume juste sous le top 3 ; celles des fiches qui vendent déjà d&apos;abord.</p>
            </CardHeader>
            <CardContent className="space-y-1">
              {data.quick_wins.map((w) => (
                <div key={w.page + w.query} className="grid grid-cols-1 gap-1 text-sm md:grid-cols-[6rem_1fr_16rem_6rem] md:items-center">
                  <span className="font-medium">#{w.position.toFixed(1)}</span>
                  <span>« {w.query} » {w.sells && <Badge className="ml-1 bg-emerald-600 hover:bg-emerald-600 text-white text-[10px]">vend déjà</Badge>}</span>
                  <a href={w.page} target="_blank" rel="noopener noreferrer" className="truncate text-xs text-blue-600 hover:underline dark:text-blue-400">{w.page.replace(/^https?:\/\//, "")}</a>
                  <span className="text-xs text-muted-foreground">{nf(w.impressions)} impr.</span>
                </div>
              ))}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

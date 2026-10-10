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
  go_clicks: number; go_invalid: number; conversions: number; revenue_usd: number; findings: Finding[];
}
interface Resp {
  days: number; last_bing_date: string | null; clarity_sites: number;
  totals: { bing_impressions: number; bing_clicks: number; sessions: number; go_clicks: number; conversions: number; revenue_usd: number };
  rows: Row[];
}

const nf = (n: number) => n.toLocaleString("fr-FR");
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

  useEffect(() => {
    fetch(`/api/tracking?days=${days}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then(setData)
      .catch((e) => setError(`Chargement impossible (${e})`));
  }, [days]);

  const rows = useMemo(() => {
    const all = data?.rows ?? [];
    if (filter === "bad") return all.filter((r) => r.findings.some((f) => f.level === "bad" || f.level === "warn"));
    if (filter === "good") return all.filter((r) => r.conversions > 0);
    return all;
  }, [data, filter]);

  const t = data?.totals;
  const steps = t
    ? [
        { label: "Impressions Bing/Yahoo", value: nf(t.bing_impressions) },
        { label: "Clics Bing/Yahoo", value: nf(t.bing_clicks) },
        { label: "Visites (Clarity)", value: data!.clarity_sites ? nf(t.sessions) : "—" },
        { label: "Clics bouton", value: nf(t.go_clicks) },
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
                    <TableHead className="w-20">Google</TableHead>
                    <TableHead className="w-24 text-right">Bing impr.</TableHead>
                    <TableHead className="w-20 text-right">Bing clics</TableHead>
                    <TableHead className="w-20 text-right">Visites</TableHead>
                    <TableHead className="w-24 text-right">Clics bouton</TableHead>
                    <TableHead className="w-16 text-right">Ventes</TableHead>
                    <TableHead className="w-20 text-right">Revenus</TableHead>
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
                        {r.go_invalid > 0 && <div className="text-xs text-muted-foreground">+{nf(r.go_invalid)} refusés</div>}
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

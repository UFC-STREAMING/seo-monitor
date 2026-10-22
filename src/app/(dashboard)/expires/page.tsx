"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

// Domaines expirés du jour (Leo 22/10/2026) : liste poussée par Dana chaque matin,
// classée par trafic actuel, puis il y a 6 mois, puis pic. Case cochée = backorder posé sur cette plateforme.

interface Source { platform: string; kind: string; price: string | null; ends_at: string | null; backorder_placed: boolean }
interface Row {
  domain: string; category?: string; label?: string | null; tld?: string | null;
  traffic_current?: number | null; traffic_6m?: number | null; traffic_peak?: number | null; peak_month?: string | null;
  traffic_series?: { m: string; v: number }[] | null; traffic_checked_at?: string | null; sources: Source[];
}
interface Resp { dates: string[]; date: string | null; rows: Row[] }

const nf = (n: number | null | undefined) => (n == null ? "—" : Math.round(n).toLocaleString("fr-FR"));
const CAT: Record<string, string> = { medical: "Médical", psy: "Psy", sport: "Sport" };
const PLATFORM: Record<string, string> = { catched: "Catched", nicsell: "Nicsell", webexpire: "WebExpire", bloomup: "Bloomup", dynadot: "Dynadot", domainorder: "DomainOrder", realtime: "Realtime" };
const monthFr = (m: string | null | undefined) => (m ? `${m.slice(5, 7)}/${m.slice(0, 4)}` : "");

// Courbe de trafic : 24 derniers mois, le haut = plus de trafic.
function TrafficCurve({ series }: { series: { m: string; v: number }[] | null | undefined }) {
  const pts = (series ?? []).slice(-24);
  if (pts.length < 2 || pts.every((p) => p.v === 0)) return <span className="text-muted-foreground text-xs">—</span>;
  const W = 120, H = 30, PAD = 3;
  const max = Math.max(...pts.map((p) => p.v), 1);
  const x = (i: number) => PAD + (i * (W - 2 * PAD)) / (pts.length - 1);
  const y = (v: number) => H - PAD - (v / max) * (H - 2 * PAD);
  const line = pts.map((p, i) => `${x(i)},${y(p.v)}`).join(" ");
  const title = pts.map((p) => `${monthFr(p.m)} : ${nf(p.v)}`).join("\n");
  return (
    <svg width={W} height={H} className="text-primary" role="img" aria-label="Courbe de trafic sur 24 mois">
      <title>{title}</title>
      <polyline points={line} fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={x(pts.length - 1)} cy={y(pts[pts.length - 1].v)} r="2.5" fill="currentColor" />
    </svg>
  );
}

export default function ExpiresPage() {
  const [data, setData] = useState<Resp | null>(null);
  const [date, setDate] = useState<string>("");
  const [cat, setCat] = useState<"all" | "medical" | "psy" | "sport">("all");
  const [q, setQ] = useState("");
  const [withTraffic, setWithTraffic] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback((d?: string) => {
    fetch(`/api/expired${d ? `?date=${d}` : ""}`, { cache: "no-store" })
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? String(res.status));
        setError(null);
        setData(json);
        if (json.date) setDate(json.date);
      })
      .catch((e) => setError(`Chargement impossible (${e instanceof Error ? e.message : e})`));
  }, []);
  useEffect(() => {
    fetch("/api/expired", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((json: Resp) => { setData(json); if (json.date) setDate(json.date); })
      .catch((e) => setError(`Chargement impossible (${e})`));
  }, []);

  const rows = useMemo(() => {
    const list = (data?.rows ?? []).filter((r) =>
      (cat === "all" || r.category === cat) &&
      (!q || r.domain.includes(q.toLowerCase()) || (r.label ?? "").toLowerCase().includes(q.toLowerCase())) &&
      (!withTraffic || (r.traffic_peak ?? 0) > 0));
    return list.sort((a, b) =>
      (b.traffic_current ?? 0) - (a.traffic_current ?? 0) ||
      (b.traffic_6m ?? 0) - (a.traffic_6m ?? 0) ||
      (b.traffic_peak ?? 0) - (a.traffic_peak ?? 0) ||
      a.domain.localeCompare(b.domain));
  }, [data, cat, q, withTraffic]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: 0, medical: 0, psy: 0, sport: 0 };
    for (const r of data?.rows ?? []) { c.all++; c[r.category ?? "medical"] = (c[r.category ?? "medical"] ?? 0) + 1; }
    return c;
  }, [data]);

  async function toggle(domain: string, s: Source) {
    const placed = !s.backorder_placed;
    setData((prev) => prev && { ...prev, rows: prev.rows.map((r) => r.domain !== domain ? r : { ...r, sources: r.sources.map((x) => x.platform === s.platform ? { ...x, backorder_placed: placed } : x) }) });
    const res = await fetch("/api/expired", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ list_date: date, domain, platform: s.platform, placed }) });
    if (!res.ok) { toast.error("Case non enregistrée"); load(date); }
    else toast.success(placed ? `Backorder posé : ${domain} sur ${PLATFORM[s.platform] ?? s.platform}` : "Case décochée");
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Domaines expirés</h1>
        <p className="text-muted-foreground text-sm">Liste du jour envoyée par Dana. Classement : trafic actuel, puis il y a 6 mois, puis pic. Trafic Google estimé par DataForSEO (indication, pas des visites réelles).</p>
      </div>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center gap-3 space-y-0">
          <CardTitle className="mr-auto text-base">{rows.length} domaines</CardTitle>
          <select className="h-9 rounded-md border bg-background px-2 text-sm" value={date} onChange={(e) => { setDate(e.target.value); load(e.target.value); }} aria-label="Jour de la liste">
            {(data?.dates ?? []).map((d) => <option key={d} value={d}>{new Date(d + "T12:00:00").toLocaleDateString("fr-FR", { weekday: "short", day: "2-digit", month: "2-digit" })}</option>)}
          </select>
          <div className="flex gap-1">
            {(["all", "medical", "psy", "sport"] as const).map((c) => (
              <button key={c} onClick={() => setCat(c)} className={`rounded-md border px-2.5 py-1 text-sm ${cat === c ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted"}`}>
                {c === "all" ? "Tous" : CAT[c]} <span className="opacity-70">{counts[c] ?? 0}</span>
              </button>
            ))}
          </div>
          <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={withTraffic} onChange={(e) => setWithTraffic(e.target.checked)} /> Avec trafic</label>
          <Input className="h-9 w-48" placeholder="Chercher…" value={q} onChange={(e) => setQ(e.target.value)} />
        </CardHeader>
        <CardContent>
          {error && <p className="text-sm text-red-600">{error}</p>}
          {!data && !error && <p className="text-sm text-muted-foreground">Chargement…</p>}
          {data && data.rows.length === 0 && <p className="text-sm text-muted-foreground">Aucune liste reçue pour l’instant.</p>}
          {rows.length > 0 && (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Domaine</TableHead>
                    <TableHead className="text-right">Actuel</TableHead>
                    <TableHead className="text-right">Il y a 6 mois</TableHead>
                    <TableHead className="text-right">Pic</TableHead>
                    <TableHead>Courbe (24 mois)</TableHead>
                    <TableHead>Disponible sur (cocher = backorder posé)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.domain}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <a href={`https://web.archive.org/web/2024*/${r.domain}`} target="_blank" rel="noreferrer" className="font-medium hover:underline">{r.domain}</a>
                          <Badge variant="outline" className="text-[10px]">{CAT[r.category ?? ""] ?? r.category}</Badge>
                        </div>
                        {r.label && <div className="text-xs text-muted-foreground">{r.label}</div>}
                      </TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">{r.traffic_checked_at ? nf(r.traffic_current) : <span className="text-xs text-muted-foreground">à relever</span>}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.traffic_checked_at ? nf(r.traffic_6m) : ""}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.traffic_checked_at ? <>{nf(r.traffic_peak)} <span className="text-xs text-muted-foreground">{monthFr(r.peak_month)}</span></> : ""}</TableCell>
                      <TableCell><TrafficCurve series={r.traffic_series} /></TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1.5">
                          {r.sources.map((s) => (
                            <label key={s.platform} className={`flex cursor-pointer items-center gap-1 rounded-md border px-2 py-0.5 text-xs ${s.backorder_placed ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-950" : ""}`} title={s.ends_at ? `Fin : ${s.ends_at}` : undefined}>
                              <input type="checkbox" checked={s.backorder_placed} onChange={() => toggle(r.domain, s)} />
                              <span className="font-medium">{PLATFORM[s.platform] ?? s.platform}</span>
                              <span className="text-muted-foreground">{s.kind === "auction" ? "enchère" : "backorder"}{s.price ? ` · ${s.price}` : ""}</span>
                            </label>
                          ))}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

// Domaines expirés du jour (Leo 22/10/2026) : liste poussée par Dana chaque matin,
// classée par trafic actuel, puis il y a 6 mois, puis pic. Catched / Nicsell : case cochée = ordre au robot du Mini
// (Nicsell / Dynadot : robot ; Catched : rappel Telegram, pas d API). Autres plateformes : note « posé à la main ».

interface Source { platform: string; kind: string; price: string | null; ends_at: string | null; ends_at_ts: string | null; backorder_placed: boolean; robot_requested: boolean; max_bid: number | null; robot_status: string | null; robot_note: string | null; listed?: boolean } // kind "extra" = plateforme cochée par Leo sans être listée par Dana
interface Row {
  domain: string; category?: string; label?: string | null; tld?: string | null;
  traffic_current?: number | null; traffic_6m?: number | null; traffic_peak?: number | null; peak_month?: string | null;
  traffic_series?: { m: string; v: number }[] | null; traffic_checked_at?: string | null; sources: Source[];
}
interface Resp { dates: string[]; date: string | null; rows: Row[] }

const nf = (n: number | null | undefined) => (n == null ? "—" : Math.round(n).toLocaleString("fr-FR"));
const CAT: Record<string, string> = { medical: "Médical", sport: "Sport", psy: "Psy" };
const PLATFORM: Record<string, string> = { catched: "Catched", nicsell: "Nicsell", webexpire: "WebExpire", bloomup: "Bloomup", dynadot: "Dynadot", domainorder: "DomainOrder", realtime: "Realtime" };
const monthFr = (m: string | null | undefined) => (m ? `${m.slice(5, 7)}/${m.slice(0, 4)}` : "");
const ROBOT = new Set(["catched", "nicsell", "dynadot"]);
// Prix max à saisir : Nicsell (€) et enchères Dynadot ($)
const needsMax = (s: { platform: string; kind: string }) => s.platform === "nicsell" || (s.platform === "dynadot" && s.kind === "auction");
// Plateformes cochables même si Dana ne les a pas listées (Leo 24/10) : Catched + Nicsell partout, WebExpire + Bloomup pour les .fr
const extraPlatforms = (domain: string) => ["catched", "nicsell", ...(domain.endsWith(".fr") ? ["webexpire", "bloomup"] : [])];
const blankSource = (platform: string): Source => ({ platform, kind: "extra", price: null, ends_at: null, ends_at_ts: null, backorder_placed: false, robot_requested: false, max_bid: null, robot_status: null, robot_note: null });
// Sources affichées : celles listées par Dana + les plateformes compatibles non listées (cochage manuel seulement)
const shownSources = (r: Row) => {
  const listed = r.sources.filter((s) => s.platform !== "regfree").map((s) => ({ ...s, listed: s.kind !== "extra" }));
  const have = new Set(listed.map((s) => s.platform));
  return [...listed, ...extraPlatforms(r.domain).filter((p) => !have.has(p)).map(blankSource)];
};
const REGFREE: Record<string, { text: string; cls: string }> = {
  pending: { text: "surveillé chaque minute", cls: "text-amber-600 dark:text-amber-400" },
  done: { text: "ACHETÉ (Openprovider)", cls: "font-semibold text-emerald-600 dark:text-emerald-400" },
  failed: { text: "échec achat", cls: "text-red-600 dark:text-red-400" },
};
const STATUS: Record<string, { text: string; cls: string }> = {
  pending: { text: "robot programmé", cls: "text-amber-600 dark:text-amber-400" },
  done: { text: "fait par le robot", cls: "text-emerald-600 dark:text-emerald-400" },
  won: { text: "gagné", cls: "text-emerald-600 dark:text-emerald-400" },
  lost: { text: "perdu", cls: "text-red-600 dark:text-red-400" },
  failed: { text: "échec robot", cls: "text-red-600 dark:text-red-400" },
};
// Fin la plus proche parmi les plateformes, en heure de Paris
const firstEnd = (r: Row) => r.sources.map((s) => s.ends_at_ts).filter((x): x is string => !!x).sort()[0] ?? null;
const fmtEnd = (iso: string) => new Date(iso).toLocaleString("fr-FR", { timeZone: "Europe/Paris", weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
function EndCell({ iso, now }: { iso: string | null; now: number }) {
  if (!iso) return <span className="text-xs text-muted-foreground">—</span>;
  const left = now ? new Date(iso).getTime() - now : Infinity;
  const cls = left < 0 ? "text-muted-foreground line-through" : left < 3 * 3600_000 ? "font-semibold text-red-600 dark:text-red-400" : "";
  return <span className={`whitespace-nowrap text-xs ${cls}`}>{fmtEnd(iso)}</span>;
}

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
  const [cat, setCat] = useState<"all" | "medical" | "sport">(() => {
    // Lien direct : /expires?cat=medical ou ?cat=sport
    if (typeof window === "undefined") return "all";
    const c = new URLSearchParams(window.location.search).get("cat");
    return c === "medical" || c === "sport" ? c : "all";
  });
  const [q, setQ] = useState("");
  const [withTraffic, setWithTraffic] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(0);

  const load = useCallback((d?: string) => {
    fetch(`/api/expired${d ? `?date=${d}` : ""}`, { cache: "no-store" })
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? String(res.status));
        setError(null);
        setData(json);
        setNow(Date.now());
        if (json.date) setDate(json.date);
      })
      .catch((e) => setError(`Chargement impossible (${e instanceof Error ? e.message : e})`));
  }, []);
  useEffect(() => {
    fetch("/api/expired", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((json: Resp) => { setData(json); setNow(Date.now()); if (json.date) setDate(json.date); })
      .catch((e) => setError(`Chargement impossible (${e})`));
  }, []);

  const rows = useMemo(() => {
    // Psy : Leo n'en veut pas (22/10), jamais affiché
    const list = (data?.rows ?? []).filter((r) => r.category !== "psy" &&
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
    const c: Record<string, number> = { all: 0, medical: 0, sport: 0 };
    for (const r of data?.rows ?? []) { if (r.category === "psy") continue; c.all++; c[r.category ?? "medical"] = (c[r.category ?? "medical"] ?? 0) + 1; }
    return c;
  }, [data]);

  const patch = (domain: string, platform: string, changes: Partial<Source>) =>
    setData((prev) => prev && { ...prev, rows: prev.rows.map((r) => r.domain !== domain ? r : { ...r, sources: r.sources.some((x) => x.platform === platform)
      ? r.sources.map((x) => x.platform === platform ? { ...x, ...changes } : x)
      : [...r.sources, { ...blankSource(platform), ...changes }] }) });
  const [bids, setBids] = useState<Record<string, string>>({});

  async function send(body: Record<string, unknown>) {
    const res = await fetch("/api/expired", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ list_date: date, ...body }) });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) { toast.error(json.error ?? "Non enregistré"); load(date); return false; }
    return true;
  }
  async function togglePlaced(domain: string, s: Source) {
    const placed = !s.backorder_placed;
    patch(domain, s.platform, { backorder_placed: placed });
    if (await send({ action: "placed", domain, platform: s.platform, placed })) toast.success(placed ? `Noté : posé sur ${PLATFORM[s.platform] ?? s.platform}` : "Case décochée");
  }
  async function toggleRobot(domain: string, s: Source) {
    const robot = !s.robot_requested;
    const key = `${domain}|${s.platform}`;
    const maxBid = needsMax(s) ? Number((bids[key] ?? s.max_bid ?? "").toString().replace(",", ".")) || null : null;
    if (robot && s.platform === "nicsell" && !(maxBid && maxBid >= 10)) { toast.error("Mets d’abord ton prix max (10 € minimum)"); return; }
    if (robot && needsMax(s) && !(maxBid && maxBid > 0)) { toast.error("Mets d’abord ton prix max en $"); return; }
    patch(domain, s.platform, { robot_requested: robot, max_bid: maxBid, robot_status: robot ? "pending" : "cancelled" });
    if (await send({ action: "robot", domain, platform: s.platform, kind: s.kind, robot, max_bid: maxBid }))
      toast.success(!robot ? "Robot annulé"
        : s.platform === "nicsell" ? `Robot : mise de ${maxBid} € max sur ${domain} 5 min avant la fin`
        : s.platform === "dynadot" ? (s.kind === "auction" ? `Robot : mise de ${maxBid} $ max sur ${domain} 5 min avant la fin` : `Robot : backorder Dynadot sur ${domain}`)
        : `Catched : rappel Telegram 1 h avant la fin pour ${domain}`);
  }

  async function toggleRegfree(domain: string, s: Source | undefined) {
    const watch = !s?.robot_requested;
    patch(domain, "regfree", { robot_requested: watch, robot_status: watch ? "pending" : "cancelled", robot_note: null });
    if (await send({ action: "regfree", domain, platform: "regfree", watch })) toast.success(watch ? `Regfree : ${domain} acheté chez Openprovider dès qu’il est libre` : "Surveillance regfree annulée");
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Domaines expirés</h1>
        <p className="text-muted-foreground text-sm">Liste du jour envoyée par Dana. Classement : trafic actuel, puis il y a 6 mois, puis pic. Trafic Google estimé par DataForSEO (indication, pas des visites réelles).</p>
      </div>

      {/* Garde-fou (24/10) : clé treg refusée 2 jours sans que personne ne le voie → on affiche le trou ici */}
      {(() => {
        const unchecked = (data?.rows ?? []).filter((r) => !r.traffic_checked_at).length;
        return unchecked > 0 && (
          <div className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
            <strong>Trafic non relevé pour {unchecked} domaine{unchecked > 1 ? "s" : ""}</strong> sur {data?.rows.length}. Le relevé DataForSEO (via treg) a échoué : clé treg ou solde à vérifier.
          </div>
        );
      })()}

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center gap-3 space-y-0">
          <CardTitle className="mr-auto text-base">{rows.length} domaines</CardTitle>
          <select className="h-9 rounded-md border bg-background px-2 text-sm" value={date} onChange={(e) => { setDate(e.target.value); load(e.target.value); }} aria-label="Jour de la liste">
            {(data?.dates ?? []).map((d) => <option key={d} value={d}>{new Date(d + "T12:00:00").toLocaleDateString("fr-FR", { weekday: "short", day: "2-digit", month: "2-digit" })}</option>)}
          </select>
          <div className="flex gap-1">
            {(["all", "medical", "sport"] as const).map((c) => (
              <button key={c} onClick={() => { setCat(c); window.history.replaceState(null, "", c === "all" ? "/expires" : `/expires?cat=${c}`); }} className={`rounded-md border px-2.5 py-1 text-sm ${cat === c ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted"}`}>
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
                    <TableHead>Fin (Paris)</TableHead>
                    <TableHead>Plateformes — 🤖 Nicsell / Dynadot = robot ; ⏰ Catched = rappel Telegram 1 h avant ; sinon posé à la main (coche autant de plateformes que tu veux)</TableHead>
                    <TableHead title="Si personne ne le capte et qu’il redevient libre : achat automatique chez Openprovider + message Telegram">Regfree</TableHead>
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
                      <TableCell><EndCell iso={firstEnd(r)} now={now} /></TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1.5">
                          {shownSources(r).map((s) => {
                            const key = `${r.domain}|${s.platform}`;
                            const st = s.robot_requested && s.robot_status ? STATUS[s.robot_status] : null;
                            const ok = s.backorder_placed || s.robot_status === "done" || s.robot_status === "won";
                            return (
                              <div key={s.platform} className={`flex flex-col gap-0.5 rounded-md border px-2 py-1 text-xs ${ok ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-950" : s.robot_requested ? "border-amber-500" : ""}`} title={[s.ends_at ? `Fin : ${s.ends_at}` : "", s.robot_note ?? ""].filter(Boolean).join("\n") || undefined}>
                                <div className="flex items-center gap-1">
                                  <span className="font-medium">{PLATFORM[s.platform] ?? s.platform}</span>
                                  <span className="text-muted-foreground">{!s.listed ? "non listé" : s.kind === "auction" ? "enchère" : "backorder"}{s.price ? ` · ${s.price}` : ""}</span>
                                </div>
                                {ROBOT.has(s.platform) && s.listed ? (
                                  <div className="flex items-center gap-1">
                                    {needsMax(s) && (
                                      <input type="number" min={s.platform === "nicsell" ? 10 : 1} step={1} placeholder={s.platform === "nicsell" ? "max €" : "max $"} aria-label={`Prix max ${PLATFORM[s.platform]} pour ${r.domain}`}
                                        className="h-6 w-16 rounded border bg-background px-1"
                                        value={bids[key] ?? (s.max_bid ?? "")}
                                        disabled={s.robot_requested}
                                        onChange={(e) => setBids((b) => ({ ...b, [key]: e.target.value }))} />
                                    )}
                                    <label className="flex cursor-pointer items-center gap-1">
                                      <input type="checkbox" checked={s.robot_requested} onChange={() => toggleRobot(r.domain, s)} />
                                      <span>{s.platform === "catched" ? "⏰ rappel" : `🤖 ${needsMax(s) ? "miser" : "backorder"}`}</span>
                                    </label>
                                  </div>
                                ) : (
                                  <label className="flex cursor-pointer items-center gap-1">
                                    <input type="checkbox" checked={s.backorder_placed} onChange={() => togglePlaced(r.domain, s)} />
                                    <span>posé à la main</span>
                                  </label>
                                )}
                                {st && <span className={st.cls}>{st.text}{s.robot_note ? ` — ${s.robot_note}` : ""}</span>}
                                {!st && s.backorder_placed && ROBOT.has(s.platform) && s.listed && <span className="text-emerald-600 dark:text-emerald-400">posé</span>}
                              </div>
                            );
                          })}
                        </div>
                      </TableCell>
                      <TableCell>
                        {(() => {
                          const rf = r.sources.find((s) => s.platform === "regfree");
                          const st = rf?.robot_requested && rf.robot_status ? REGFREE[rf.robot_status] : null;
                          return (
                            <div className="flex flex-col gap-0.5 text-xs" title={rf?.robot_note ?? undefined}>
                              <label className="flex cursor-pointer items-center gap-1 whitespace-nowrap">
                                <input type="checkbox" checked={!!rf?.robot_requested} disabled={rf?.robot_status === "done"} onChange={() => toggleRegfree(r.domain, rf)} />
                                <span>acheter si libre</span>
                              </label>
                              {st && <span className={st.cls}>{st.text}</span>}
                            </div>
                          );
                        })()}
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

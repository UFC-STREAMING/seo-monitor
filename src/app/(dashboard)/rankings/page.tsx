"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  TrendingUp,
  TrendingDown,
  Minus,
  RefreshCw,
  Globe,
  DollarSign,
  PiggyBank,
  Search,
  Link2,
  Rocket,
} from "lucide-react";
import { toast } from "sonner";

// ── Types ────────────────────────────────────────────────────────────────────

interface HistoryPoint {
  position: number | null;
  checked_at: string;
}

interface EmdRow {
  site_id: string;
  domain: string;
  is_active: boolean;
  serp_tracking_enabled: boolean;
  last_rebuild_at: string | null;
  last_rebuild_reason: string | null;
  last_rebuild_by: string | null;
  indexed_pages: number | null;
  cf_account: string | null;
  hosting: string | null;
  affiliate: {
    url: string | null;
    status: string | null;
    detail: string | null;
    offer: string | null;
    suggestion: string | null;
    checked_at: string | null;
  };
  purchased_at: string | null;
  keyword: string | null;
  keyword_id: string | null;
  country_iso: string | null;
  position: number | null;
  previous_position: number | null;
  last_checked_at: string | null;
  history: HistoryPoint[];
  finance: {
    purchase_price: number;
    purchase_date: string | null;
    renewal_price: number;
    renewal_date: string | null;
  } | null;
  revenue_usd: number;
  conversions: number;
  roi_usd: number;
}

interface RankingsResponse {
  emd: EmdRow[];
  to_classify: Array<{ site_id: string; domain: string; cf_account: string | null }>;
  totals: {
    spent_usd: number;
    revenue_usd: number;
    roi_usd: number;
    emd_count: number;
    to_classify_count: number;
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function isoFlag(iso: string | null): string {
  if (!iso || iso.length !== 2) return "—";
  return iso
    .toUpperCase()
    .split("")
    .map((c) => String.fromCodePoint(0x1f1e6 + c.charCodeAt(0) - 65))
    .join("");
}

function fmtUsd(n: number): string {
  return n.toLocaleString("fr-FR", { maximumFractionDigits: 0 }) + " $";
}

function PositionBadge({ position }: { position: number | null }) {
  if (position === null) {
    return <Badge variant="outline" className="text-red-500 border-red-500/40">&gt;100</Badge>;
  }
  if (position <= 3)
    return <Badge className="bg-green-600 hover:bg-green-600 text-white">#{position}</Badge>;
  if (position <= 10)
    return <Badge className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/15">#{position}</Badge>;
  if (position <= 30)
    return <Badge className="bg-yellow-500/15 text-yellow-600 dark:text-yellow-400 hover:bg-yellow-500/15">#{position}</Badge>;
  return <Badge variant="secondary">#{position}</Badge>;
}

function Delta({ current, previous }: { current: number | null; previous: number | null }) {
  if (previous === null || (current === null && previous === null)) {
    return <span className="text-muted-foreground">—</span>;
  }
  // Position : plus petit = mieux. Sorti du top 100 = grosse chute.
  const cur = current ?? 101;
  const prev = previous ?? 101;
  const diff = prev - cur; // positif = progression
  if (diff === 0) return <Minus className="h-4 w-4 text-muted-foreground" />;
  if (diff > 0)
    return (
      <span className="inline-flex items-center gap-0.5 text-green-600 dark:text-green-400 text-sm font-medium">
        <TrendingUp className="h-4 w-4" />+{diff}
      </span>
    );
  return (
    <span className="inline-flex items-center gap-0.5 text-red-600 dark:text-red-400 text-sm font-medium">
      <TrendingDown className="h-4 w-4" />{diff}
    </span>
  );
}

// Sparkline SVG mono-série : axe inversé (position 1 en haut), 2px,
// point sur la dernière valeur, gaps sur les null (hors top 100).
function Sparkline({ history }: { history: HistoryPoint[] }) {
  const points = history.slice(-12);
  if (points.length < 2) return <span className="text-muted-foreground text-xs">—</span>;

  const W = 96;
  const H = 28;
  const PAD = 3;
  const values = points.map((p) => p.position);
  const known = values.filter((v): v is number => v !== null);
  if (known.length === 0) return <span className="text-muted-foreground text-xs">&gt;100</span>;

  const min = Math.min(...known);
  const max = Math.max(...known);
  const span = Math.max(max - min, 1);
  const x = (i: number) => PAD + (i * (W - 2 * PAD)) / (points.length - 1);
  // position 1 (meilleure) en haut
  const y = (v: number) => PAD + ((v - min) / span) * (H - 2 * PAD);

  // Segments continus entre valeurs connues (gap sur null)
  const segments: string[] = [];
  let seg: string[] = [];
  values.forEach((v, i) => {
    if (v === null) {
      if (seg.length > 1) segments.push(seg.join(" "));
      seg = [];
    } else {
      seg.push(`${x(i)},${y(v)}`);
    }
  });
  if (seg.length > 1) segments.push(seg.join(" "));

  const lastIdx = values.length - 1;
  const lastVal = values[lastIdx];
  const title = points
    .map((p) => `${new Date(p.checked_at).toLocaleDateString("fr-FR")} : ${p.position ? "#" + p.position : ">100"}`)
    .join("\n");

  return (
    <svg width={W} height={H} className="text-primary" role="img" aria-label="Historique des positions">
      <title>{title}</title>
      {segments.map((pts, i) => (
        <polyline
          key={i}
          points={pts}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
      {lastVal !== null && (
        <circle cx={x(lastIdx)} cy={y(lastVal)} r="2.5" fill="currentColor" />
      )}
    </svg>
  );
}

// ── EMD à lancer ─────────────────────────────────────────────────────────────

interface EmdBoardRow {
  brand: string;
  country: string;
  countryIso: string;
  tld: string;
  sales: {
    revenueUsd: number;
    conversions: number;
    network: string;
    offer: string;
    offerStatus: string;
    sources: { host: string; revenueUsd: number }[];
  } | null;
  impressions: {
    impressions: number;
    clicks: number;
    topQuery: string;
    sources: { host: string; impressions: number }[];
  } | null;
  ownEmd: string | null;
  serpBrandDomains: string[] | null;
  serpError?: string;
}

function SerpCell({ row }: { row: EmdBoardRow }) {
  if (row.ownEmd) return <span className="text-muted-foreground">On a : {row.ownEmd}</span>;
  if (row.serpBrandDomains === null) {
    return <span className="text-muted-foreground">{row.serpError ?? "SERP non vérifiée"}</span>;
  }
  if (row.serpBrandDomains.length === 0) {
    return (
      <Badge className="bg-emerald-600 hover:bg-emerald-600 text-white text-xs">
        Place libre {row.tld}
      </Badge>
    );
  }
  return (
    <span className="text-amber-700 dark:text-amber-400" title={row.serpBrandDomains.join("\n")}>
      EMD en top 10 : {row.serpBrandDomains.slice(0, 2).join(", ")}
      {row.serpBrandDomains.length > 2 && ` +${row.serpBrandDomains.length - 2}`}
    </span>
  );
}

function EmdOpportunitiesCard() {
  const [rows, setRows] = useState<EmdBoardRow[] | null>(null);
  const [sortBy, setSortBy] = useState<"sales" | "impressions">("sales");
  const [freeOnly, setFreeOnly] = useState(false);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    fetch("/api/emd-opportunities")
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((j) => setRows(j.rows))
      .catch(() => setRows([]));
  }, []);

  const sorted = useMemo(() => {
    const list = (rows ?? []).filter(
      (r) => (sortBy === "sales" ? r.sales : r.impressions) &&
        (!freeOnly || (!r.ownEmd && r.serpBrandDomains?.length === 0))
    );
    return list.sort((a, b) =>
      sortBy === "sales"
        ? (b.sales?.revenueUsd ?? 0) - (a.sales?.revenueUsd ?? 0)
        : (b.impressions?.impressions ?? 0) - (a.impressions?.impressions ?? 0)
    );
  }, [rows, sortBy, freeOnly]);

  if (rows === null) {
    return (
      <Card>
        <CardContent className="py-4 text-sm text-muted-foreground">
          Chargement des ventes, impressions et SERP…
        </CardContent>
      </Card>
    );
  }
  if (rows.length === 0) return null;

  const visible = showAll ? sorted : sorted.slice(0, 15);

  return (
    <Card className="border-emerald-200 dark:border-emerald-900">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Rocket className="h-4 w-4" /> EMD à lancer
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Marque × pays des sites expirés : ventes Everflow (90 j), impressions Search Console des
          fiches produit (28 j), et EMD déjà présents dans le top 10 Google du pays (mis à jour 1×/jour).
        </p>
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Button size="sm" variant={sortBy === "sales" ? "default" : "outline"} onClick={() => setSortBy("sales")}>
            Par ventes
          </Button>
          <Button size="sm" variant={sortBy === "impressions" ? "default" : "outline"} onClick={() => setSortBy("impressions")}>
            Par impressions
          </Button>
          <Button size="sm" variant={freeOnly ? "default" : "outline"} onClick={() => setFreeOnly((v) => !v)}>
            Places libres seulement
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-1.5">
        <div className="hidden px-3 text-xs text-muted-foreground md:grid md:grid-cols-[11rem_7rem_7rem_8rem_1fr_15rem]">
          <span>Marque</span>
          <span>Pays</span>
          <span>Ventes 90 j</span>
          <span>Impressions 28 j</span>
          <span>Sites expirés</span>
          <span>Top 10 Google</span>
        </div>
        {visible.map((r) => {
          const hosts = [
            ...new Set([
              ...(r.sales?.sources.map((s) => s.host) ?? []),
              ...(r.impressions?.sources.map((s) => s.host) ?? []),
            ]),
          ];
          return (
            <div
              key={`${r.brand}|${r.countryIso}`}
              className="grid grid-cols-1 gap-1 rounded-md border px-3 py-2 text-sm md:grid-cols-[11rem_7rem_7rem_8rem_1fr_15rem] md:items-center"
            >
              <span className="font-medium truncate" title={r.sales?.offer ?? r.impressions?.topQuery}>
                {r.brand}
                {r.sales && r.sales.offerStatus !== "active" && (
                  <Badge className="ml-2 bg-red-600 hover:bg-red-600 text-white text-xs">{r.sales.offerStatus}</Badge>
                )}
              </span>
              <span>{r.country}</span>
              <span className={r.sales ? "font-medium" : "text-muted-foreground"}>
                {r.sales ? `${r.sales.revenueUsd.toLocaleString("fr-FR")} $` : "—"}
                {r.sales && (
                  <span className="block text-xs font-normal text-muted-foreground">
                    {r.sales.conversions} ventes · {r.sales.network}
                  </span>
                )}
              </span>
              <span className={r.impressions ? "font-medium" : "text-muted-foreground"}>
                {r.impressions ? r.impressions.impressions.toLocaleString("fr-FR") : "—"}
                {r.impressions && (
                  <span className="block truncate text-xs font-normal text-muted-foreground" title={r.impressions.topQuery}>
                    {r.impressions.clicks} clics · « {r.impressions.topQuery} »
                  </span>
                )}
              </span>
              <span className="text-muted-foreground truncate" title={hosts.join("\n")}>
                {hosts.slice(0, 3).join(", ")}
                {hosts.length > 3 && ` +${hosts.length - 3}`}
              </span>
              <span className="text-xs">
                <SerpCell row={r} />
              </span>
            </div>
          );
        })}
        {sorted.length > 15 && (
          <Button variant="ghost" size="sm" onClick={() => setShowAll((v) => !v)}>
            {showAll ? "Réduire" : `Voir les ${sorted.length}`}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function RankingsPage() {
  const [data, setData] = useState<RankingsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState<string | null>(null); // 'all' | site_id
  const [classifyFilter, setClassifyFilter] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/rankings");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
    } catch {
      toast.error("Impossible de charger les rankings");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function postAction(body: Record<string, unknown>, okMsg: string) {
    const res = await fetch("/api/rankings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (!res.ok) {
      toast.error(json.error ?? "Erreur");
      return false;
    }
    toast.success(okMsg);
    await load();
    return true;
  }

  async function runCheck(siteId?: string) {
    setChecking(siteId ?? "all");
    try {
      const res = await fetch("/api/positions/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(siteId ? { site_id: siteId } : {}),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Erreur");
      if (json.balance_error) {
        toast.error("Crédit Semscraper épuisé — check incomplet");
      } else {
        toast.success(
          `Check terminé : ${json.found}/${json.checked} dans le top 100 (${json.total_cost_usd} €)`
        );
      }
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur check");
    } finally {
      setChecking(null);
    }
  }

  async function runAffiliateCheck() {
    setChecking("affiliate");
    try {
      const res = await fetch("/api/affiliate/check", { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Erreur");
      toast.success(`Liens vérifiés : ${json.ok} valides, ${json.pending} à vérifier, ${json.ko} KO`);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur vérification liens");
    } finally {
      setChecking(null);
    }
  }

  const affiliateIssues = useMemo(() => {
    if (!data) return { toFix: [] as Array<{ row: EmdRow; action: string }>, offline: [] as string[] };
    const active = data.emd.filter((r) => r.is_active);
    const offline = active
      .filter((r) => r.affiliate.detail === "Site injoignable")
      .map((r) => r.domain);
    const toFix = active
      .filter(
        (r) =>
          (r.affiliate.status === "ko" || r.affiliate.status === "pending") &&
          r.affiliate.detail !== "Site injoignable"
      )
      .map((row) => ({ row, action: affiliateAction(row.affiliate.detail ?? "") }))
      .sort((a, b) => (a.row.affiliate.status === "ko" ? 0 : 1) - (b.row.affiliate.status === "ko" ? 0 : 1));
    return { toFix, offline };
  }, [data]);

  const filteredToClassify = useMemo(() => {
    if (!data) return [];
    const f = classifyFilter.toLowerCase();
    return data.to_classify.filter((s) => s.domain.includes(f));
  }, [data, classifyFilter]);

  if (loading || !data) {
    return (
      <div className="flex h-64 items-center justify-center text-muted-foreground">
        Chargement…
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Rankings EMD</h1>
          <p className="text-sm text-muted-foreground">
            Suivi hebdo des positions (Semscraper, lundi 7h) — tri par date d’achat — mot-clé et coûts éditables inline
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => runAffiliateCheck()} disabled={checking !== null}>
            <Link2 className={`mr-2 h-4 w-4 ${checking === "affiliate" ? "animate-pulse" : ""}`} />
            Vérifier les liens
          </Button>
          <Button onClick={() => runCheck()} disabled={checking !== null}>
            <RefreshCw className={`mr-2 h-4 w-4 ${checking === "all" ? "animate-spin" : ""}`} />
            Check maintenant
          </Button>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Globe className="h-4 w-4" /> Domaines EMD
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{data.totals.emd_count}</div>
            <p className="text-xs text-muted-foreground">
              {data.emd.filter((r) => r.position !== null).length} dans le top 100
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <DollarSign className="h-4 w-4" /> Dépensé (domaines)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{fmtUsd(data.totals.spent_usd)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <PiggyBank className="h-4 w-4" /> Revenus
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{fmtUsd(data.totals.revenue_usd)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">ROI</CardTitle>
          </CardHeader>
          <CardContent>
            <div
              className={`text-2xl font-bold ${
                data.totals.roi_usd >= 0
                  ? "text-green-600 dark:text-green-400"
                  : "text-red-600 dark:text-red-400"
              }`}
            >
              {data.totals.roi_usd >= 0 ? "+" : ""}
              {fmtUsd(data.totals.roi_usd)}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Liens affiliés à régler */}
      {(affiliateIssues.toFix.length > 0 || affiliateIssues.offline.length > 0) && (
        <Card className="border-red-200 dark:border-red-900">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Link2 className="h-4 w-4" /> Liens affiliés à régler ({affiliateIssues.toFix.length})
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              Vérifiés chaque jour à 6h40 UTC sans jamais ouvrir le tracker (bouton du CTA → offre
              Everflow → approbation → sub1).
            </p>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {affiliateIssues.toFix.map(({ row, action }) => (
              <div
                key={row.site_id}
                className="grid grid-cols-1 gap-1 rounded-md border px-3 py-2 text-sm md:grid-cols-[14rem_6rem_1fr_1fr] md:items-center"
              >
                <span className="font-medium truncate">{row.domain}</span>
                <span>
                  {row.affiliate.status === "ko" ? (
                    <Badge className="bg-red-600 hover:bg-red-600 text-white text-xs">KO</Badge>
                  ) : (
                    <Badge className="bg-amber-500 hover:bg-amber-500 text-white text-xs">À vérifier</Badge>
                  )}
                </span>
                <span className="text-muted-foreground" title={row.affiliate.offer ?? undefined}>
                  {row.affiliate.detail}
                </span>
                <span className="font-medium">
                  → {action}
                  {row.affiliate.suggestion && (
                    <span className="mt-0.5 block text-xs font-normal text-emerald-700 dark:text-emerald-400">
                      ✓ Offre approuvée dispo : {row.affiliate.suggestion}
                    </span>
                  )}
                </span>
              </div>
            ))}
            {affiliateIssues.offline.length > 0 && (
              <p className="pt-2 text-xs text-muted-foreground">
                Pas encore en ligne ({affiliateIssues.offline.length}) : {affiliateIssues.offline.join(", ")}
              </p>
            )}
          </CardContent>
        </Card>
      )}

      <EmdOpportunitiesCard />

      {/* Table EMD */}
      <Card>
        <CardContent className="pt-6">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-14">Suivi</TableHead>
                  <TableHead>Domaine</TableHead>
                  <TableHead className="w-24">Achat le</TableHead>
                  <TableHead className="w-28">Hébergeur</TableHead>
                  <TableHead className="min-w-64">Lien affilié</TableHead>
                  <TableHead>Mot-clé principal</TableHead>
                  <TableHead className="w-16">Pays</TableHead>
                  <TableHead className="w-20">Position</TableHead>
                  <TableHead className="w-16">Δ</TableHead>
                  <TableHead className="w-28">Historique</TableHead>
                  <TableHead className="w-20">Indexé</TableHead>
                  <TableHead className="w-28">Refonte</TableHead>
                  <TableHead className="w-24">Achat $</TableHead>
                  <TableHead className="w-24">Renouv. $</TableHead>
                  <TableHead className="w-24 text-right">Revenus</TableHead>
                  <TableHead className="w-24 text-right">ROI</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.emd.map((row) => (
                  <EmdTableRow
                    key={row.site_id}
                    row={row}
                    checking={checking === row.site_id}
                    onCheck={() => runCheck(row.site_id)}
                    onToggleActive={(next) =>
                      postAction(
                        { action: "toggle_active", site_id: row.site_id, is_active: next },
                        next
                          ? `Suivi réactivé pour ${row.domain}`
                          : `${row.domain} retiré du suivi automatique`
                      )
                    }
                    onSaveKeyword={(keyword, iso) =>
                      postAction(
                        { action: "set_keyword", site_id: row.site_id, keyword, country_iso: iso },
                        `Mot-clé de ${row.domain} enregistré`
                      )
                    }
                    onSaveFinance={(field, value) =>
                      postAction(
                        { action: "set_finance", site_id: row.site_id, [field]: value },
                        `Coûts de ${row.domain} enregistrés`
                      )
                    }
                  />
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* À classer */}
      {data.to_classify.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">
                Domaines à classer ({data.totals.to_classify_count})
              </CardTitle>
              <div className="relative w-64">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Filtrer…"
                  className="pl-8 h-9"
                  value={classifyFilter}
                  onChange={(e) => setClassifyFilter(e.target.value)}
                />
              </div>
            </div>
            <p className="text-sm text-muted-foreground">
              Importés automatiquement depuis Cloudflare — inertes (aucun coût) tant que non classés.
              Classer en EMD puis saisir le mot-clé pour activer le suivi.
            </p>
          </CardHeader>
          <CardContent>
            <div className="grid gap-1 md:grid-cols-2">
              {filteredToClassify.slice(0, 60).map((s) => (
                <div
                  key={s.site_id}
                  className="flex items-center justify-between rounded-md border px-3 py-1.5"
                >
                  <div className="min-w-0">
                    <span className="text-sm font-medium truncate">{s.domain}</span>
                    {s.cf_account && (
                      <span className="ml-2 text-xs text-muted-foreground">{s.cf_account}</span>
                    )}
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 px-2 text-xs"
                      onClick={() =>
                        postAction(
                          { action: "classify", site_id: s.site_id, category: "emd" },
                          `${s.domain} classé EMD — saisis son mot-clé`
                        )
                      }
                    >
                      EMD
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-xs"
                      onClick={() =>
                        postAction(
                          { action: "classify", site_id: s.site_id, category: "shop" },
                          `${s.domain} classé shop (GSC uniquement)`
                        )
                      }
                    >
                      Shop
                    </Button>
                  </div>
                </div>
              ))}
            </div>
            {filteredToClassify.length > 60 && (
              <p className="mt-2 text-xs text-muted-foreground">
                … et {filteredToClassify.length - 60} autres (utilise le filtre)
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ── Ligne du tableau EMD (édition inline) ────────────────────────────────────

function EmdTableRow({
  row,
  checking,
  onCheck,
  onSaveKeyword,
  onSaveFinance,
  onToggleActive,
}: {
  row: EmdRow;
  checking: boolean;
  onCheck: () => void;
  onSaveKeyword: (keyword: string, iso: string) => Promise<boolean>;
  onSaveFinance: (field: "purchase_price" | "renewal_price", value: number) => Promise<boolean>;
  onToggleActive: (next: boolean) => void;
}) {
  const [keyword, setKeyword] = useState(row.keyword ?? "");
  const [iso, setIso] = useState(row.country_iso ?? "");

  function saveKeywordIfChanged() {
    const kw = keyword.trim();
    const country = iso.trim().toUpperCase();
    if (!kw) return;
    if (kw === (row.keyword ?? "") && country === (row.country_iso ?? "")) return;
    onSaveKeyword(kw, country);
  }

  function blurOnEnter(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
  }

  return (
    <TableRow className={row.is_active ? undefined : "opacity-50"}>
      <TableCell>
        <button
          type="button"
          onClick={() => onToggleActive(!row.is_active)}
          title={
            row.is_active
              ? "Suivi actif — cliquer pour retirer ce domaine du traitement automatique"
              : "Suivi désactivé — ce domaine est ignoré par l\u2019agent quotidien"
          }
          className={
            "flex h-5 w-9 items-center rounded-full transition-colors " +
            (row.is_active ? "bg-emerald-500" : "bg-muted-foreground/30")
          }
        >
          <span
            className={
              "block h-4 w-4 rounded-full bg-white shadow transition-transform " +
              (row.is_active ? "translate-x-4" : "translate-x-0.5")
            }
          />
        </button>
      </TableCell>
      <TableCell>
        <a
          href={`https://${row.domain}`}
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium hover:underline"
        >
          {row.domain}
        </a>
        {row.keyword && !row.serp_tracking_enabled && (
          <Badge variant="outline" className="ml-2 text-xs">pause</Badge>
        )}
      </TableCell>
      <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
        {row.purchased_at
          ? new Date(row.purchased_at).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "2-digit" })
          : "—"}
      </TableCell>
      <TableCell>
        {row.hosting === "hostinger" ? (
          <Badge className="bg-violet-600 hover:bg-violet-600 text-white text-xs">Hostinger</Badge>
        ) : row.hosting === "cloudflare" ? (
          <Badge className="bg-orange-500 hover:bg-orange-500 text-white text-xs">Cloudflare</Badge>
        ) : (
          <Badge variant="outline" className="text-xs">{row.hosting ?? "?"}</Badge>
        )}
      </TableCell>
      <TableCell className="max-w-72">
        {/* Lien affiché en TEXTE, jamais cliquable : ouvrir un tracker = clic fantôme facturé */}
        <div className="flex items-center gap-2">
          {row.affiliate.status === "ok" ? (
            <Badge className="bg-emerald-600 hover:bg-emerald-600 text-white text-xs">Valide</Badge>
          ) : row.affiliate.status === "pending" ? (
            <Badge className="bg-amber-500 hover:bg-amber-500 text-white text-xs">À vérifier</Badge>
          ) : row.affiliate.status === "ko" ? (
            <Badge className="bg-red-600 hover:bg-red-600 text-white text-xs">KO</Badge>
          ) : (
            <Badge variant="outline" className="text-xs">jamais</Badge>
          )}
          {row.affiliate.url && (
            <button
              type="button"
              title={`Copier : ${row.affiliate.url}`}
              className="truncate font-mono text-xs text-muted-foreground hover:text-foreground"
              onClick={() => navigator.clipboard.writeText(row.affiliate.url ?? "")}
            >
              {row.affiliate.url.replace(/^https?:\/\/(www\.)?/, "")}
            </button>
          )}
        </div>
        {row.affiliate.detail && (
          <div className="mt-0.5 text-xs text-muted-foreground" title={row.affiliate.offer ?? undefined}>
            {row.affiliate.detail}
          </div>
        )}
      </TableCell>
      <TableCell>
        <Input
          value={keyword}
          placeholder="mot-clé…"
          className="h-8 min-w-40"
          onChange={(e) => setKeyword(e.target.value)}
          onBlur={saveKeywordIfChanged}
          onKeyDown={blurOnEnter}
        />
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-1">
          <span>{isoFlag(row.country_iso)}</span>
          <Input
            value={iso}
            placeholder="FR"
            maxLength={2}
            className="h-8 w-12 px-1 text-center uppercase"
            onChange={(e) => setIso(e.target.value)}
            onBlur={saveKeywordIfChanged}
            onKeyDown={blurOnEnter}
          />
        </div>
      </TableCell>
      <TableCell>
        {row.last_checked_at ? (
          <PositionBadge position={row.position} />
        ) : (
          <span className="text-xs text-muted-foreground">jamais</span>
        )}
      </TableCell>
      <TableCell>
        <Delta current={row.position} previous={row.previous_position} />
      </TableCell>
      <TableCell>
        <Sparkline history={row.history} />
      </TableCell>
      <TableCell className="text-center tabular-nums">
        {row.indexed_pages === null ? (
          <span className="text-muted-foreground">—</span>
        ) : row.indexed_pages === 0 ? (
          <span className="text-destructive font-medium" title="Aucune page dans l'index Google : à soumettre à l'indexation">
            0
          </span>
        ) : (
          <span title="Pages présentes dans l'index Google">{row.indexed_pages}</span>
        )}
      </TableCell>
      <TableCell className="text-xs">
        {row.last_rebuild_at ? (
          <span title={row.last_rebuild_reason ?? undefined}>
            {new Date(row.last_rebuild_at).toLocaleDateString("fr-FR", {
              day: "2-digit",
              month: "2-digit",
            })}
            {row.last_rebuild_by ? (
              <span className="block text-muted-foreground">{row.last_rebuild_by}</span>
            ) : null}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </TableCell>
      <FinanceCell
        initial={row.finance?.purchase_price ?? 0}
        onSave={(v) => onSaveFinance("purchase_price", v)}
      />
      <FinanceCell
        initial={row.finance?.renewal_price ?? 0}
        onSave={(v) => onSaveFinance("renewal_price", v)}
      />
      <TableCell className="text-right tabular-nums">
        {row.revenue_usd > 0 ? fmtUsd(row.revenue_usd) : <span className="text-muted-foreground">0 $</span>}
      </TableCell>
      <TableCell
        className={`text-right tabular-nums font-medium ${
          row.roi_usd > 0
            ? "text-green-600 dark:text-green-400"
            : row.roi_usd < 0
              ? "text-red-600 dark:text-red-400"
              : "text-muted-foreground"
        }`}
      >
        {row.roi_usd > 0 ? "+" : ""}
        {fmtUsd(row.roi_usd)}
      </TableCell>
      <TableCell>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 w-7 p-0"
          title="Check ce domaine maintenant"
          onClick={onCheck}
          disabled={checking}
        >
          <RefreshCw className={`h-3.5 w-3.5 ${checking ? "animate-spin" : ""}`} />
        </Button>
      </TableCell>
    </TableRow>
  );
}

function FinanceCell({
  initial,
  onSave,
}: {
  initial: number;
  onSave: (value: number) => Promise<boolean>;
}) {
  const [value, setValue] = useState(initial ? String(initial) : "");

  return (
    <TableCell>
      <Input
        type="number"
        min="0"
        step="0.01"
        value={value}
        placeholder="0"
        className="h-8 w-20 text-right"
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => {
          const n = Number(value) || 0;
          if (n !== initial) onSave(n);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
      />
    </TableCell>
  );
}

/** Action concrète à mener selon le diagnostic du lien affilié. */
function affiliateAction(detail: string): string {
  const net = detail.match(/chez (\w+)/)?.[1];
  if (/Pas approuvé/.test(detail)) return `Demander l’approbation chez ${net ?? "le réseau"}`;
  if (/Offre (paused|inactive|expired)/i.test(detail)) return "Offre coupée : trouver une offre de remplacement";
  if (/503/.test(detail)) return "Faire approuver l’offre, puis brancher le tracker";
  if (/Aucun bouton/.test(detail)) return "Aucune offre branchée : trouver une offre et brancher les boutons";
  if (/404|ne redirige pas|boucle|invalide|injoignable|répond/.test(detail)) return "Lien cassé : fournir le lien affilié à rebrancher";
  if (/sub1/.test(detail)) return "Corriger le sub1 (sinon revenus non attribués)";
  if (/plus dans ton catalogue/.test(detail)) return "Vérifier que l’offre existe encore chez le réseau";
  if (/Lien direct/.test(detail)) return "Vérifier l’approbation à la main (hors API)";
  return "À examiner";
}

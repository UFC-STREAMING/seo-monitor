"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  RefreshCw,
  Settings2,
  Zap,
  Globe,
  MousePointerClick,
  Eye,
  Target,
  TrendingDown,
  TrendingUp,
  Lightbulb,
  Flame,
  Trophy,
  Skull,
  FileX,
  AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

// ── Types ────────────────────────────────────────────────────────────────────

interface GscPropertyWithStats {
  id: string;
  site_url: string;
  permission_level: string | null;
  site_id: string | null;
  is_active: boolean;
  last_synced_at: string | null;
  sites: { domain: string; niche: string; site_type: string } | null;
  stats_7d: { clicks: number; impressions: number };
}

interface TopQuery {
  query: string;
  country: string;
  total_clicks: number;
  total_impressions: number;
  avg_position: number;
  avg_ctr: number;
  top_page: string | null;
  property_site_url: string;
}

interface TrafficDrop {
  page: string;
  clicks_before: number;
  clicks_after: number;
  pct_change: number;
  property_site_url: string;
  top_queries: Array<{ query: string; clicks: number }>;
}

interface Opportunity {
  query: string;
  country: string;
  impressions: number;
  clicks: number;
  avg_position: number;
  avg_ctr: number;
  top_page: string | null;
  property_site_url: string;
}

interface PowerScoreItem {
  query: string;
  country: string;
  impressions: number;
  clicks: number;
  avg_position: number;
  power_score: number;
  estimated_traffic_top3: number;
  property_site_url: string;
}

interface SiteRanking {
  site_id: string;
  domain: string;
  location_code: number | null;
  clicks: number;
  impressions: number;
  avg_ctr: number;
  avg_position: number;
  clicks_trend_pct: number;
  impressions_trend_pct: number;
  prev_clicks: number;
  unique_queries: number;
  status: "star" | "growing" | "stable" | "declining" | "dead";
}

interface SitesRankingResponse {
  sites: SiteRanking[];
  totals: { clicks: number; impressions: number; active_sites: number; dead_sites: number };
}

interface TimeseriesPoint {
  date: string;
  clicks: number;
  impressions: number;
}

interface NotIndexedSite {
  domain: string;
  site_id: string;
  sitemap_urls: number;
  indexed_urls: number;
  not_indexed_urls: string[];
  indexation_rate: number;
}

interface NotIndexedResponse {
  sites: NotIndexedSite[];
  total_sitemap: number;
  total_not_indexed: number;
  total_indexed: number;
}

interface AutoRules {
  min_clicks_keyword: number;
  min_clicks_page_daily: number;
  auto_add_enabled: boolean;
}

interface UserSite {
  id: string;
  domain: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function extractDomain(siteUrl: string): string {
  if (siteUrl.startsWith("sc-domain:")) {
    return siteUrl.replace("sc-domain:", "");
  }
  try {
    return new URL(siteUrl).hostname;
  } catch {
    return siteUrl;
  }
}

const countryFlags: Record<string, string> = {
  BRA: "BR", ITA: "IT", FRA: "FR", DEU: "DE", ESP: "ES", PRT: "PT",
  USA: "US", GBR: "GB", CAN: "CA", AUS: "AU", JPN: "JP", IND: "IN",
  MEX: "MX", ARG: "AR", CHL: "CL", COL: "CO", PER: "PE", ROU: "RO",
  NLD: "NL", BEL: "BE", CHE: "CH", AUT: "AT", POL: "PL", CZE: "CZ",
  HUN: "HU", BGR: "BG", HRV: "HR", SRB: "RS", SVK: "SK", SVN: "SI",
  NOR: "NO", SWE: "SE", DNK: "DK", FIN: "FI", TUR: "TR", UKR: "UA",
  IDN: "ID", THA: "TH", VNM: "VN", PHL: "PH", MYS: "MY", SGP: "SG",
};

function getFlag(alpha3: string): string {
  const alpha2 = countryFlags[alpha3.toUpperCase()];
  if (!alpha2) return alpha3;
  return alpha2
    .toUpperCase()
    .split("")
    .map((c) => String.fromCodePoint(0x1f1e6 + c.charCodeAt(0) - 65))
    .join("");
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "short" });
}

// ── Component ────────────────────────────────────────────────────────────────

export default function GscPage() {
  const [properties, setProperties] = useState<GscPropertyWithStats[]>([]);
  const [topQueries, setTopQueries] = useState<TopQuery[]>([]);
  const [trafficDrops, setTrafficDrops] = useState<TrafficDrop[]>([]);
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [powerScores, setPowerScores] = useState<PowerScoreItem[]>([]);
  const [sitesRanking, setSitesRanking] = useState<SiteRanking[]>([]);
  const [sitesTotals, setSitesTotals] = useState<SitesRankingResponse["totals"] | null>(null);
  const [timeseries, setTimeseries] = useState<TimeseriesPoint[]>([]);
  const [notIndexed, setNotIndexed] = useState<NotIndexedResponse | null>(null);
  const [notIndexedLoading, setNotIndexedLoading] = useState(false);
  const [rules, setRules] = useState<AutoRules>({
    min_clicks_keyword: 5,
    min_clicks_page_daily: 5,
    auto_add_enabled: true,
  });
  const [userSites, setUserSites] = useState<UserSite[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncingProperties, setSyncingProperties] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [filterCountry, setFilterCountry] = useState<string>("all");
  const [days, setDays] = useState<string>("4");
  const [dropDays, setDropDays] = useState<string>("7");
  const [activeTab, setActiveTab] = useState("overview");

  const fetchData = useCallback(async () => {
    const supabase = createClient();

    const [propsRes, rulesRes, sitesRes, rankingRes, timeseriesRes] = await Promise.all([
      fetch(`/api/gsc/properties?days=${days}`),
      fetch("/api/gsc/rules"),
      supabase.from("sites").select("id, domain").order("domain"),
      fetch(`/api/gsc/sites-ranking?days=${days}`),
      fetch(`/api/gsc/timeseries?days=${Math.max(parseInt(days), 14)}`),
    ]);

    if (propsRes.ok) {
      const data = await propsRes.json();
      setProperties(Array.isArray(data) ? data : []);
    }

    if (rulesRes.ok) {
      setRules(await rulesRes.json());
    }

    if (rankingRes.ok) {
      const data: SitesRankingResponse = await rankingRes.json();
      setSitesRanking(data.sites ?? []);
      setSitesTotals(data.totals ?? null);
    }

    if (timeseriesRes.ok) {
      const data = await timeseriesRes.json();
      setTimeseries(data.series ?? []);
    }

    setUserSites(sitesRes.data ?? []);

    // Fetch top queries
    const dataRes = await fetch(`/api/gsc/data?mode=top_queries&limit=50&days=${days}`);
    if (dataRes.ok) {
      const data = await dataRes.json();
      setTopQueries(Array.isArray(data) ? data : []);
    }

    setLoading(false);
  }, [days]);

  // Fetch analytics data when tab changes
  useEffect(() => {
    if (loading) return;

    if (activeTab === "drops" && trafficDrops.length === 0) {
      fetch(`/api/gsc/analytics?mode=traffic_drops&days=${dropDays}&threshold=20`)
        .then((r) => r.json())
        .then((data) => setTrafficDrops(Array.isArray(data) ? data : []));
    }
    if (activeTab === "opportunities" && opportunities.length === 0) {
      fetch(`/api/gsc/analytics?mode=opportunities&days=${days}&min_impressions=100&min_position=5&limit=50`)
        .then((r) => r.json())
        .then((data) => setOpportunities(Array.isArray(data) ? data : []));
    }
    if (activeTab === "power" && powerScores.length === 0) {
      fetch(`/api/gsc/analytics?mode=power_score&days=${days}&min_position=10&min_impressions=50&limit=50`)
        .then((r) => r.json())
        .then((data) => setPowerScores(Array.isArray(data) ? data : []));
    }
    if (activeTab === "not-indexed" && !notIndexed && !notIndexedLoading) {
      setNotIndexedLoading(true);
      fetch("/api/gsc/not-indexed?days=30")
        .then((r) => r.json())
        .then((data) => {
          setNotIndexed(data);
          setNotIndexedLoading(false);
        })
        .catch(() => setNotIndexedLoading(false));
    }
  }, [activeTab, loading, days, dropDays, trafficDrops.length, opportunities.length, powerScores.length, notIndexed, notIndexedLoading]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Reset analytics when period changes
  useEffect(() => {
    setTrafficDrops([]);
    setOpportunities([]);
    setPowerScores([]);
  }, [days]);

  useEffect(() => {
    setTrafficDrops([]);
  }, [dropDays]);

  async function handleSyncProperties() {
    setSyncingProperties(true);
    try {
      const res = await fetch("/api/gsc/properties", { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        toast.success(data.message || "Properties synced");
        fetchData();
      } else {
        toast.error(data.error || "Failed to sync properties");
      }
    } catch {
      toast.error("Failed to sync properties");
    }
    setSyncingProperties(false);
  }

  async function handleSyncData() {
    setSyncing(true);
    try {
      const res = await fetch("/api/gsc/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success(data.message || "Data synced");
        setTrafficDrops([]);
        setOpportunities([]);
        setPowerScores([]);
        setNotIndexed(null);
        fetchData();
      } else {
        toast.error(data.error || "Failed to sync data");
      }
    } catch {
      toast.error("Failed to sync data");
    }
    setSyncing(false);
  }

  async function handleAutoDetect() {
    setDetecting(true);
    try {
      const res = await fetch("/api/gsc/auto-detect", { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        toast.success(data.message || "Detection complete");
        fetchData();
      } else {
        toast.error(data.error || "Detection failed");
      }
    } catch {
      toast.error("Detection failed");
    }
    setDetecting(false);
  }

  async function handleSaveRules() {
    try {
      const res = await fetch("/api/gsc/rules", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(rules),
      });
      if (res.ok) {
        toast.success("Settings saved");
        setSettingsOpen(false);
      } else {
        toast.error("Failed to save settings");
      }
    } catch {
      toast.error("Failed to save settings");
    }
  }

  async function handleLinkProperty(propertyId: string, siteId: string | null) {
    try {
      await fetch("/api/gsc/properties", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ property_id: propertyId, site_id: siteId }),
      });
      fetchData();
    } catch {
      toast.error("Failed to link property");
    }
  }

  // Stats
  const totalClicks = properties.reduce((sum, p) => sum + p.stats_7d.clicks, 0);
  const totalImpressions = properties.reduce((sum, p) => sum + p.stats_7d.impressions, 0);

  const periodLabel: Record<string, string> = {
    "4": "24h",
    "7": "7j",
    "28": "28j",
    "90": "3 mois",
  };

  const countries = [...new Set(topQueries.map((q) => q.country))].sort();

  const filteredQueries =
    filterCountry === "all"
      ? topQueries
      : topQueries.filter((q) => q.country === filterCountry);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Search Console</h1>
          <p className="text-sm text-muted-foreground">
            {properties.length} properties &middot; {sitesRanking.length} sites
          </p>
        </div>
        <div className="flex gap-2 items-center">
          <Select value={days} onValueChange={setDays}>
            <SelectTrigger className="w-[110px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="4">24 heures</SelectItem>
              <SelectItem value="7">7 jours</SelectItem>
              <SelectItem value="28">28 jours</SelectItem>
              <SelectItem value="90">3 mois</SelectItem>
            </SelectContent>
          </Select>

          <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm">
                <Settings2 className="h-4 w-4 mr-1" />
                Settings
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Auto-Detection Settings</DialogTitle>
                <DialogDescription>
                  Configure thresholds for automatic keyword detection
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label>Min clicks par jour pour auto-ajout</Label>
                  <Input
                    type="number"
                    value={rules.min_clicks_keyword}
                    onChange={(e) =>
                      setRules({
                        ...rules,
                        min_clicks_keyword: parseInt(e.target.value) || 5,
                      })
                    }
                  />
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="auto-add"
                    checked={rules.auto_add_enabled}
                    onChange={(e) =>
                      setRules({
                        ...rules,
                        auto_add_enabled: e.target.checked,
                      })
                    }
                    className="rounded"
                  />
                  <Label htmlFor="auto-add">Auto-add keywords to tracker</Label>
                </div>
              </div>
              <DialogFooter>
                <Button onClick={handleSaveRules}>Save</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Button variant="outline" size="sm" onClick={handleSyncProperties} disabled={syncingProperties}>
            <Globe className="h-4 w-4 mr-1" />
            {syncingProperties ? "..." : "Properties"}
          </Button>

          <Button variant="outline" size="sm" onClick={handleSyncData} disabled={syncing}>
            <RefreshCw className={`h-4 w-4 mr-1 ${syncing ? "animate-spin" : ""}`} />
            {syncing ? "Syncing..." : "Sync"}
          </Button>

          <Button size="sm" onClick={handleAutoDetect} disabled={detecting}>
            <Zap className="h-4 w-4 mr-1" />
            {detecting ? "..." : "Detect"}
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="overview">Vue d&apos;ensemble</TabsTrigger>
          <TabsTrigger value="drops">
            <TrendingDown className="h-3.5 w-3.5 mr-1" />
            Baisses
          </TabsTrigger>
          <TabsTrigger value="not-indexed">
            <FileX className="h-3.5 w-3.5 mr-1" />
            Non-index&eacute;
          </TabsTrigger>
          <TabsTrigger value="opportunities">
            <Lightbulb className="h-3.5 w-3.5 mr-1" />
            Opportunites
          </TabsTrigger>
          <TabsTrigger value="keywords">
            <Target className="h-3.5 w-3.5 mr-1" />
            Top Keywords
          </TabsTrigger>
          <TabsTrigger value="power">
            <Flame className="h-3.5 w-3.5 mr-1" />
            Power Score
          </TabsTrigger>
        </TabsList>

        {/* ── Overview Tab ─────────────────────────────────────────────── */}
        <TabsContent value="overview" className="space-y-6">
          {/* KPI Cards */}
          <div className="grid grid-cols-4 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Total Clicks ({periodLabel[days]})
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{totalClicks.toLocaleString()}</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Impressions ({periodLabel[days]})
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{totalImpressions.toLocaleString()}</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Sites actifs</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{sitesTotals?.active_sites ?? 0}</div>
                {(sitesTotals?.dead_sites ?? 0) > 0 && (
                  <p className="text-xs text-red-500 flex items-center gap-1 mt-1">
                    <Skull className="h-3 w-3" />
                    {sitesTotals?.dead_sites} morts
                  </p>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Top Queries</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{topQueries.length}</div>
              </CardContent>
            </Card>
          </div>

          {/* Chart */}
          {timeseries.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium">
                  Clicks & Impressions
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <AreaChart data={timeseries}>
                    <defs>
                      <linearGradient id="colorClicks" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="colorImpressions" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.2} />
                        <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis
                      dataKey="date"
                      tickFormatter={formatDate}
                      className="text-xs"
                      tick={{ fontSize: 11 }}
                    />
                    <YAxis
                      yAxisId="clicks"
                      orientation="left"
                      tick={{ fontSize: 11 }}
                      tickFormatter={(v: number) => v.toLocaleString()}
                    />
                    <YAxis
                      yAxisId="impressions"
                      orientation="right"
                      tick={{ fontSize: 11 }}
                      tickFormatter={(v: number) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v.toString()}
                    />
                    <Tooltip
                      labelFormatter={(label) => formatDate(String(label))}
                      formatter={(value, name) => [
                        Number(value).toLocaleString(),
                        name === "clicks" ? "Clicks" : "Impressions",
                      ]}
                    />
                    <Legend />
                    <Area
                      yAxisId="clicks"
                      type="monotone"
                      dataKey="clicks"
                      stroke="#3b82f6"
                      fill="url(#colorClicks)"
                      strokeWidth={2}
                      name="Clicks"
                    />
                    <Area
                      yAxisId="impressions"
                      type="monotone"
                      dataKey="impressions"
                      stroke="#8b5cf6"
                      fill="url(#colorImpressions)"
                      strokeWidth={2}
                      name="Impressions"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}

          {/* Sites Ranking (main view) */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  <Trophy className="h-5 w-5" />
                  Clicks par site ({periodLabel[days]})
                </CardTitle>
                <p className="text-sm text-muted-foreground">
                  Variation vs p&eacute;riode pr&eacute;c&eacute;dente
                </p>
              </div>
            </CardHeader>
            <CardContent>
              {sitesRanking.length === 0 ? (
                <p className="text-center text-muted-foreground py-8">
                  Aucune donn&eacute;e. Synchronisez vos properties.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-8">#</TableHead>
                      <TableHead>Site</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Clicks</TableHead>
                      <TableHead className="text-right">Impressions</TableHead>
                      <TableHead className="text-right">CTR</TableHead>
                      <TableHead className="text-right">Position moy.</TableHead>
                      <TableHead className="text-right">Variation</TableHead>
                      <TableHead className="text-right">Queries</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sitesRanking.map((site, i) => (
                      <TableRow
                        key={site.site_id}
                        className={
                          site.status === "dead"
                            ? "opacity-50 bg-red-50 dark:bg-red-950/10"
                            : site.status === "star"
                              ? "bg-yellow-50 dark:bg-yellow-950/10"
                              : site.status === "declining"
                                ? "bg-orange-50 dark:bg-orange-950/10"
                                : ""
                        }
                      >
                        <TableCell className="font-bold text-muted-foreground">{i + 1}</TableCell>
                        <TableCell>
                          <div className="font-medium">{site.domain}</div>
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              site.status === "star" ? "default"
                                : site.status === "growing" ? "default"
                                  : site.status === "declining" ? "destructive"
                                    : site.status === "dead" ? "destructive"
                                      : "secondary"
                            }
                            className={
                              site.status === "star" ? "bg-yellow-500 text-black"
                                : site.status === "growing" ? "bg-green-500"
                                  : ""
                            }
                          >
                            {site.status === "star" && "Star"}
                            {site.status === "growing" && "Growing"}
                            {site.status === "stable" && "Stable"}
                            {site.status === "declining" && "Declining"}
                            {site.status === "dead" && "Dead"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right font-bold">
                          {site.clicks.toLocaleString()}
                        </TableCell>
                        <TableCell className="text-right">
                          {site.impressions.toLocaleString()}
                        </TableCell>
                        <TableCell className="text-right">
                          {(site.avg_ctr * 100).toFixed(1)}%
                        </TableCell>
                        <TableCell className="text-right">
                          {site.avg_position > 0 ? (
                            <span className={
                              site.avg_position <= 10 ? "text-green-600 font-medium"
                                : site.avg_position <= 20 ? "text-blue-600"
                                  : "text-orange-600"
                            }>
                              {site.avg_position}
                            </span>
                          ) : "-"}
                        </TableCell>
                        <TableCell className="text-right">
                          <span className={`flex items-center justify-end gap-1 font-medium ${
                            site.clicks_trend_pct > 10 ? "text-green-600"
                              : site.clicks_trend_pct < -10 ? "text-red-500"
                                : "text-muted-foreground"
                          }`}>
                            {site.clicks_trend_pct > 0 ? (
                              <TrendingUp className="h-3.5 w-3.5" />
                            ) : site.clicks_trend_pct < 0 ? (
                              <TrendingDown className="h-3.5 w-3.5" />
                            ) : null}
                            {site.clicks_trend_pct > 0 ? "+" : ""}{site.clicks_trend_pct}%
                          </span>
                        </TableCell>
                        <TableCell className="text-right text-muted-foreground">
                          {site.unique_queries.toLocaleString()}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {/* Properties Grid */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Globe className="h-5 w-5" />
                Properties
              </CardTitle>
            </CardHeader>
            <CardContent>
              {properties.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <p>No GSC properties found.</p>
                  <p className="text-sm mt-1">Click &quot;Properties&quot; to discover your sites.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {properties.map((prop) => (
                    <Card key={prop.id} className="border">
                      <CardContent className="pt-4">
                        <div className="flex items-start justify-between mb-2">
                          <div className="font-medium text-sm truncate flex-1">
                            {extractDomain(prop.site_url)}
                          </div>
                          {prop.sites ? (
                            <Badge variant="default" className="ml-2 text-xs">Linked</Badge>
                          ) : (
                            <Select onValueChange={(val) => handleLinkProperty(prop.id, val)}>
                              <SelectTrigger className="w-[120px] h-7 text-xs">
                                <SelectValue placeholder="Link site" />
                              </SelectTrigger>
                              <SelectContent>
                                {userSites.map((s) => (
                                  <SelectItem key={s.id} value={s.id}>{s.domain}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          )}
                        </div>
                        <div className="flex gap-4 text-sm text-muted-foreground">
                          <div className="flex items-center gap-1">
                            <MousePointerClick className="h-3 w-3" />
                            {prop.stats_7d.clicks.toLocaleString()} clicks
                          </div>
                          <div className="flex items-center gap-1">
                            <Eye className="h-3 w-3" />
                            {prop.stats_7d.impressions.toLocaleString()} imp
                          </div>
                        </div>
                        {prop.last_synced_at && (
                          <p className="text-xs text-muted-foreground mt-2">
                            Sync: {new Date(prop.last_synced_at).toLocaleDateString()}
                          </p>
                        )}
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Traffic Drops Tab ─────────────────────────────────────── */}
        <TabsContent value="drops" className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold">Baisses de trafic</h2>
              <p className="text-sm text-muted-foreground">
                Pages avec une baisse de clicks significative entre 2 periodes
              </p>
            </div>
            <Select value={dropDays} onValueChange={setDropDays}>
              <SelectTrigger className="w-[130px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7">7j vs 7j</SelectItem>
                <SelectItem value="14">14j vs 14j</SelectItem>
                <SelectItem value="28">28j vs 28j</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {trafficDrops.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                Aucune baisse significative detectee
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="pt-4">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Page</TableHead>
                      <TableHead className="text-right">Avant</TableHead>
                      <TableHead className="text-right">Apres</TableHead>
                      <TableHead className="text-right">Variation</TableHead>
                      <TableHead>Top Queries</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {trafficDrops.map((drop, i) => (
                      <TableRow key={i}>
                        <TableCell className="max-w-[300px]">
                          <div className="truncate text-sm font-medium">{drop.page}</div>
                          <div className="text-xs text-muted-foreground truncate">
                            {extractDomain(drop.property_site_url)}
                          </div>
                        </TableCell>
                        <TableCell className="text-right">{drop.clicks_before}</TableCell>
                        <TableCell className="text-right">{drop.clicks_after}</TableCell>
                        <TableCell className="text-right">
                          <Badge
                            variant={drop.pct_change < -50 ? "destructive" : "secondary"}
                            className={drop.pct_change < -50 ? "" : "text-orange-600"}
                          >
                            {drop.pct_change}%
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            {drop.top_queries.slice(0, 3).map((q) => (
                              <Badge key={q.query} variant="outline" className="text-xs">
                                {q.query}
                              </Badge>
                            ))}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ── Non-Indexed Tab ──────────────────────────────────────── */}
        <TabsContent value="not-indexed" className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <FileX className="h-5 w-5" />
              URLs non index&eacute;es
            </h2>
            <p className="text-sm text-muted-foreground">
              Fiches produit pr&eacute;sentes dans le sitemap mais sans impressions dans GSC (30 derniers jours)
            </p>
          </div>

          {notIndexedLoading ? (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                <RefreshCw className="h-5 w-5 animate-spin inline mr-2" />
                Analyse des sitemaps en cours...
              </CardContent>
            </Card>
          ) : !notIndexed ? (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                Chargement...
              </CardContent>
            </Card>
          ) : (
            <>
              {/* Summary */}
              <div className="grid grid-cols-3 gap-4">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">
                      URLs Sitemap
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">{notIndexed.total_sitemap.toLocaleString()}</div>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">
                      Index&eacute;es
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold text-green-600">
                      {notIndexed.total_indexed.toLocaleString()}
                    </div>
                  </CardContent>
                </Card>
                <Card className={notIndexed.total_not_indexed > 0 ? "border-orange-500" : ""}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1">
                      <AlertTriangle className="h-3.5 w-3.5 text-orange-500" />
                      Non index&eacute;es
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold text-orange-500">
                      {notIndexed.total_not_indexed.toLocaleString()}
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Per-site breakdown */}
              {notIndexed.sites.map((site) => (
                <Card key={site.site_id}>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base flex items-center gap-2">
                        <Globe className="h-4 w-4" />
                        {site.domain}
                      </CardTitle>
                      <div className="flex items-center gap-3 text-sm">
                        <Badge variant="outline">{site.sitemap_urls} sitemap</Badge>
                        <Badge variant="default" className="bg-green-600">
                          {site.indexed_urls} index&eacute;es
                        </Badge>
                        {site.not_indexed_urls.length > 0 && (
                          <Badge variant="destructive">
                            {site.not_indexed_urls.length} manquantes
                          </Badge>
                        )}
                        <span className="text-muted-foreground font-medium">
                          {site.indexation_rate}%
                        </span>
                      </div>
                    </div>
                  </CardHeader>
                  {site.not_indexed_urls.length > 0 && (
                    <CardContent>
                      <div className="space-y-1 max-h-[300px] overflow-y-auto">
                        {site.not_indexed_urls.map((url) => (
                          <div
                            key={url}
                            className="flex items-center gap-2 text-sm py-1 px-2 rounded hover:bg-accent"
                          >
                            <FileX className="h-3.5 w-3.5 text-orange-500 shrink-0" />
                            <a
                              href={url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="truncate text-muted-foreground hover:text-foreground"
                            >
                              {url.replace(/https?:\/\/(www\.)?/, "")}
                            </a>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  )}
                </Card>
              ))}

              {notIndexed.sites.length === 0 && (
                <Card>
                  <CardContent className="py-8 text-center text-muted-foreground">
                    Aucun site avec sitemap trouv&eacute;. V&eacute;rifiez que vos sites ont un sitemap.xml accessible.
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </TabsContent>

        {/* ── Opportunities Tab ────────────────────────────────────── */}
        <TabsContent value="opportunities" className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold">Opportunites</h2>
            <p className="text-sm text-muted-foreground">
              Mots-cles avec beaucoup d&apos;impressions mais une position ameliorable ({">"} 5)
            </p>
          </div>

          {opportunities.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                Aucune opportunite trouvee
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="pt-4">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Query</TableHead>
                      <TableHead>Pays</TableHead>
                      <TableHead className="text-right">Impressions</TableHead>
                      <TableHead className="text-right">Position</TableHead>
                      <TableHead className="text-right">Clicks</TableHead>
                      <TableHead className="text-right">CTR</TableHead>
                      <TableHead>Page</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {opportunities.map((opp, i) => (
                      <TableRow
                        key={i}
                        className={
                          opp.avg_position >= 5 && opp.avg_position <= 15
                            ? "bg-green-50 dark:bg-green-950/20"
                            : ""
                        }
                      >
                        <TableCell className="font-medium max-w-[200px] truncate">
                          {opp.query}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">
                            {getFlag(opp.country)} {opp.country}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right font-bold">
                          {opp.impressions.toLocaleString()}
                        </TableCell>
                        <TableCell className="text-right">
                          <span
                            className={
                              opp.avg_position <= 10
                                ? "text-green-600 font-bold"
                                : opp.avg_position <= 20
                                  ? "text-blue-600"
                                  : "text-orange-600"
                            }
                          >
                            {opp.avg_position}
                          </span>
                        </TableCell>
                        <TableCell className="text-right">{opp.clicks}</TableCell>
                        <TableCell className="text-right text-muted-foreground">
                          {(opp.avg_ctr * 100).toFixed(1)}%
                        </TableCell>
                        <TableCell className="max-w-[200px] truncate text-xs text-muted-foreground">
                          {opp.top_page ?? "-"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ── Top Keywords Tab ─────────────────────────────────────── */}
        <TabsContent value="keywords" className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  <Target className="h-5 w-5" />
                  Top Keywords
                </CardTitle>
                <Select value={filterCountry} onValueChange={setFilterCountry}>
                  <SelectTrigger className="w-[150px]">
                    <SelectValue placeholder="All countries" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All countries</SelectItem>
                    {countries.map((c) => (
                      <SelectItem key={c} value={c}>
                        {getFlag(c)} {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CardHeader>
            <CardContent>
              {filteredQueries.length === 0 ? (
                <p className="text-center text-muted-foreground py-4">
                  No data yet. Sync your properties first.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Query</TableHead>
                      <TableHead>Property</TableHead>
                      <TableHead>Country</TableHead>
                      <TableHead className="text-right">Clicks</TableHead>
                      <TableHead className="text-right">Impressions</TableHead>
                      <TableHead className="text-right">Position</TableHead>
                      <TableHead className="text-right">CTR</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredQueries.map((q, i) => (
                      <TableRow key={`${q.query}-${q.country}-${i}`}>
                        <TableCell className="font-medium max-w-[250px] truncate">
                          {q.query}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground max-w-[150px] truncate">
                          {extractDomain(q.property_site_url)}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">
                            {getFlag(q.country)} {q.country}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right font-medium">
                          {q.total_clicks.toLocaleString()}
                        </TableCell>
                        <TableCell className="text-right text-muted-foreground">
                          {q.total_impressions.toLocaleString()}
                        </TableCell>
                        <TableCell className="text-right">{q.avg_position.toFixed(1)}</TableCell>
                        <TableCell className="text-right text-muted-foreground">
                          {(q.avg_ctr * 100).toFixed(1)}%
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Power Score Tab ──────────────────────────────────────── */}
        <TabsContent value="power" className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold">Power Score</h2>
            <p className="text-sm text-muted-foreground">
              Plus la position est basse et les impressions fortes, plus le mot-cle a de potentiel.
              Formule : impressions / ln(position + 1)
            </p>
          </div>

          {powerScores.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                Aucun mot-cle avec Power Score trouve
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="pt-4">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Query</TableHead>
                      <TableHead>Pays</TableHead>
                      <TableHead className="text-right">Power Score</TableHead>
                      <TableHead className="text-right">Impressions</TableHead>
                      <TableHead className="text-right">Position</TableHead>
                      <TableHead className="text-right">Clicks actuels</TableHead>
                      <TableHead className="text-right">Est. trafic Top 3</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {powerScores.map((ps, i) => (
                      <TableRow key={i}>
                        <TableCell className="font-medium max-w-[200px] truncate">
                          {ps.query}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">
                            {getFlag(ps.country)} {ps.country}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <span className="font-bold text-lg text-primary">
                            {ps.power_score.toLocaleString()}
                          </span>
                        </TableCell>
                        <TableCell className="text-right">
                          {ps.impressions.toLocaleString()}
                        </TableCell>
                        <TableCell className="text-right">
                          <span className="text-orange-600">{ps.avg_position}</span>
                        </TableCell>
                        <TableCell className="text-right text-muted-foreground">
                          {ps.clicks.toLocaleString()}
                        </TableCell>
                        <TableCell className="text-right">
                          <span className="text-green-600 font-medium">
                            ~{ps.estimated_traffic_top3.toLocaleString()}
                          </span>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

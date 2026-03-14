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
import {
  RefreshCw,
  ArrowUp,
  ArrowDown,
  Minus,
  Settings2,
  Zap,
  Globe,
  MousePointerClick,
  Eye,
  Target,
} from "lucide-react";
import { toast } from "sonner";

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

interface AutoRules {
  min_clicks_keyword: number;
  min_clicks_page_daily: number;
  auto_add_enabled: boolean;
}

interface UserSite {
  id: string;
  domain: string;
}

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

export default function GscPage() {
  const [properties, setProperties] = useState<GscPropertyWithStats[]>([]);
  const [topQueries, setTopQueries] = useState<TopQuery[]>([]);
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
  const [days, setDays] = useState<string>("28");

  const fetchData = useCallback(async () => {
    const supabase = createClient();

    const [propsRes, rulesRes, sitesRes] = await Promise.all([
      fetch(`/api/gsc/properties?days=${days}`),
      fetch("/api/gsc/rules"),
      supabase.from("sites").select("id, domain").order("domain"),
    ]);

    if (propsRes.ok) {
      const data = await propsRes.json();
      setProperties(Array.isArray(data) ? data : []);
    }

    if (rulesRes.ok) {
      setRules(await rulesRes.json());
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

  useEffect(() => {
    fetchData();
  }, [fetchData]);

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
  const totalClicks = properties.reduce(
    (sum, p) => sum + p.stats_7d.clicks,
    0
  );
  const totalImpressions = properties.reduce(
    (sum, p) => sum + p.stats_7d.impressions,
    0
  );

  const periodLabel: Record<string, string> = {
    "4": "24h",
    "7": "7d",
    "28": "28d",
    "90": "3 mois",
  };

  // Get unique countries from top queries
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
            {properties.length} properties tracked
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
                  <Label htmlFor="auto-add">
                    Auto-add keywords to tracker
                  </Label>
                </div>
              </div>
              <DialogFooter>
                <Button onClick={handleSaveRules}>Save</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Button
            variant="outline"
            size="sm"
            onClick={handleSyncProperties}
            disabled={syncingProperties}
          >
            <Globe className="h-4 w-4 mr-1" />
            {syncingProperties ? "Syncing..." : "Sync Properties"}
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={handleSyncData}
            disabled={syncing}
          >
            <RefreshCw
              className={`h-4 w-4 mr-1 ${syncing ? "animate-spin" : ""}`}
            />
            {syncing ? "Syncing..." : "Sync Data"}
          </Button>

          <Button size="sm" onClick={handleAutoDetect} disabled={detecting}>
            <Zap className="h-4 w-4 mr-1" />
            {detecting ? "Detecting..." : "Auto-Detect"}
          </Button>
        </div>
      </div>

      {/* Global Stats */}
      <div className="grid grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Clicks ({periodLabel[days]})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {totalClicks.toLocaleString()}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Impressions ({periodLabel[days]})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {totalImpressions.toLocaleString()}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Properties
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{properties.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Top Queries
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{topQueries.length}</div>
          </CardContent>
        </Card>
      </div>

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
              <p className="text-sm mt-1">
                Click &quot;Sync Properties&quot; to discover your sites.
              </p>
              <p className="text-xs mt-2">
                Make sure to add the service account as a user on your GSC
                properties first.
              </p>
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
                        <Badge variant="default" className="ml-2 text-xs">
                          Linked
                        </Badge>
                      ) : (
                        <Select
                          onValueChange={(val) =>
                            handleLinkProperty(prop.id, val)
                          }
                        >
                          <SelectTrigger className="w-[120px] h-7 text-xs">
                            <SelectValue placeholder="Link site" />
                          </SelectTrigger>
                          <SelectContent>
                            {userSites.map((s) => (
                              <SelectItem key={s.id} value={s.id}>
                                {s.domain}
                              </SelectItem>
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
                        Last sync:{" "}
                        {new Date(prop.last_synced_at).toLocaleDateString()}
                      </p>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Top Keywords */}
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
                    <TableCell className="text-right">
                      {q.avg_position.toFixed(1)}
                    </TableCell>
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
    </div>
  );
}

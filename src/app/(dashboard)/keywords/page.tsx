"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ArrowUp, ArrowDown, Minus, RefreshCw, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { Location } from "@/types/database";

interface SitePosition {
  keywordId: string;
  siteId: string;
  domain: string;
  position: number | null;
  previousPosition: number | null;
  urlFound: string | null;
}

interface GroupedKeyword {
  keyword: string;
  locationCode: number;
  countryIso: string;
  countryName: string;
  niche: string;
  sites: SitePosition[];
}

export default function KeywordsPage() {
  const [grouped, setGrouped] = useState<GroupedKeyword[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [filterCountry, setFilterCountry] = useState<string>("all");
  const [filterNiche, setFilterNiche] = useState<string>("all");
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [addKeyword, setAddKeyword] = useState("");
  const [addLocationCode, setAddLocationCode] = useState("");
  const [adding, setAdding] = useState(false);

  const fetchData = useCallback(async () => {
    const supabase = createClient();

    const [{ data: locs }, { data: kws }] = await Promise.all([
      supabase.from("locations").select("*").order("name"),
      supabase
        .from("keywords")
        .select(
          "id, keyword, location_code, site_id, sites(domain, niche), locations(name, country_iso)"
        ),
    ]);

    setLocations(locs ?? []);

    if (!kws || kws.length === 0) {
      setGrouped([]);
      setLoading(false);
      return;
    }

    // Fetch latest 2 positions for each keyword
    const keywordIds = kws.map((k) => k.id);
    const { data: positions } = await supabase
      .from("keyword_positions")
      .select("keyword_id, site_id, position, url_found, checked_at")
      .in("keyword_id", keywordIds)
      .order("checked_at", { ascending: false });

    const posMap = new Map<
      string,
      { latest: number | null; previous: number | null; url: string | null }
    >();
    positions?.forEach((p) => {
      const key = `${p.keyword_id}-${p.site_id}`;
      const existing = posMap.get(key);
      if (!existing) {
        posMap.set(key, { latest: p.position, previous: null, url: p.url_found });
      } else if (existing.previous === null) {
        existing.previous = p.position;
      }
    });

    // Group by keyword + location_code
    const groups = new Map<string, GroupedKeyword>();

    kws.forEach((k) => {
      const site = k.sites as unknown as { domain: string; niche: string };
      const loc = k.locations as unknown as { name: string; country_iso: string };
      const groupKey = `${k.keyword}::${k.location_code}`;
      const pos = posMap.get(`${k.id}-${k.site_id}`);

      if (!groups.has(groupKey)) {
        groups.set(groupKey, {
          keyword: k.keyword,
          locationCode: k.location_code,
          countryIso: loc?.country_iso ?? "",
          countryName: loc?.name ?? "",
          niche: site?.niche ?? "",
          sites: [],
        });
      }

      groups.get(groupKey)!.sites.push({
        keywordId: k.id,
        siteId: k.site_id,
        domain: site?.domain ?? "",
        position: pos?.latest ?? null,
        previousPosition: pos?.previous ?? null,
        urlFound: pos?.url ?? null,
      });
    });

    setGrouped(Array.from(groups.values()));
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  async function handleCheckPositions() {
    setChecking(true);
    try {
      const res = await fetch("/api/positions/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error || "Failed to check positions");
        return;
      }

      toast.success(
        `Checked ${data.checked} keywords (${data.apiCalls} API calls). ${
          data.deindexed > 0 ? `${data.deindexed} deindexed detected!` : ""
        }`
      );

      // Refresh data
      setLoading(true);
      await fetchData();
    } catch (err) {
      toast.error("Network error");
      console.error(err);
    } finally {
      setChecking(false);
    }
  }

  async function handleAddKeyword(e: React.FormEvent) {
    e.preventDefault();
    if (!addKeyword.trim() || !addLocationCode) return;

    setAdding(true);
    try {
      const res = await fetch("/api/keywords", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          keyword: addKeyword.trim(),
          location_code: parseInt(addLocationCode, 10),
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error || "Failed to add keyword");
        return;
      }

      toast.success(data.message || "Keyword added");
      setAddKeyword("");
      setAddLocationCode("");
      setAddOpen(false);
      setLoading(true);
      await fetchData();
    } catch (err) {
      toast.error("Network error");
    } finally {
      setAdding(false);
    }
  }

  async function handleDeleteKeyword(keyword: string, locationCode: number) {
    if (!confirm(`Delete "${keyword}" from all sites?`)) return;

    try {
      const res = await fetch(
        `/api/keywords?keyword=${encodeURIComponent(keyword)}&location_code=${locationCode}`,
        { method: "DELETE" }
      );

      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error || "Failed to delete keyword");
        return;
      }

      toast.success(data.message || "Keyword deleted");
      setLoading(true);
      await fetchData();
    } catch (err) {
      toast.error("Network error");
    }
  }

  const filtered = grouped.filter((g) => {
    if (filterCountry !== "all" && g.countryIso !== filterCountry) return false;
    if (filterNiche !== "all" && g.niche !== filterNiche) return false;
    return true;
  });

  // Distribution stats (count site-keyword pairs, not groups)
  const allSitePositions = filtered.flatMap((g) => g.sites);
  const distribution = {
    top3: allSitePositions.filter((s) => s.position !== null && s.position <= 3).length,
    top10: allSitePositions.filter((s) => s.position !== null && s.position <= 10).length,
    top20: allSitePositions.filter((s) => s.position !== null && s.position <= 20).length,
    top50: allSitePositions.filter((s) => s.position !== null && s.position <= 50).length,
    out: allSitePositions.filter((s) => s.position === null).length,
  };

  function getTrend(latest: number | null, previous: number | null) {
    if (latest === null || previous === null) return null;
    if (latest < previous) return "up";
    if (latest > previous) return "down";
    return "stable";
  }

  function positionColor(pos: number | null) {
    if (pos === null) return "text-destructive";
    if (pos <= 3) return "font-bold text-green-600";
    if (pos <= 10) return "font-bold text-emerald-600";
    if (pos <= 20) return "text-blue-600";
    return "";
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Keywords Tracker</h1>
        <div className="flex items-center gap-2">
          <Button onClick={handleCheckPositions} disabled={checking} variant="outline">
            <RefreshCw className={`mr-2 h-4 w-4 ${checking ? "animate-spin" : ""}`} />
            {checking ? "Checking..." : "Check Positions"}
          </Button>

          <Dialog open={addOpen} onOpenChange={setAddOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="mr-2 h-4 w-4" />
                Add Keyword
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add Keyword</DialogTitle>
                <DialogDescription>
                  The keyword will be added to all sites of the selected country.
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={handleAddKeyword} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="new-keyword">Keyword *</Label>
                  <Input
                    id="new-keyword"
                    placeholder="e.g. glucavit"
                    value={addKeyword}
                    onChange={(e) => setAddKeyword(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="new-country">Country *</Label>
                  <Select value={addLocationCode} onValueChange={setAddLocationCode}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Select country" />
                    </SelectTrigger>
                    <SelectContent>
                      {locations.map((loc) => (
                        <SelectItem key={loc.code} value={String(loc.code)}>
                          {loc.country_iso} - {loc.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => setAddOpen(false)} disabled={adding}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={adding || !addKeyword.trim() || !addLocationCode}>
                    {adding ? "Adding..." : "Add to all sites"}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-4">
        <Select value={filterCountry} onValueChange={setFilterCountry}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="All countries" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All countries</SelectItem>
            {locations.map((loc) => (
              <SelectItem key={loc.code} value={loc.country_iso}>
                {loc.country_iso} - {loc.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={filterNiche} onValueChange={setFilterNiche}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="All niches" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All niches</SelectItem>
            <SelectItem value="casino">Casino</SelectItem>
            <SelectItem value="nutra">Nutra</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Distribution cards */}
      <div className="grid gap-4 md:grid-cols-5">
        {[
          { label: "Top 3", value: distribution.top3, color: "text-green-600" },
          { label: "Top 10", value: distribution.top10, color: "text-emerald-600" },
          { label: "Top 20", value: distribution.top20, color: "text-blue-600" },
          { label: "Top 50", value: distribution.top50, color: "text-yellow-600" },
          { label: "Out of 100", value: distribution.out, color: "text-destructive" },
        ].map((d) => (
          <Card key={d.label}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">{d.label}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className={`text-2xl font-bold ${d.color}`}>{d.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Keywords table - grouped by keyword */}
      <Card>
        <CardContent className="pt-6">
          {loading ? (
            <p className="text-center text-muted-foreground">Loading...</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Keyword</TableHead>
                  <TableHead>Country</TableHead>
                  <TableHead>Sites & Positions</TableHead>
                  <TableHead className="text-center">Indexed</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((g) => {
                  const allIndexed = g.sites.every((s) => s.position !== null);
                  const noneIndexed = g.sites.every((s) => s.position === null);

                  return (
                    <TableRow key={`${g.keyword}::${g.locationCode}`}>
                      <TableCell className="font-medium align-top">
                        {g.keyword}
                      </TableCell>
                      <TableCell className="align-top">
                        <Badge variant="outline">{g.countryIso}</Badge>
                      </TableCell>
                      <TableCell>
                        <div className="space-y-1">
                          {g.sites.map((s) => {
                            const trend = getTrend(s.position, s.previousPosition);
                            return (
                              <div
                                key={s.keywordId}
                                className="flex items-center gap-3 text-sm"
                              >
                                <span className="w-52 truncate text-muted-foreground">
                                  {s.domain}
                                </span>
                                <span className={`w-10 text-center ${positionColor(s.position)}`}>
                                  {s.position ?? "-"}
                                </span>
                                <span className="w-5">
                                  {trend === "up" && (
                                    <ArrowUp className="h-3.5 w-3.5 text-green-600" />
                                  )}
                                  {trend === "down" && (
                                    <ArrowDown className="h-3.5 w-3.5 text-destructive" />
                                  )}
                                  {trend === "stable" && (
                                    <Minus className="h-3.5 w-3.5 text-muted-foreground" />
                                  )}
                                </span>
                                <span className="truncate text-xs text-muted-foreground max-w-xs">
                                  {s.urlFound ?? ""}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </TableCell>
                      <TableCell className="text-center align-top">
                        {allIndexed ? (
                          <Badge variant="outline" className="text-green-600">
                            {g.sites.length}/{g.sites.length}
                          </Badge>
                        ) : noneIndexed ? (
                          <Badge variant="destructive">
                            0/{g.sites.length}
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-yellow-600">
                            {g.sites.filter((s) => s.position !== null).length}/{g.sites.length}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="align-top">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          onClick={() => handleDeleteKeyword(g.keyword, g.locationCode)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground">
                      No keywords found
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

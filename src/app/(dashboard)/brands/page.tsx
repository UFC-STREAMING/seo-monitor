"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Flame,
  Snowflake,
  TrendingUp,
  TrendingDown,
  RefreshCw,
  Eye,
  Target,
} from "lucide-react";
import { toast } from "sonner";

// ── Types ────────────────────────────────────────────────────────────────────

interface BrandItem {
  id: string;
  brand_name: string;
  nutra_product_id: string | null;
  country: string;
  status: "hot" | "cooling" | "removed";
  impressions_current_week: number;
  impressions_previous_week: number;
  entered_at: string;
  cooling_since: string | null;
  dataforseo_position: number | null;
  dataforseo_last_check: string | null;
  trend_pct: number;
}

interface BrandResponse {
  brands: BrandItem[];
  total: number;
  summary: { hot: number; cooling: number };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const countryFlags: Record<string, string> = {
  DEU: "DE", FRA: "FR", ESP: "ES", ITA: "IT", AUT: "AT", CHE: "CH",
  BEL: "BE", NLD: "NL", PRT: "PT", BRA: "BR", GBR: "GB", USA: "US",
  POL: "PL", CZE: "CZ", ROU: "RO", HUN: "HU", SVK: "SK", HRV: "HR",
  SVN: "SI", BGR: "BG", SRB: "RS",
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

function daysAgo(dateStr: string): string {
  const d = Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
  if (d === 0) return "Aujourd'hui";
  if (d === 1) return "Hier";
  return `${d}j`;
}

// ── Component ────────────────────────────────────────────────────────────────

export default function BrandsPage() {
  const [hotBrands, setHotBrands] = useState<BrandItem[]>([]);
  const [coolingBrands, setCoolingBrands] = useState<BrandItem[]>([]);
  const [summary, setSummary] = useState({ hot: 0, cooling: 0 });
  const [loading, setLoading] = useState(true);
  const [filterCountry, setFilterCountry] = useState<string>("all");
  const [sortBy, setSortBy] = useState<string>("impressions");

  const fetchBrands = useCallback(async () => {
    setLoading(true);
    try {
      const countryParam = filterCountry !== "all" ? `&country=${filterCountry}` : "";

      const [hotRes, coolingRes] = await Promise.all([
        fetch(`/api/brands/tracking?status=hot&sort=${sortBy}&limit=100${countryParam}`),
        fetch(`/api/brands/tracking?status=cooling&sort=${sortBy}&limit=50${countryParam}`),
      ]);

      if (hotRes.ok) {
        const data: BrandResponse = await hotRes.json();
        setHotBrands(data.brands);
        setSummary(data.summary);
      }
      if (coolingRes.ok) {
        const data: BrandResponse = await coolingRes.json();
        setCoolingBrands(data.brands);
      }
    } catch {
      toast.error("Erreur chargement des brands");
    }
    setLoading(false);
  }, [filterCountry, sortBy]);

  useEffect(() => {
    fetchBrands();
  }, [fetchBrands]);

  const countries = [
    ...new Set([...hotBrands, ...coolingBrands].map((b) => b.country)),
  ].sort();

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
          <h1 className="text-2xl font-bold">Brand Tracking</h1>
          <p className="text-sm text-muted-foreground">
            Detection automatique des tendances produits nutra
          </p>
        </div>
        <div className="flex gap-2 items-center">
          <Select value={filterCountry} onValueChange={setFilterCountry}>
            <SelectTrigger className="w-[150px]">
              <SelectValue placeholder="Tous les pays" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tous les pays</SelectItem>
              {countries.map((c) => (
                <SelectItem key={c} value={c}>
                  {getFlag(c)} {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={sortBy} onValueChange={setSortBy}>
            <SelectTrigger className="w-[150px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="impressions">Impressions</SelectItem>
              <SelectItem value="position">Position</SelectItem>
              <SelectItem value="entered">Date entree</SelectItem>
            </SelectContent>
          </Select>

          <Button variant="outline" size="sm" onClick={fetchBrands}>
            <RefreshCw className="h-4 w-4 mr-1" />
            Refresh
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Brands HOT
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-orange-500 flex items-center gap-2">
              <Flame className="h-5 w-5" />
              {summary.hot}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Brands Cooling
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-500 flex items-center gap-2">
              <Snowflake className="h-5 w-5" />
              {summary.cooling}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Impressions HOT
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold flex items-center gap-2">
              <Eye className="h-5 w-5" />
              {hotBrands.reduce((s, b) => s + b.impressions_current_week, 0).toLocaleString()}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Pays couverts
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold flex items-center gap-2">
              <Target className="h-5 w-5" />
              {countries.length}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="hot">
        <TabsList>
          <TabsTrigger value="hot" className="flex items-center gap-1">
            <Flame className="h-3.5 w-3.5" />
            HOT ({hotBrands.length})
          </TabsTrigger>
          <TabsTrigger value="cooling" className="flex items-center gap-1">
            <Snowflake className="h-3.5 w-3.5" />
            Cooling ({coolingBrands.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="hot" className="space-y-4">
          <BrandTable brands={hotBrands} showCoolingSince={false} />
        </TabsContent>

        <TabsContent value="cooling" className="space-y-4">
          <BrandTable brands={coolingBrands} showCoolingSince={true} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function BrandTable({
  brands,
  showCoolingSince,
}: {
  brands: BrandItem[];
  showCoolingSince: boolean;
}) {
  if (brands.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          Aucune brand dans cette categorie
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="pt-4">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Brand</TableHead>
              <TableHead>Pays</TableHead>
              <TableHead className="text-right">Impressions/sem</TableHead>
              <TableHead className="text-right">Trend</TableHead>
              <TableHead className="text-right">Position SERP</TableHead>
              {showCoolingSince && <TableHead>Cooling depuis</TableHead>}
              <TableHead>HOT depuis</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {brands.map((b) => (
              <TableRow key={b.id}>
                <TableCell className="font-bold">{b.brand_name}</TableCell>
                <TableCell>
                  <Badge variant="outline">
                    {getFlag(b.country)} {b.country}
                  </Badge>
                </TableCell>
                <TableCell className="text-right font-medium">
                  {b.impressions_current_week.toLocaleString()}
                  <span className="text-xs text-muted-foreground ml-1">
                    (prev: {b.impressions_previous_week.toLocaleString()})
                  </span>
                </TableCell>
                <TableCell className="text-right">
                  <span
                    className={`flex items-center justify-end gap-1 font-medium ${
                      b.trend_pct > 0
                        ? "text-green-600"
                        : b.trend_pct < 0
                          ? "text-red-500"
                          : "text-muted-foreground"
                    }`}
                  >
                    {b.trend_pct > 0 ? (
                      <TrendingUp className="h-3.5 w-3.5" />
                    ) : b.trend_pct < 0 ? (
                      <TrendingDown className="h-3.5 w-3.5" />
                    ) : null}
                    {b.trend_pct > 0 ? "+" : ""}
                    {b.trend_pct}%
                  </span>
                </TableCell>
                <TableCell className="text-right">
                  {b.dataforseo_position ? (
                    <span
                      className={
                        b.dataforseo_position <= 3
                          ? "text-green-600 font-bold"
                          : b.dataforseo_position <= 10
                            ? "text-blue-600 font-medium"
                            : "text-orange-600"
                      }
                    >
                      #{b.dataforseo_position}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">-</span>
                  )}
                </TableCell>
                {showCoolingSince && (
                  <TableCell>
                    {b.cooling_since ? (
                      <Badge variant="secondary">{daysAgo(b.cooling_since)}</Badge>
                    ) : (
                      "-"
                    )}
                  </TableCell>
                )}
                <TableCell className="text-sm text-muted-foreground">
                  {daysAgo(b.entered_at)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

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
import {
  RefreshCw,
  Link2,
  Trophy,
  ArrowRight,
  ExternalLink,
} from "lucide-react";
import { toast } from "sonner";

// ── Types ────────────────────────────────────────────────────────────────────

interface LinkingSite {
  domain: string;
  page: string;
  position: number;
  impressions: number;
}

interface LinkOpportunity {
  query: string;
  country: string;
  winner_domain: string;
  winner_page: string;
  winner_position: number;
  winner_clicks: number;
  winner_impressions: number;
  linking_sites: LinkingSite[];
  potential_boost: number;
}

interface OpportunitiesResponse {
  opportunities: LinkOpportunity[];
  total: number;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const countryFlags: Record<string, string> = {
  DEU: "DE", FRA: "FR", ESP: "ES", ITA: "IT", AUT: "AT", CHE: "CH",
  BEL: "BE", NLD: "NL", PRT: "PT", BRA: "BR", GBR: "GB", USA: "US",
  POL: "PL", CZE: "CZ", ROU: "RO", HUN: "HU", SVK: "SK", HRV: "HR",
  SVN: "SI", BGR: "BG", SRB: "RS", FIN: "FI", SWE: "SE", DNK: "DK",
};

function getFlag(alpha3: string): string {
  const alpha2 = countryFlags[alpha3?.toUpperCase()];
  if (!alpha2) return alpha3 ?? "";
  return alpha2
    .toUpperCase()
    .split("")
    .map((c) => String.fromCodePoint(0x1f1e6 + c.charCodeAt(0) - 65))
    .join("");
}

function extractPath(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

// ── Component ────────────────────────────────────────────────────────────────

export default function LinkingPage() {
  const [opportunities, setOpportunities] = useState<LinkOpportunity[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState("1");
  const [countryFilter, setCountryFilter] = useState("all");
  const [expandedRow, setExpandedRow] = useState<number | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const countryParam = countryFilter !== "all" ? `&country=${countryFilter}` : "";
      const res = await fetch(
        `/api/linking/opportunities?days=${days}&min_impressions=30&max_winner_position=20&limit=100${countryParam}`
      );
      if (res.ok) {
        const data: OpportunitiesResponse = await res.json();
        setOpportunities(data.opportunities ?? []);
        setTotal(data.total ?? 0);
      } else {
        toast.error("Erreur chargement des opportunites");
      }
    } catch {
      toast.error("Erreur reseau");
    }
    setLoading(false);
  }, [days, countryFilter]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const countries = [
    ...new Set(opportunities.map((o) => o.country).filter(Boolean)),
  ].sort();

  // Stats
  const uniqueWinners = new Set(opportunities.map((o) => o.winner_domain)).size;
  const totalLinks = opportunities.reduce((s, o) => s + o.linking_sites.length, 0);

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
          <h1 className="text-2xl font-bold">Maillage Interne</h1>
          <p className="text-sm text-muted-foreground">
            Opportunites de liens cross-site pour pousser les meilleures positions
          </p>
        </div>
        <div className="flex gap-2 items-center">
          <Select value={countryFilter} onValueChange={setCountryFilter}>
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

          <Select value={days} onValueChange={setDays}>
            <SelectTrigger className="w-[110px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1">24 heures</SelectItem>
              <SelectItem value="7">7 jours</SelectItem>
              <SelectItem value="28">28 jours</SelectItem>
              <SelectItem value="90">3 mois</SelectItem>
            </SelectContent>
          </Select>

          <Button variant="outline" size="sm" onClick={fetchData}>
            <RefreshCw className="h-4 w-4 mr-1" />
            Refresh
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Opportunites
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{total}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Sites winners
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold flex items-center gap-2">
              <Trophy className="h-5 w-5 text-yellow-500" />
              {uniqueWinners}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Liens a creer
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold flex items-center gap-2">
              <Link2 className="h-5 w-5 text-blue-500" />
              {totalLinks}
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
            <div className="text-2xl font-bold">{countries.length}</div>
          </CardContent>
        </Card>
      </div>

      {/* How it works */}
      <Card>
        <CardContent className="py-4">
          <p className="text-sm text-muted-foreground">
            <strong>Comment ca marche :</strong> Pour chaque mot-cle, le site le mieux positionne est le &quot;winner&quot;.
            Les autres sites de la meme geo qui ont aussi du contenu sur ce mot-cle peuvent faire un lien interne
            vers la page du winner pour le pousser dans les SERPs.
            Cliquez sur une ligne pour voir les details.
          </p>
        </CardContent>
      </Card>

      {/* Opportunities Table */}
      {opportunities.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            Aucune opportunite trouvee pour ces filtres
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Link2 className="h-5 w-5" />
              Opportunites de liens ({opportunities.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Mot-cle</TableHead>
                  <TableHead>Pays</TableHead>
                  <TableHead>Winner</TableHead>
                  <TableHead className="text-right">Position</TableHead>
                  <TableHead className="text-right">Impressions</TableHead>
                  <TableHead className="text-right">Clicks</TableHead>
                  <TableHead className="text-right">Sites linkeurs</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {opportunities.map((opp, i) => (
                  <>
                    <TableRow
                      key={`${opp.query}-${opp.country}-${i}`}
                      className="cursor-pointer hover:bg-accent/50"
                      onClick={() => setExpandedRow(expandedRow === i ? null : i)}
                    >
                      <TableCell className="font-bold max-w-[200px]">
                        <div className="truncate">{opp.query}</div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          {getFlag(opp.country)} {opp.country}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Trophy className="h-3.5 w-3.5 text-yellow-500" />
                          <span className="font-medium text-sm">{opp.winner_domain}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <span className={
                          opp.winner_position <= 3 ? "text-green-600 font-bold"
                            : opp.winner_position <= 10 ? "text-blue-600 font-medium"
                              : "text-orange-600"
                        }>
                          #{opp.winner_position}
                        </span>
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {opp.winner_impressions.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right">
                        {opp.winner_clicks.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right">
                        <Badge variant="secondary" className="font-bold">
                          {opp.linking_sites.length} site{opp.linking_sites.length > 1 ? "s" : ""}
                        </Badge>
                      </TableCell>
                    </TableRow>

                    {/* Expanded detail */}
                    {expandedRow === i && (
                      <TableRow key={`detail-${i}`}>
                        <TableCell colSpan={7} className="bg-muted/30 p-4">
                          <div className="space-y-3">
                            {/* Winner page */}
                            <div className="flex items-center gap-2 text-sm">
                              <Trophy className="h-4 w-4 text-yellow-500" />
                              <span className="font-medium">Page cible (winner) :</span>
                              <a
                                href={opp.winner_page}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-blue-600 hover:underline flex items-center gap-1 truncate max-w-[500px]"
                              >
                                {extractDomain(opp.winner_page)}{extractPath(opp.winner_page)}
                                <ExternalLink className="h-3 w-3 flex-shrink-0" />
                              </a>
                            </div>

                            {/* Linking sites */}
                            <div className="text-sm font-medium flex items-center gap-1">
                              <ArrowRight className="h-4 w-4" />
                              Sites qui peuvent linker vers cette page :
                            </div>
                            <div className="grid gap-2 ml-5">
                              {opp.linking_sites.map((ls, j) => (
                                <div
                                  key={j}
                                  className="flex items-center gap-3 text-sm rounded-lg border p-3 bg-background"
                                >
                                  <span className="font-medium min-w-[200px]">{ls.domain}</span>
                                  <ArrowRight className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                                  <a
                                    href={ls.page}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-blue-600 hover:underline truncate flex items-center gap-1"
                                  >
                                    {extractPath(ls.page)}
                                    <ExternalLink className="h-3 w-3 flex-shrink-0" />
                                  </a>
                                  <span className="text-muted-foreground ml-auto flex-shrink-0">
                                    pos {ls.position} · {ls.impressions} imp
                                  </span>
                                </div>
                              ))}
                            </div>

                            <p className="text-xs text-muted-foreground mt-2">
                              Ajouter un lien avec l&apos;ancre &quot;<strong>{opp.query}</strong>&quot; depuis chaque page
                              linkeur vers{" "}
                              <span className="font-mono text-xs">{extractPath(opp.winner_page)}</span>
                            </p>
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

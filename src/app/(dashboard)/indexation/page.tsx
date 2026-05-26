"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FileSearch, ExternalLink, RefreshCw } from "lucide-react";
import { toast } from "sonner";

interface InspectionRow {
  url: string;
  verdict: string;
  coverage_state: string | null;
  page_fetch_state: string | null;
  inspected_at: string;
  sites: { id: string; domain: string; is_active: boolean } | null;
}

interface SiteSummary {
  site_id: string;
  domain: string;
  total: number;
  indexed: number;
  not_indexed: number;
  errors: number;
  last_inspected_at: string | null;
  not_indexed_urls: { url: string; verdict: string; coverage_state: string | null }[];
}

export default function IndexationPage() {
  const [siteSummaries, setSiteSummaries] = useState<SiteSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    const supabase = createClient();
    // `url_inspections` is not in the generated Supabase types yet, hence the cast.
    const sbAny = supabase as never as {
      from: (t: string) => {
        select: (cols: string) => {
          eq: (
            c: string,
            v: unknown
          ) => Promise<{ data: InspectionRow[] | null; error: { message: string } | null }>;
        };
      };
    };
    const { data, error } = await sbAny
      .from("url_inspections")
      .select(
        "url, verdict, coverage_state, page_fetch_state, inspected_at, sites!inner(id, domain, is_active)"
      )
      .eq("sites.is_active", true);

    if (error) {
      toast.error("Failed to load inspections: " + error.message);
      setLoading(false);
      return;
    }

    const bySite = new Map<string, SiteSummary>();
    for (const r of data ?? []) {
      if (!r.sites) continue;
      let acc = bySite.get(r.sites.id);
      if (!acc) {
        acc = {
          site_id: r.sites.id,
          domain: r.sites.domain,
          total: 0,
          indexed: 0,
          not_indexed: 0,
          errors: 0,
          last_inspected_at: null,
          not_indexed_urls: [],
        };
        bySite.set(r.sites.id, acc);
      }
      acc.total++;
      if (r.verdict === "PASS") acc.indexed++;
      else if (r.verdict === "ERROR") acc.errors++;
      else {
        acc.not_indexed++;
        acc.not_indexed_urls.push({
          url: r.url,
          verdict: r.verdict,
          coverage_state: r.coverage_state,
        });
      }
      if (!acc.last_inspected_at || r.inspected_at > acc.last_inspected_at) {
        acc.last_inspected_at = r.inspected_at;
      }
    }

    const arr = Array.from(bySite.values()).sort(
      (a, b) => b.not_indexed - a.not_indexed
    );
    setSiteSummaries(arr);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const totalUrls = siteSummaries.reduce((s, r) => s + r.total, 0);
  const totalIndexed = siteSummaries.reduce((s, r) => s + r.indexed, 0);
  const totalNotIndexed = siteSummaries.reduce((s, r) => s + r.not_indexed, 0);
  const globalRate =
    totalUrls > 0 ? Math.round((totalIndexed / totalUrls) * 1000) / 10 : 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <FileSearch className="h-6 w-6" />
            Indexation (vrai verdict GSC)
          </h1>
          <p className="text-sm text-muted-foreground">
            Source de v&eacute;rit&eacute;: API Google urlInspection. Pas d&apos;inf&eacute;rence
            impressions.
          </p>
        </div>
        <Button onClick={fetchData} variant="outline" size="sm">
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Sites suivis
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{siteSummaries.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              URLs inspect&eacute;es
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalUrls}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Non indexes
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-orange-600">
              {totalNotIndexed}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Taux global
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{globalRate}%</div>
          </CardContent>
        </Card>
      </div>

      {loading && (
        <div className="text-center text-muted-foreground py-8">Loading...</div>
      )}

      {!loading && siteSummaries.length === 0 && (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            Aucune donn&eacute;e. Lance le cron{" "}
            <code className="text-xs bg-muted px-1 py-0.5 rounded">
              /api/cron/inspect-urls
            </code>{" "}
            pour peupler la table.
          </CardContent>
        </Card>
      )}

      {!loading &&
        siteSummaries.map((site) => {
          const rate =
            site.total > 0
              ? Math.round((site.indexed / site.total) * 1000) / 10
              : 0;
          const isOpen = expanded === site.site_id;
          return (
            <Card key={site.site_id}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">{site.domain}</CardTitle>
                  <div className="flex items-center gap-2 text-sm">
                    <Badge variant="outline">
                      {site.indexed}/{site.total} indexes
                    </Badge>
                    {site.not_indexed > 0 && (
                      <Badge variant="destructive">
                        {site.not_indexed} non indexes
                      </Badge>
                    )}
                    <span className="text-muted-foreground">{rate}%</span>
                    {site.not_indexed > 0 && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          setExpanded(isOpen ? null : site.site_id)
                        }
                      >
                        {isOpen ? "Hide" : "Voir URLs"}
                      </Button>
                    )}
                  </div>
                </div>
                {site.last_inspected_at && (
                  <p className="text-xs text-muted-foreground">
                    Inspecte le{" "}
                    {new Date(site.last_inspected_at).toLocaleString("fr-FR")}
                  </p>
                )}
              </CardHeader>
              {isOpen && site.not_indexed_urls.length > 0 && (
                <CardContent>
                  <div className="space-y-2">
                    {site.not_indexed_urls.map((u) => (
                      <div
                        key={u.url}
                        className="flex items-center justify-between rounded border p-2 text-sm"
                      >
                        <div className="flex-1 min-w-0">
                          <a
                            href={u.url}
                            target="_blank"
                            rel="noreferrer"
                            className="font-mono text-xs truncate block hover:underline"
                          >
                            {u.url}
                          </a>
                          {u.coverage_state && (
                            <span className="text-xs text-muted-foreground">
                              {u.coverage_state}
                            </span>
                          )}
                        </div>
                        <Badge variant="secondary" className="ml-2">
                          {u.verdict}
                        </Badge>
                        <a
                          href={u.url}
                          target="_blank"
                          rel="noreferrer"
                          className="ml-2 text-muted-foreground hover:text-foreground"
                        >
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      </div>
                    ))}
                  </div>
                </CardContent>
              )}
            </Card>
          );
        })}
    </div>
  );
}

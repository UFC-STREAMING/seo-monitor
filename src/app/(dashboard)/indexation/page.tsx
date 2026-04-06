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
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { FileWarning, RefreshCw, CheckCircle, Search, Globe, AlertTriangle, Clock, Package } from "lucide-react";
import { toast } from "sonner";

interface SiteStats {
  site_id: string;
  domain: string;
  total_pages: number;
  indexed: number;
  not_indexed: number;
  submitted: number;
  unknown: number;
  recently_submitted_7d: number;
  webhook_pages: WebhookPage[];
}

interface WebhookPage {
  url: string;
  product_name: string | null;
  created_at: string;
  submitted_at: string | null;
  indexed_at: string | null;
  index_status: string;
  days_to_index: number | null;
}

interface DeindexedRow {
  id: string;
  url: string;
  status: string;
  detected_at: string;
  reindexed_at: string | null;
  indexer_task_id: string | null;
  site_domain: string;
  keyword_text: string;
}

interface IndexerTaskRow {
  id: string;
  task_id: string;
  status: string;
  urls: string[];
  created_at: string;
  completed_at: string | null;
}

interface SitePageRow {
  id: string;
  url: string;
  source: string;
  index_status: string;
  last_checked_at: string | null;
  site_domain: string;
}

interface SiteOption {
  id: string;
  domain: string;
}

export default function IndexationPage() {
  const [deindexed, setDeindexed] = useState<DeindexedRow[]>([]);
  const [tasks, setTasks] = useState<IndexerTaskRow[]>([]);
  const [pages, setPages] = useState<SitePageRow[]>([]);
  const [sites, setSites] = useState<SiteOption[]>([]);
  const [siteStats, setSiteStats] = useState<SiteStats[]>([]);
  const [credits, setCredits] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [selectedSite, setSelectedSite] = useState<string>("all");
  const [manualUrls, setManualUrls] = useState("");
  const [filterStatus, setFilterStatus] = useState<string>("not_indexed");

  const fetchData = useCallback(async () => {
    const supabase = createClient();

    const [{ data: deindexData }, { data: taskData }, { data: siteData }, { data: pageData }] =
      await Promise.all([
        supabase
          .from("deindexed_urls")
          .select("*, sites(domain), keywords(keyword)")
          .order("detected_at", { ascending: false }),
        supabase
          .from("indexer_tasks")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(20),
        supabase.from("sites").select("id, domain").order("domain"),
        supabase
          .from("site_pages")
          .select("id, url, source, index_status, last_checked_at, site_id, sites(domain)")
          .order("index_status")
          .order("url"),
      ]);

    setDeindexed(
      (deindexData ?? []).map((d) => ({
        id: d.id,
        url: d.url,
        status: d.status,
        detected_at: d.detected_at,
        reindexed_at: d.reindexed_at,
        indexer_task_id: d.indexer_task_id,
        site_domain: (d.sites as unknown as { domain: string })?.domain ?? "",
        keyword_text: (d.keywords as unknown as { keyword: string })?.keyword ?? "",
      }))
    );

    setTasks(
      (taskData ?? []).map((t) => ({
        id: t.id,
        task_id: t.task_id,
        status: t.status,
        urls: t.urls,
        created_at: t.created_at,
        completed_at: t.completed_at,
      }))
    );

    setSites((siteData ?? []).map((s) => ({ id: s.id, domain: s.domain })));

    setPages(
      (pageData ?? []).map((p) => ({
        id: p.id,
        url: p.url,
        source: p.source,
        index_status: p.index_status,
        last_checked_at: p.last_checked_at,
        site_domain: (p.sites as unknown as { domain: string })?.domain ?? "",
      }))
    );

    try {
      const res = await fetch("/api/indexer/credits");
      if (res.ok) {
        const data = await res.json();
        setCredits(data.remaining);
      }
    } catch {
      // ignore
    }

    // Fetch indexation stats per site
    try {
      const statsRes = await fetch("/api/indexation/stats");
      if (statsRes.ok) {
        const data = await statsRes.json();
        setSiteStats(Array.isArray(data) ? data : []);
      }
    } catch {
      // ignore
    }

    setLoading(false);
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  async function handleReindexAll() {
    setSubmitting(true);
    try {
      const detectedUrls = [...new Set(
        deindexed
          .filter((d) => d.status === "detected")
          .map((d) => d.url)
      )];

      if (detectedUrls.length === 0) {
        toast.info("No URLs to reindex");
        return;
      }

      const res = await fetch("/api/indexer/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ urls: detectedUrls }),
      });

      if (!res.ok) throw new Error("Failed to submit");

      toast.success(`Submitted ${detectedUrls.length} URLs for reindexation`);
      fetchData();
    } catch {
      toast.error("Failed to submit URLs for reindexation");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleReindexSingle(url: string) {
    try {
      const res = await fetch("/api/indexer/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ urls: [url] }),
      });

      if (!res.ok) throw new Error("Failed");

      toast.success("URL submitted for reindexation");
      fetchData();
    } catch {
      toast.error("Failed to submit URL");
    }
  }

  async function handleScan(method: "gsc" | "rapid") {
    if (selectedSite === "all") {
      toast.error("Please select a specific site to scan");
      return;
    }

    setScanning(true);
    try {
      const body: Record<string, unknown> = {
        siteId: selectedSite,
        method,
      };

      if (manualUrls.trim()) {
        body.urls = manualUrls
          .split("\n")
          .map((u) => u.trim())
          .filter(Boolean);
      }

      const res = await fetch("/api/indexation/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error || "Scan failed");
        return;
      }

      if (method === "gsc") {
        toast.success(
          `GSC check complete: ${data.indexed} indexed, ${data.notIndexed} not indexed`
        );
      } else {
        toast.success(data.message || `Submitted ${data.urlsSubmitted} URLs for checking`);
      }

      setManualUrls("");
      fetchData();
    } catch {
      toast.error("Scan failed");
    } finally {
      setScanning(false);
    }
  }

  async function handleReindexNotIndexed() {
    const notIndexedUrls = [...new Set(
      filteredPages
        .filter((p) => p.index_status === "not_indexed")
        .map((p) => p.url)
    )];

    if (notIndexedUrls.length === 0) {
      toast.info("No not-indexed URLs to reindex");
      return;
    }

    try {
      const res = await fetch("/api/indexer/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ urls: notIndexedUrls }),
      });

      if (!res.ok) throw new Error("Failed");

      toast.success(`Submitted ${notIndexedUrls.length} URLs for reindexation`);
      fetchData();
    } catch {
      toast.error("Failed to submit URLs");
    }
  }

  const detectedCount = deindexed.filter((d) => d.status === "detected").length;
  const submittedCount = deindexed.filter((d) => d.status === "reindex_submitted").length;
  const reindexedCount = deindexed.filter((d) => d.status === "reindexed").length;

  // Separate missing pages from regular pages
  const missingPages = pages.filter((p) => p.source === "missing");
  const regularPages = pages.filter((p) => p.source !== "missing");

  const filteredMissing = missingPages.filter((p) => {
    if (selectedSite !== "all" && !sites.find((s) => s.id === selectedSite && s.domain === p.site_domain))
      return false;
    return true;
  });

  const filteredPages = regularPages.filter((p) => {
    if (selectedSite !== "all" && !sites.find((s) => s.id === selectedSite && s.domain === p.site_domain))
      return false;
    if (filterStatus !== "all" && p.index_status !== filterStatus) return false;
    return true;
  });

  const pageStats = {
    total: filteredPages.length,
    indexed: filteredPages.filter((p) => p.index_status === "indexed").length,
    notIndexed: filteredPages.filter((p) => p.index_status === "not_indexed").length,
    unknown: filteredPages.filter((p) => p.index_status === "unknown" || p.index_status === "checking").length,
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Indexation Center</h1>
        <div className="flex items-center gap-4">
          {credits !== null && (
            <span className="text-sm text-muted-foreground">
              Rapid Indexer credits: <strong>{credits}</strong>
            </span>
          )}
          <Button
            onClick={handleReindexAll}
            disabled={submitting || detectedCount === 0}
          >
            <RefreshCw className={`mr-2 h-4 w-4 ${submitting ? "animate-spin" : ""}`} />
            Reindex All ({detectedCount})
          </Button>
        </div>
      </div>

      {/* Per-Site Indexation Stats */}
      {siteStats.length > 0 && (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {siteStats.map((s) => (
            <Card key={s.site_id}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium truncate">
                  {s.domain}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-4 gap-2 text-center">
                  <div>
                    <div className="text-lg font-bold">{s.total_pages}</div>
                    <div className="text-xs text-muted-foreground">Total</div>
                  </div>
                  <div>
                    <div className="text-lg font-bold text-green-600">{s.indexed}</div>
                    <div className="text-xs text-muted-foreground">Indexed</div>
                  </div>
                  <div>
                    <div className="text-lg font-bold text-destructive">{s.not_indexed}</div>
                    <div className="text-xs text-muted-foreground">Not Idx</div>
                  </div>
                  <div>
                    <div className="text-lg font-bold text-orange-500">{s.submitted}</div>
                    <div className="text-xs text-muted-foreground">Submitted</div>
                  </div>
                </div>
                {s.recently_submitted_7d > 0 && (
                  <p className="text-xs text-muted-foreground mt-2">
                    {s.recently_submitted_7d} soumis ces 7 derniers jours
                  </p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Product Timeline (webhook pages) */}
      {siteStats.some((s) => s.webhook_pages.length > 0) && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Package className="h-5 w-5" />
              Timeline Produits (via Nutra Factory)
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              Suivi des fiches produits depuis leur creation jusqu&apos;a leur indexation
            </p>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Produit</TableHead>
                  <TableHead>Site</TableHead>
                  <TableHead>Recu</TableHead>
                  <TableHead>Soumis</TableHead>
                  <TableHead>Indexe</TableHead>
                  <TableHead>Delai</TableHead>
                  <TableHead>Statut</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {siteStats.flatMap((s) =>
                  s.webhook_pages.map((wp, i) => {
                    const daysSinceSubmit = wp.submitted_at
                      ? Math.round(
                          (Date.now() - new Date(wp.submitted_at).getTime()) /
                            (1000 * 60 * 60 * 24)
                        )
                      : 0;
                    const isStale =
                      wp.index_status !== "indexed" && daysSinceSubmit > 7;

                    return (
                      <TableRow key={`${s.site_id}-${i}`}>
                        <TableCell className="font-medium">
                          {wp.product_name ?? (
                            <span className="text-muted-foreground text-xs truncate max-w-[200px] block">
                              {wp.url}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-sm">{s.domain}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {new Date(wp.created_at).toLocaleDateString()}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {wp.submitted_at
                            ? new Date(wp.submitted_at).toLocaleDateString()
                            : "-"}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {wp.indexed_at
                            ? new Date(wp.indexed_at).toLocaleDateString()
                            : "-"}
                        </TableCell>
                        <TableCell className="text-xs">
                          {wp.days_to_index !== null ? (
                            <span className="text-green-600">{wp.days_to_index}j</span>
                          ) : wp.submitted_at ? (
                            <span className="text-muted-foreground">
                              {daysSinceSubmit}j...
                            </span>
                          ) : (
                            "-"
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              wp.index_status === "indexed"
                                ? "outline"
                                : isStale
                                  ? "destructive"
                                  : "secondary"
                            }
                            className={
                              wp.index_status === "indexed"
                                ? "text-green-600"
                                : isStale
                                  ? ""
                                  : "text-yellow-600"
                            }
                          >
                            {wp.index_status === "indexed" && (
                              <CheckCircle className="mr-1 h-3 w-3" />
                            )}
                            {isStale && (
                              <Clock className="mr-1 h-3 w-3" />
                            )}
                            {wp.index_status}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Deindex Stats */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Detected</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-destructive">{detectedCount}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Submitted</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-orange-500">{submittedCount}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Reindexed</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">{reindexedCount}</div>
          </CardContent>
        </Card>
      </div>

      {/* Deindexed URLs table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileWarning className="h-5 w-5" />
            Deindexed URLs (Keyword Tracker)
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-center text-muted-foreground">Loading...</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>URL</TableHead>
                  <TableHead>Site</TableHead>
                  <TableHead>Keyword</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Detected</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {deindexed.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell className="max-w-xs truncate font-mono text-xs">
                      {d.url}
                    </TableCell>
                    <TableCell>{d.site_domain}</TableCell>
                    <TableCell>{d.keyword_text}</TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          d.status === "detected"
                            ? "destructive"
                            : d.status === "reindex_submitted"
                              ? "secondary"
                              : "outline"
                        }
                      >
                        {d.status === "reindexed" && (
                          <CheckCircle className="mr-1 h-3 w-3" />
                        )}
                        {d.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(d.detected_at).toLocaleDateString()}
                    </TableCell>
                    <TableCell>
                      {d.status === "detected" && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleReindexSingle(d.url)}
                        >
                          <RefreshCw className="mr-1 h-3 w-3" />
                          Reindex
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {deindexed.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground">
                      No deindexed URLs detected
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Missing Pages Section */}
      {filteredMissing.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-orange-500" />
              Missing Pages ({filteredMissing.length})
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              Keywords hors top 100 sans page produit correspondante dans le sitemap. Ces contenus doivent être créés.
            </p>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Site</TableHead>
                  <TableHead>Product / Keyword</TableHead>
                  <TableHead>Expected URL</TableHead>
                  <TableHead>Detected</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredMissing.map((p) => {
                  // Extract keyword from the expected URL slug
                  const slug = p.url.split("/").filter(Boolean).pop() ?? "";
                  const keyword = slug.replace(/-/g, " ");
                  return (
                    <TableRow key={p.id}>
                      <TableCell className="font-medium">{p.site_domain}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-orange-600 border-orange-300">
                          {keyword}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {p.url}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {p.last_checked_at
                          ? new Date(p.last_checked_at).toLocaleDateString()
                          : "-"}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Sitemap Scanner Section */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Search className="h-5 w-5" />
            Sitemap Scanner
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-1">
              <label className="text-sm font-medium">Site</label>
              <Select value={selectedSite} onValueChange={setSelectedSite}>
                <SelectTrigger className="w-64">
                  <SelectValue placeholder="Select site" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All sites</SelectItem>
                  {sites.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.domain}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Button
              onClick={() => handleScan("gsc")}
              disabled={scanning || selectedSite === "all"}
              variant="default"
            >
              <Globe className={`mr-2 h-4 w-4 ${scanning ? "animate-spin" : ""}`} />
              {scanning ? "Scanning..." : "GSC Check"}
            </Button>

            <Button
              onClick={() => handleScan("rapid")}
              disabled={scanning || selectedSite === "all"}
              variant="outline"
            >
              <RefreshCw className={`mr-2 h-4 w-4 ${scanning ? "animate-spin" : ""}`} />
              Quick Scan (Rapid Indexer)
            </Button>
          </div>

          {/* Manual URL input */}
          <div className="space-y-1">
            <label className="text-sm font-medium">
              Manual URLs (optional - one per line)
            </label>
            <Textarea
              placeholder="https://example.com/page1&#10;https://example.com/page2"
              value={manualUrls}
              onChange={(e) => setManualUrls(e.target.value)}
              rows={3}
            />
          </div>

          {/* Page Stats */}
          <div className="grid gap-4 md:grid-cols-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Total Pages</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{pageStats.total}</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Indexed</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-green-600">{pageStats.indexed}</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Not Indexed</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-destructive">{pageStats.notIndexed}</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Unknown</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-muted-foreground">{pageStats.unknown}</div>
              </CardContent>
            </Card>
          </div>

          {/* Filter + Reindex button */}
          <div className="flex items-center gap-4">
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="w-48">
                <SelectValue placeholder="Filter by status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="indexed">Indexed</SelectItem>
                <SelectItem value="not_indexed">Not Indexed</SelectItem>
                <SelectItem value="unknown">Unknown</SelectItem>
              </SelectContent>
            </Select>

            {pageStats.notIndexed > 0 && (
              <Button variant="destructive" onClick={handleReindexNotIndexed}>
                <RefreshCw className="mr-2 h-4 w-4" />
                Reindex Not Indexed ({pageStats.notIndexed})
              </Button>
            )}
          </div>

          {/* Pages table */}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>URL</TableHead>
                <TableHead>Site</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Last Checked</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredPages.slice(0, 100).map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="max-w-md truncate font-mono text-xs">
                    {p.url}
                  </TableCell>
                  <TableCell className="text-sm">{p.site_domain}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-xs">
                      {p.source}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        p.index_status === "indexed"
                          ? "outline"
                          : p.index_status === "not_indexed"
                            ? "destructive"
                            : "secondary"
                      }
                      className={p.index_status === "indexed" ? "text-green-600" : ""}
                    >
                      {p.index_status === "indexed" && (
                        <CheckCircle className="mr-1 h-3 w-3" />
                      )}
                      {p.index_status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {p.last_checked_at
                      ? new Date(p.last_checked_at).toLocaleString()
                      : "-"}
                  </TableCell>
                </TableRow>
              ))}
              {filteredPages.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground">
                    No pages scanned yet. Select a site and click scan.
                  </TableCell>
                </TableRow>
              )}
              {filteredPages.length > 100 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground">
                    Showing 100 of {filteredPages.length} pages
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Indexer tasks history */}
      <Card>
        <CardHeader>
          <CardTitle>Rapid Indexer Tasks</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Task ID</TableHead>
                <TableHead>URLs</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Completed</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tasks.map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="font-mono text-xs">{t.task_id}</TableCell>
                  <TableCell>{t.urls.length}</TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        t.status === "completed"
                          ? "outline"
                          : t.status === "failed"
                            ? "destructive"
                            : "secondary"
                      }
                    >
                      {t.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs">
                    {new Date(t.created_at).toLocaleString()}
                  </TableCell>
                  <TableCell className="text-xs">
                    {t.completed_at
                      ? new Date(t.completed_at).toLocaleString()
                      : "-"}
                  </TableCell>
                </TableRow>
              ))}
              {tasks.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground">
                    No indexer tasks yet
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

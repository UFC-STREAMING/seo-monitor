import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Globe,
  Shield,
  Server,
  Activity,
  ArrowLeft,
  RefreshCw,
  Clock,
  CheckCircle,
  XCircle,
  AlertTriangle,
} from "lucide-react";
import { AddKeywordDialog } from "@/components/sites/add-keyword-dialog";
import type {
  Keyword,
  DeindexedUrl,
  TechnicalAudit,
  Location,
} from "@/types/database";

interface KeywordWithDetails extends Keyword {
  locations: Location;
}

function getHealthScore(audit: TechnicalAudit | null): number {
  if (!audit) return 0;
  let score = 0;
  if (audit.has_ssl) score += 25;
  if (audit.http_status && audit.http_status >= 200 && audit.http_status < 300) score += 25;
  if (audit.robots_txt_status === "ok" || audit.robots_txt_status === "found") score += 25;
  if (audit.sitemap_status === "ok" || audit.sitemap_status === "found") score += 25;
  return score;
}

function getHealthColor(score: number) {
  if (score >= 75) return "text-green-600";
  if (score >= 50) return "text-yellow-600";
  return "text-destructive";
}

export default async function SiteDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  // Fetch site
  const { data: site, error: siteError } = await supabase
    .from("sites")
    .select("*")
    .eq("id", id)
    .single();

  if (siteError || !site) {
    notFound();
  }

  // Fetch keywords with locations
  const { data: keywords } = await supabase
    .from("keywords")
    .select("*, locations(*)")
    .eq("site_id", id)
    .order("keyword");

  const keywordsWithDetails: KeywordWithDetails[] = (keywords ?? []).map(
    (k) => ({
      ...k,
      locations: k.locations as unknown as Location,
    })
  );

  // Fetch deindexed URLs
  const { data: deindexedUrls } = await supabase
    .from("deindexed_urls")
    .select("*")
    .eq("site_id", id)
    .order("detected_at", { ascending: false });

  // Fetch latest technical audit
  const { data: audits } = await supabase
    .from("technical_audits")
    .select("*")
    .eq("site_id", id)
    .order("checked_at", { ascending: false })
    .limit(1);

  const latestAudit = audits?.[0] ?? null;
  const healthScore = getHealthScore(latestAudit);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link href="/sites">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-bold">{site.domain}</h1>
            {site.is_active ? (
              <Badge className="bg-green-600 hover:bg-green-700">Active</Badge>
            ) : (
              <Badge variant="secondary">Inactive</Badge>
            )}
          </div>
          <div className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
            <Badge variant="outline" className="capitalize">
              {site.niche}
            </Badge>
            <Badge variant="secondary" className="uppercase">
              {site.site_type}
            </Badge>
            {site.ip && <span>IP: {site.ip}</span>}
            {site.hosting && <span>Hosting: {site.hosting}</span>}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="keywords">
            Keywords ({keywordsWithDetails.length})
          </TabsTrigger>
          <TabsTrigger value="indexation">
            Indexation ({deindexedUrls?.length ?? 0})
          </TabsTrigger>
          <TabsTrigger value="technical">Technical</TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="space-y-6">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Domain</CardTitle>
                <Globe className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-lg font-bold">{site.domain}</div>
                <p className="text-xs text-muted-foreground capitalize">
                  {site.niche} / {site.site_type}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">SSL Status</CardTitle>
                <Shield className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                {latestAudit?.has_ssl ? (
                  <div className="flex items-center gap-2">
                    <CheckCircle className="h-5 w-5 text-green-600" />
                    <span className="text-lg font-bold text-green-600">
                      Secure
                    </span>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <XCircle className="h-5 w-5 text-destructive" />
                    <span className="text-lg font-bold text-destructive">
                      {latestAudit ? "Not Secure" : "Unknown"}
                    </span>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">
                  HTTP Status
                </CardTitle>
                <Server className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-lg font-bold">
                  {latestAudit?.http_status ?? "N/A"}
                </div>
                {latestAudit?.http_status && (
                  <p className="text-xs text-muted-foreground">
                    {latestAudit.http_status >= 200 &&
                    latestAudit.http_status < 300
                      ? "OK"
                      : latestAudit.http_status >= 300 &&
                          latestAudit.http_status < 400
                        ? "Redirect"
                        : "Error"}
                  </p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">
                  Health Score
                </CardTitle>
                <Activity className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div
                  className={`text-2xl font-bold ${getHealthColor(healthScore)}`}
                >
                  {healthScore}%
                </div>
                <p className="text-xs text-muted-foreground">
                  Based on latest audit
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Site details */}
          <Card>
            <CardHeader>
              <CardTitle>Site Details</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-3">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">
                      Domain
                    </p>
                    <p className="font-medium">{site.domain}</p>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">
                      Niche
                    </p>
                    <p className="capitalize">{site.niche}</p>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">
                      Type
                    </p>
                    <p className="uppercase">{site.site_type}</p>
                  </div>
                </div>
                <div className="space-y-3">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">
                      IP Address
                    </p>
                    <p>{site.ip ?? "Not set"}</p>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">
                      Hosting
                    </p>
                    <p>{site.hosting ?? "Not set"}</p>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">
                      Added
                    </p>
                    <p>{new Date(site.created_at).toLocaleDateString()}</p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Keywords Tab */}
        <TabsContent value="keywords" className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">
              Keywords ({keywordsWithDetails.length})
            </h2>
            <AddKeywordDialog siteId={id} />
          </div>

          {keywordsWithDetails.length > 0 ? (
            <div className="rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Keyword</TableHead>
                    <TableHead>Country</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {keywordsWithDetails.map((kw) => (
                    <TableRow key={kw.id}>
                      <TableCell className="font-medium">
                        {kw.keyword}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          {kw.locations?.country_iso ?? "?"}{" "}
                          {kw.locations?.name ?? "Unknown"}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-12">
              <p className="mb-2 text-lg font-medium">No keywords yet</p>
              <p className="mb-4 text-sm text-muted-foreground">
                Keywords are used for GSC auto-detection
              </p>
              <AddKeywordDialog siteId={id} />
            </div>
          )}
        </TabsContent>

        {/* Indexation Tab */}
        <TabsContent value="indexation" className="space-y-4">
          <h2 className="text-xl font-semibold">
            Deindexed URLs ({deindexedUrls?.length ?? 0})
          </h2>

          {deindexedUrls && deindexedUrls.length > 0 ? (
            <div className="space-y-3">
              {deindexedUrls.map((url) => (
                <div
                  key={url.id}
                  className="flex items-center justify-between rounded-lg border p-4"
                >
                  <div className="flex-1">
                    <p className="font-medium break-all">{url.url}</p>
                    <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                      <Clock className="h-3 w-3" />
                      Detected: {new Date(url.detected_at).toLocaleDateString()}
                      {url.reindexed_at && (
                        <>
                          {" "}| Reindexed:{" "}
                          {new Date(url.reindexed_at).toLocaleDateString()}
                        </>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge
                      variant={
                        url.status === "detected"
                          ? "destructive"
                          : url.status === "reindex_submitted"
                            ? "secondary"
                            : "default"
                      }
                    >
                      {url.status === "detected" && (
                        <AlertTriangle className="mr-1 h-3 w-3" />
                      )}
                      {url.status === "reindexed" && (
                        <CheckCircle className="mr-1 h-3 w-3" />
                      )}
                      {url.status.replace("_", " ")}
                    </Badge>
                    {url.status === "detected" && (
                      <Button size="sm" variant="outline">
                        <RefreshCw className="h-3 w-3" />
                        Reindex
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-12">
              <CheckCircle className="mb-4 h-12 w-12 text-green-600" />
              <p className="mb-2 text-lg font-medium">All URLs indexed</p>
              <p className="text-sm text-muted-foreground">
                No deindexed URLs detected for this site
              </p>
            </div>
          )}
        </TabsContent>

        {/* Technical Tab */}
        <TabsContent value="technical" className="space-y-4">
          <h2 className="text-xl font-semibold">Technical Audit</h2>

          {latestAudit ? (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Last checked:{" "}
                {new Date(latestAudit.checked_at).toLocaleString()}
              </p>

              <div className="grid gap-4 md:grid-cols-2">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium">
                      HTTP Status
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center gap-2">
                      {latestAudit.http_status &&
                      latestAudit.http_status >= 200 &&
                      latestAudit.http_status < 300 ? (
                        <CheckCircle className="h-5 w-5 text-green-600" />
                      ) : (
                        <XCircle className="h-5 w-5 text-destructive" />
                      )}
                      <span className="text-2xl font-bold">
                        {latestAudit.http_status ?? "N/A"}
                      </span>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium">
                      SSL Certificate
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center gap-2">
                      {latestAudit.has_ssl ? (
                        <CheckCircle className="h-5 w-5 text-green-600" />
                      ) : (
                        <XCircle className="h-5 w-5 text-destructive" />
                      )}
                      <span className="text-2xl font-bold">
                        {latestAudit.has_ssl ? "Valid" : "Missing"}
                      </span>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium">
                      Robots.txt
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center gap-2">
                      {latestAudit.robots_txt_status === "ok" ||
                      latestAudit.robots_txt_status === "found" ? (
                        <CheckCircle className="h-5 w-5 text-green-600" />
                      ) : (
                        <AlertTriangle className="h-5 w-5 text-yellow-600" />
                      )}
                      <span className="text-lg font-bold capitalize">
                        {latestAudit.robots_txt_status ?? "Unknown"}
                      </span>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium">
                      Sitemap
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center gap-2">
                      {latestAudit.sitemap_status === "ok" ||
                      latestAudit.sitemap_status === "found" ? (
                        <CheckCircle className="h-5 w-5 text-green-600" />
                      ) : (
                        <AlertTriangle className="h-5 w-5 text-yellow-600" />
                      )}
                      <span className="text-lg font-bold capitalize">
                        {latestAudit.sitemap_status ?? "Unknown"}
                      </span>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium">
                      Meta Robots
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <span className="text-lg font-bold">
                      {latestAudit.meta_robots ?? "Not set"}
                    </span>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium">
                      Load Time
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center gap-2">
                      {latestAudit.load_time_ms != null ? (
                        <>
                          {latestAudit.load_time_ms < 1000 ? (
                            <CheckCircle className="h-5 w-5 text-green-600" />
                          ) : latestAudit.load_time_ms < 3000 ? (
                            <AlertTriangle className="h-5 w-5 text-yellow-600" />
                          ) : (
                            <XCircle className="h-5 w-5 text-destructive" />
                          )}
                          <span className="text-2xl font-bold">
                            {latestAudit.load_time_ms}ms
                          </span>
                        </>
                      ) : (
                        <span className="text-lg text-muted-foreground">
                          N/A
                        </span>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-12">
              <Server className="mb-4 h-12 w-12 text-muted-foreground" />
              <p className="mb-2 text-lg font-medium">No audit data</p>
              <p className="text-sm text-muted-foreground">
                No technical audit has been run for this site yet
              </p>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

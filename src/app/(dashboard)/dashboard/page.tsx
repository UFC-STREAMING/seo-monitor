import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Globe,
  AlertTriangle,
  FileWarning,
  TrendingUp,
} from "lucide-react";
import Link from "next/link";

export default async function DashboardPage() {
  const supabase = await createClient();

  const [
    { count: sitesCount },
    { count: alertsCount },
    { data: deindexed },
    { data: recentAlerts },
    { data: sites },
  ] = await Promise.all([
    supabase.from("sites").select("*", { count: "exact", head: true }).eq("is_active", true),
    supabase.from("alerts").select("*", { count: "exact", head: true }).eq("is_read", false),
    supabase.from("deindexed_urls").select("*").neq("status", "reindexed"),
    supabase.from("alerts").select("*, sites(domain)").order("created_at", { ascending: false }).limit(10),
    supabase.from("sites").select("*, keywords(count), deindexed_urls(count)").eq("is_active", true).order("domain"),
  ]);

  const deindexedCount = deindexed?.length ?? 0;

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Dashboard</h1>

      {/* Stats cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Sites</CardTitle>
            <Globe className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{sitesCount ?? 0}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Deindexed URLs</CardTitle>
            <FileWarning className="h-4 w-4 text-destructive" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-destructive">
              {deindexedCount}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Unread Alerts</CardTitle>
            <AlertTriangle className="h-4 w-4 text-orange-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-orange-500">
              {alertsCount ?? 0}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Keywords Tracked</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {sites?.reduce((acc, s) => acc + ((s.keywords as unknown as { count: number }[])?.[0]?.count ?? 0), 0) ?? 0}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Deindexed URLs - Critical section */}
      {deindexedCount > 0 && (
        <Card className="border-destructive">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-destructive">
              <FileWarning className="h-5 w-5" />
              URLs Deindexed - Action Required
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {deindexed?.slice(0, 5).map((d) => (
                <div
                  key={d.id}
                  className="flex items-center justify-between rounded-lg border p-3"
                >
                  <div>
                    <p className="font-medium">{d.url}</p>
                  </div>
                  <Badge
                    variant={
                      d.status === "detected"
                        ? "destructive"
                        : "secondary"
                    }
                  >
                    {d.status}
                  </Badge>
                </div>
              ))}
              {deindexedCount > 5 && (
                <Link
                  href="/indexation"
                  className="text-sm text-primary hover:underline"
                >
                  View all {deindexedCount} deindexed URLs
                </Link>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Sites grid */}
      <div>
        <h2 className="mb-4 text-xl font-semibold">Sites</h2>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {sites?.map((site) => {
            const deindexCount = (site.deindexed_urls as unknown as { count: number }[])?.[0]?.count ?? 0;
            const kwCount = (site.keywords as unknown as { count: number }[])?.[0]?.count ?? 0;
            const status = deindexCount > 0 ? "destructive" : "default";

            return (
              <Link key={site.id} href={`/sites/${site.id}`}>
                <Card className="transition-colors hover:bg-accent">
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base">{site.domain}</CardTitle>
                      <div className="flex gap-1">
                        <Badge variant="outline">{site.niche}</Badge>
                        <Badge variant="outline">{site.site_type}</Badge>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center gap-4 text-sm text-muted-foreground">
                      <span>{kwCount} keywords</span>
                      {deindexCount > 0 && (
                        <Badge variant={status}>
                          {deindexCount} deindexed
                        </Badge>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}

          {(!sites || sites.length === 0) && (
            <Card className="col-span-full">
              <CardContent className="flex flex-col items-center justify-center py-8">
                <Globe className="mb-4 h-12 w-12 text-muted-foreground" />
                <p className="mb-2 text-lg font-medium">No sites yet</p>
                <Link
                  href="/sites"
                  className="text-primary hover:underline"
                >
                  Add your first site
                </Link>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Recent alerts */}
      <div>
        <h2 className="mb-4 text-xl font-semibold">Recent Alerts</h2>
        <Card>
          <CardContent className="pt-6">
            {recentAlerts && recentAlerts.length > 0 ? (
              <div className="space-y-3">
                {recentAlerts.map((alert) => (
                  <div
                    key={alert.id}
                    className="flex items-center justify-between rounded-lg border p-3"
                  >
                    <div className="flex items-center gap-3">
                      <Badge
                        variant={
                          alert.severity === "critical"
                            ? "destructive"
                            : alert.severity === "warning"
                              ? "secondary"
                              : "outline"
                        }
                      >
                        {alert.severity}
                      </Badge>
                      <div>
                        <p className="text-sm font-medium">{alert.message}</p>
                        <p className="text-xs text-muted-foreground">
                          {(alert.sites as unknown as { domain: string })?.domain} &middot;{" "}
                          {new Date(alert.created_at).toLocaleDateString()}
                        </p>
                      </div>
                    </div>
                    <Badge variant="outline">{alert.alert_type}</Badge>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-center text-muted-foreground">
                No alerts yet
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Globe,
  AlertTriangle,
  TrendingUp,
  BarChart3,
} from "lucide-react";
import Link from "next/link";

export default async function DashboardPage() {
  const supabase = await createClient();

  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const sevenDaysAgoIso = sevenDaysAgo.toISOString();

  const [
    { count: sitesCount },
    { count: alertsCount },
    { count: propertiesCount },
    { data: recentAlerts },
    { data: sites },
  ] = await Promise.all([
    supabase.from("sites").select("*", { count: "exact", head: true }).eq("is_active", true),
    supabase
      .from("alerts")
      .select("*", { count: "exact", head: true })
      .eq("is_read", false)
      .gte("created_at", sevenDaysAgoIso),
    supabase.from("gsc_properties").select("*", { count: "exact", head: true }).eq("is_active", true),
    supabase
      .from("alerts")
      .select("*, sites(domain)")
      .gte("created_at", sevenDaysAgoIso)
      .order("created_at", { ascending: false })
      .limit(10),
    supabase.from("sites").select("*, keywords(count)").eq("is_active", true).order("domain"),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Dashboard</h1>
        <Link href="/gsc">
          <Badge variant="outline" className="cursor-pointer hover:bg-accent px-3 py-1">
            <BarChart3 className="h-3.5 w-3.5 mr-1" />
            Search Console
          </Badge>
        </Link>
      </div>

      {/* Stats cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Sites actifs</CardTitle>
            <Globe className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{sitesCount ?? 0}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">GSC Properties</CardTitle>
            <BarChart3 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{propertiesCount ?? 0}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Alertes (7j)</CardTitle>
            <AlertTriangle className="h-4 w-4 text-orange-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-orange-500">
              {alertsCount ?? 0}
            </div>
            <p className="text-xs text-muted-foreground">Non lues</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Keywords</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {sites?.reduce((acc, s) => acc + ((s.keywords as unknown as { count: number }[])?.[0]?.count ?? 0), 0) ?? 0}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Sites grid */}
      <div>
        <h2 className="mb-4 text-xl font-semibold">Sites</h2>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {sites?.map((site) => {
            const kwCount = (site.keywords as unknown as { count: number }[])?.[0]?.count ?? 0;

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

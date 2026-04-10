"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Bell, CheckCheck, Archive } from "lucide-react";
import { toast } from "sonner";

interface AlertRow {
  id: string;
  alert_type: string;
  severity: string;
  message: string;
  is_read: boolean;
  created_at: string;
  site_domain: string;
}

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export default function AlertsPage() {
  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [oldUnreadCount, setOldUnreadCount] = useState(0);
  const [filterType, setFilterType] = useState<string>("all");
  const [filterAge, setFilterAge] = useState<"recent" | "all">("recent");
  const [loading, setLoading] = useState(true);

  const fetchAlerts = useCallback(async () => {
    const supabase = createClient();
    const sevenDaysAgo = new Date(Date.now() - SEVEN_DAYS_MS).toISOString();

    // Query 1 — alerts to display (filtered by age if "recent")
    const query = supabase
      .from("alerts")
      .select("*, sites(domain)")
      .order("created_at", { ascending: false })
      .limit(200);

    if (filterAge === "recent") {
      query.gte("created_at", sevenDaysAgo);
    }

    const { data } = await query;

    setAlerts(
      (data ?? []).map((a) => ({
        id: a.id,
        alert_type: a.alert_type,
        severity: a.severity,
        message: a.message,
        is_read: a.is_read,
        created_at: a.created_at,
        site_domain: (a.sites as unknown as { domain: string })?.domain ?? "",
      })),
    );

    // Query 2 — count how many OLD unread alerts exist (for the archive button)
    const { count } = await supabase
      .from("alerts")
      .select("*", { count: "exact", head: true })
      .eq("is_read", false)
      .lt("created_at", sevenDaysAgo);
    setOldUnreadCount(count ?? 0);

    setLoading(false);
  }, [filterAge]);

  useEffect(() => {
    fetchAlerts();
  }, [fetchAlerts]);

  async function markAllRead() {
    const supabase = createClient();
    const unreadIds = filtered.filter((a) => !a.is_read).map((a) => a.id);
    if (unreadIds.length === 0) return;

    const { error } = await supabase
      .from("alerts")
      .update({ is_read: true })
      .in("id", unreadIds);

    if (error) {
      toast.error("Failed to mark alerts as read");
    } else {
      toast.success(`${unreadIds.length} alerts marked as read`);
      fetchAlerts();
    }
  }

  async function archiveOldAlerts() {
    const supabase = createClient();
    const cutoff = new Date(Date.now() - SEVEN_DAYS_MS).toISOString();

    // Count first (update doesn't return an accurate count via the JS client)
    const { count: toArchive } = await supabase
      .from("alerts")
      .select("*", { count: "exact", head: true })
      .lt("created_at", cutoff)
      .eq("is_read", false);

    const { error } = await supabase
      .from("alerts")
      .update({ is_read: true })
      .lt("created_at", cutoff)
      .eq("is_read", false);

    if (error) {
      toast.error("Failed to archive old alerts");
    } else {
      toast.success(`${toArchive ?? 0} alertes de plus de 7 jours archivées`);
      fetchAlerts();
    }
  }

  async function markRead(id: string) {
    const supabase = createClient();
    await supabase.from("alerts").update({ is_read: true }).eq("id", id);
    fetchAlerts();
  }

  const filtered =
    filterType === "all"
      ? alerts
      : alerts.filter((a) => a.alert_type === filterType);

  const unreadCount = filtered.filter((a) => !a.is_read).length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Alerts</h1>
          <p className="text-sm text-muted-foreground">
            {unreadCount} non lues
            {filterAge === "recent" && " (7 derniers jours)"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {oldUnreadCount > 0 && (
            <Button variant="outline" onClick={archiveOldAlerts}>
              <Archive className="mr-2 h-4 w-4" />
              Archiver les {oldUnreadCount} anciennes ({">"} 7j)
            </Button>
          )}
          <Button variant="outline" onClick={markAllRead} disabled={unreadCount === 0}>
            <CheckCheck className="mr-2 h-4 w-4" />
            Mark all read
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-2">
        <Select value={filterAge} onValueChange={(v) => setFilterAge(v as "recent" | "all")}>
          <SelectTrigger className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="recent">7 derniers jours (par défaut)</SelectItem>
            <SelectItem value="all">Toutes (jusqu&apos;à 200)</SelectItem>
          </SelectContent>
        </Select>

        <Select value={filterType} onValueChange={setFilterType}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="All types" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            <SelectItem value="deindex">Deindexation</SelectItem>
            <SelectItem value="position_drop">Position Drop</SelectItem>
            <SelectItem value="site_down">Site Down</SelectItem>
            <SelectItem value="link_broken">Broken Link</SelectItem>
            <SelectItem value="brand_hot">Brand HOT</SelectItem>
            <SelectItem value="brand_cooling">Brand Cooling</SelectItem>
            <SelectItem value="optimization_needed">Optimization</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Alerts feed */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bell className="h-5 w-5" />
            Alert Feed
            {filterAge === "recent" && (
              <Badge variant="outline" className="ml-2">
                7 derniers jours
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-center text-muted-foreground">Loading...</p>
          ) : filtered.length > 0 ? (
            <div className="space-y-3">
              {filtered.map((alert) => (
                <div
                  key={alert.id}
                  className={`flex items-center justify-between rounded-lg border p-4 ${
                    !alert.is_read ? "bg-accent/50" : ""
                  }`}
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
                      <p className={`text-sm ${!alert.is_read ? "font-semibold" : ""}`}>
                        {alert.message}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {alert.site_domain} &middot;{" "}
                        {new Date(alert.created_at).toLocaleString()}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">{alert.alert_type}</Badge>
                    {!alert.is_read && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => markRead(alert.id)}
                      >
                        Mark read
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-center text-muted-foreground">
              {filterAge === "recent"
                ? "Aucune alerte récente. Souffle."
                : "No alerts"}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

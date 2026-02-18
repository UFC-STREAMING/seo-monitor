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
import { Bell, CheckCheck } from "lucide-react";
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

export default function AlertsPage() {
  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [filterType, setFilterType] = useState<string>("all");
  const [loading, setLoading] = useState(true);

  const fetchAlerts = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("alerts")
      .select("*, sites(domain)")
      .order("created_at", { ascending: false })
      .limit(100);

    setAlerts(
      (data ?? []).map((a) => ({
        id: a.id,
        alert_type: a.alert_type,
        severity: a.severity,
        message: a.message,
        is_read: a.is_read,
        created_at: a.created_at,
        site_domain: (a.sites as unknown as { domain: string })?.domain ?? "",
      }))
    );
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchAlerts();
  }, [fetchAlerts]);

  async function markAllRead() {
    const supabase = createClient();
    const unreadIds = alerts.filter((a) => !a.is_read).map((a) => a.id);
    if (unreadIds.length === 0) return;

    const { error } = await supabase
      .from("alerts")
      .update({ is_read: true })
      .in("id", unreadIds);

    if (error) {
      toast.error("Failed to mark alerts as read");
    } else {
      toast.success("All alerts marked as read");
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

  const unreadCount = alerts.filter((a) => !a.is_read).length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Alerts</h1>
        <div className="flex items-center gap-4">
          <span className="text-sm text-muted-foreground">
            {unreadCount} unread
          </span>
          <Button variant="outline" onClick={markAllRead} disabled={unreadCount === 0}>
            <CheckCheck className="mr-2 h-4 w-4" />
            Mark all read
          </Button>
        </div>
      </div>

      {/* Filter */}
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
        </SelectContent>
      </Select>

      {/* Alerts feed */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bell className="h-5 w-5" />
            Alert Feed
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
            <p className="text-center text-muted-foreground">No alerts</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

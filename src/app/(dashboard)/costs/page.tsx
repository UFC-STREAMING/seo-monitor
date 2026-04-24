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
import { DollarSign } from "lucide-react";

interface UsageRow {
  id: string;
  service: string;
  endpoint: string | null;
  credits_used: number;
  cost_usd: number;
  created_at: string;
}

export default function CostsPage() {
  const [usage, setUsage] = useState<UsageRow[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    const supabase = createClient();

    const { data } = await supabase
      .from("api_usage_log")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100);

    setUsage(data ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Aggregate by service for current month
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const thisMonth = usage.filter((u) => u.created_at >= monthStart);

  const byService = new Map<string, { cost: number; credits: number; count: number }>();
  thisMonth.forEach((u) => {
    const existing = byService.get(u.service) ?? { cost: 0, credits: 0, count: 0 };
    existing.cost += u.cost_usd;
    existing.credits += u.credits_used;
    existing.count += 1;
    byService.set(u.service, existing);
  });

  const totalCost = thisMonth.reduce((acc, u) => acc + u.cost_usd, 0);

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Costs</h1>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">This Month</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">${totalCost.toFixed(2)}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">GSC Sync</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">Free</div>
            <p className="text-xs text-muted-foreground">
              {byService.get("gsc")?.count ?? 0} syncs
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">API Calls</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {thisMonth.length}
            </div>
            <p className="text-xs text-muted-foreground">this month</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <DollarSign className="h-5 w-5" />
            API Usage Log
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-center text-muted-foreground">Loading...</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Service</TableHead>
                  <TableHead>Endpoint</TableHead>
                  <TableHead className="text-right">Credits</TableHead>
                  <TableHead className="text-right">Cost</TableHead>
                  <TableHead>Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {usage.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell>
                      <Badge variant="outline">{u.service}</Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {u.endpoint ?? "-"}
                    </TableCell>
                    <TableCell className="text-right">{u.credits_used}</TableCell>
                    <TableCell className="text-right">
                      ${u.cost_usd.toFixed(4)}
                    </TableCell>
                    <TableCell className="text-xs">
                      {new Date(u.created_at).toLocaleString()}
                    </TableCell>
                  </TableRow>
                ))}
                {usage.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground">
                      No API usage recorded yet
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

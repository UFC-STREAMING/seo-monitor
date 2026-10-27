import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Résultats des backorders / enchères (Leo 27/10/2026) : le lendemain de la fin, le Mini regarde qui a eu le domaine
// (nous, ou un autre et chez qui) et l'écrit sur la ligne (robot_status won/lost + robot_note).
// GET → lignes cochées (robot ou « posé à la main ») finies depuis plus de 6 h et sans résultat final.
// Le compte rendu passe par POST /api/agent/expired/robot (id, status, note).
export async function GET(request: NextRequest) {
  if (request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const cutoff = new Date(Date.now() - 6 * 3600 * 1000).toISOString();
  const since = new Date(Date.now() - 21 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const { data, error } = await createAdminClient().from("expired_listings")
    .select("id, list_date, domain, platform, kind, max_bid, ends_at, ends_at_ts, robot_requested, backorder_placed, robot_status, robot_note")
    .neq("platform", "regfree")
    .gte("list_date", since)
    .or("robot_requested.eq.true,backorder_placed.eq.true")
    .order("list_date", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const final = new Set(["won", "lost", "cancelled"]);
  const todo = (data ?? []).filter((r) => !final.has(String(r.robot_status)) &&
    (!r.ends_at_ts || r.ends_at_ts < cutoff) &&
    // sans heure de fin : on attend le lendemain de la liste
    (r.ends_at_ts || r.list_date < new Date(Date.now() - 24 * 3600 * 1000).toISOString().slice(0, 10)));
  return NextResponse.json({ listings: todo });
}

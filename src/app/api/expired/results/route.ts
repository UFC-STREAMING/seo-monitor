import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Section « Résultats des 7 derniers jours » de /expires (Leo 27/10/2026) : chaque domaine coché (robot ou posé à la main)
// et qui l'a eu au final — à nous, ou parti chez quel registrar / service de backorder (note écrite par expires_resultats.py).
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const since = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const { data, error } = await createAdminClient().from("expired_listings")
    .select("list_date, domain, platform, kind, max_bid, ends_at_ts, robot_requested, backorder_placed, robot_status, robot_note")
    .gte("list_date", since)
    .neq("platform", "regfree")
    .or("robot_requested.eq.true,backorder_placed.eq.true")
    .order("list_date", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Une ligne par domaine : nos plateformes + le résultat le plus parlant (won > lost > en attente)
  const rank = (s: string | null) => (s === "won" ? 3 : s === "lost" ? 2 : 1);
  const byDomain = new Map<string, { domain: string; list_date: string; platforms: string[]; status: string; note: string | null; winner: string | null }>();
  for (const r of data ?? []) {
    const status = r.robot_status === "won" ? "won" : r.robot_status === "lost" ? "lost" : "pending";
    const winner = status === "lost" ? (r.robot_note ?? "").replace(/^parti chez\s*/i, "").trim() || null : status === "won" ? "toi" : null;
    const prev = byDomain.get(r.domain);
    if (!prev) {
      byDomain.set(r.domain, { domain: r.domain, list_date: r.list_date, platforms: [r.platform], status, note: r.robot_note, winner });
    } else {
      if (!prev.platforms.includes(r.platform)) prev.platforms.push(r.platform);
      if (rank(status) > rank(prev.status)) Object.assign(prev, { status, note: r.robot_note, winner });
    }
  }
  const rows = [...byDomain.values()];
  const winners: Record<string, number> = {};
  for (const r of rows) if (r.status === "lost" && r.winner) winners[r.winner] = (winners[r.winner] ?? 0) + 1;
  return NextResponse.json({
    rows,
    totals: { won: rows.filter((r) => r.status === "won").length, lost: rows.filter((r) => r.status === "lost").length, pending: rows.filter((r) => r.status === "pending").length },
    winners: Object.entries(winners).sort((a, b) => b[1] - a[1]),
  });
}

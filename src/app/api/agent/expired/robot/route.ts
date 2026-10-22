import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Ordres du robot d'achat (Mac Mini, navigateur connecté de Dana), Bearer CRON_SECRET.
// GET  → ordres en attente : Catched = poser le backorder, Nicsell = miser max_bid 5 min avant ends_at_ts.
// POST → compte rendu : { id, status: "done" | "failed" | "won" | "lost" | "pending", note }
function authorized(request: NextRequest) {
  return request.headers.get("authorization") === `Bearer ${process.env.CRON_SECRET}`;
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data, error } = await createAdminClient().from("expired_listings")
    .select("id, list_date, domain, platform, kind, price, max_bid, ends_at, ends_at_ts, robot_status, robot_note")
    .eq("robot_requested", true)
    .or("robot_status.is.null,robot_status.eq.pending,robot_status.eq.done")
    .order("ends_at_ts", { ascending: true, nullsFirst: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ orders: data ?? [] });
}

const STATUSES = new Set(["pending", "done", "failed", "won", "lost"]);

export async function POST(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => null) as { id?: number; status?: string; note?: string } | null;
  if (!body?.id || !STATUSES.has(String(body.status))) return NextResponse.json({ error: "id et status valides requis" }, { status: 400 });
  const done = body.status === "done" || body.status === "won";
  const { error } = await createAdminClient().from("expired_listings").update({
    robot_status: body.status,
    robot_note: body.note ?? null,
    robot_at: new Date().toISOString(),
    ...(done ? { backorder_placed: true, placed_at: new Date().toISOString() } : {}),
  }).eq("id", body.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

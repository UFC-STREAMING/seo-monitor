import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Section « Mes enchères DropCatch » de /expires (Leo 22/11/2026).
// GET  → enchères en cours (robot_status auction / bid), triées par date de fin.
// POST { id, max_bid } → nouvelle mise max en $ : le robot DropCatch (Hetzner, 2 min) la pose sur DropCatch.
async function requireUser() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  return !error && !!user;
}

export async function GET() {
  if (!(await requireUser())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { data, error } = await createAdminClient().from("expired_listings")
    .select("id, domain, price, max_bid, ends_at_ts, robot_status, robot_note, robot_at")
    .eq("platform", "dropcatch")
    .in("robot_status", ["auction", "bid"])
    .gte("ends_at_ts", since)
    .order("ends_at_ts", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ auctions: data ?? [] });
}

export async function POST(request: NextRequest) {
  if (!(await requireUser())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => null) as { id?: number; max_bid?: number } | null;
  const maxBid = Number(body?.max_bid);
  if (!body?.id || !(maxBid > 0)) return NextResponse.json({ error: "id et mise max (en $) requis" }, { status: 400 });
  const { data, error } = await createAdminClient().from("expired_listings").update({
    max_bid: maxBid, robot_status: "bid", robot_requested: true,
    robot_note: `mise de ${maxBid} $ max envoyée au robot (posée sur DropCatch sous 2 min)`, robot_at: new Date().toISOString(),
  }).eq("id", body.id).eq("platform", "dropcatch").select("id");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data?.length) return NextResponse.json({ error: "Enchère introuvable" }, { status: 404 });
  return NextResponse.json({ ok: true });
}

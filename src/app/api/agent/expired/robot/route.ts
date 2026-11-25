import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { chooseRegistrar } from "@/lib/expired/registrar-prices";

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
    .or("robot_status.is.null,robot_status.eq.pending,robot_status.eq.done,robot_status.eq.bid")
    .order("ends_at_ts", { ascending: true, nullsFirst: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  // Regfree : registrar d'achat imposé par la règle Leo 25/11 (nutra Europe/US = Dynadot ; betting et hors Europe = le moins cher)
  const orders = data ?? [];
  const regfree = [...new Set(orders.filter((o) => o.platform === "regfree").map((o) => o.domain))];
  const cat = new Map<string, string | null>();
  for (let i = 0; i < regfree.length; i += 500) {
    const { data: d } = await createAdminClient().from("expired_domains").select("domain, category").in("domain", regfree.slice(i, i + 500));
    for (const x of d ?? []) cat.set(x.domain, x.category);
  }
  return NextResponse.json({ orders: orders.map((o) => o.platform !== "regfree" ? o : { ...o, category: cat.get(o.domain) ?? null, registrar: chooseRegistrar(o.domain, cat.get(o.domain))?.registrar ?? null }) });
}

// « auction » = enchère DropCatch en cours (Leo 22/11) : ni gagnée ni perdue, le robot ne repose pas de backorder
const STATUSES = new Set(["pending", "done", "failed", "won", "lost", "auction"]);

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

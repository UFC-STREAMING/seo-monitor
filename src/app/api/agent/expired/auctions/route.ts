import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Enchères DropCatch en cours (Leo 22/11/2026), poussées par le robot (Hetzner, toutes les 2 min), Bearer CRON_SECRET.
// POST { auctions: [{ domain, high_bid, max_bid, ends_at_ts, note }] } → met à jour la ligne DropCatch du domaine
// (la plus récente) ou la crée. robot_status = « auction » (info), sauf si une mise de Leo attend (« bid »).
function authorized(request: NextRequest) {
  return request.headers.get("authorization") === `Bearer ${process.env.CRON_SECRET}`;
}

interface Auction { domain: string; high_bid: number | null; max_bid: number | null; ends_at_ts: string | null; note: string }

export async function POST(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => null) as { auctions?: Auction[] } | null;
  if (!Array.isArray(body?.auctions)) return NextResponse.json({ error: "auctions requis" }, { status: 400 });
  const admin = createAdminClient();
  const today = new Date().toISOString().slice(0, 10);
  let updated = 0, created = 0;
  for (const a of body.auctions) {
    const domain = String(a.domain || "").toLowerCase();
    if (!domain) continue;
    const { data: rows, error } = await admin.from("expired_listings")
      .select("id, robot_status").eq("domain", domain).eq("platform", "dropcatch")
      .order("list_date", { ascending: false }).limit(1);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const ends = a.ends_at_ts ? new Date(a.ends_at_ts) : null;
    const fields = {
      price: a.high_bid != null ? String(a.high_bid) + " $" : null,
      ends_at_ts: ends ? ends.toISOString() : null,
      ends_at: ends ? ends.toLocaleString("fr-FR", { timeZone: "Europe/Paris", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : null,
      robot_requested: true,
      robot_note: a.note,
      robot_at: new Date().toISOString(),
    };
    const row = rows?.[0];
    if (row) {
      const waiting = row.robot_status === "bid";  // mise de Leo pas encore passée : on garde son max et le statut
      const { error: e } = await admin.from("expired_listings").update({
        ...fields, ...(waiting ? {} : { robot_status: "auction", max_bid: a.max_bid }),
      }).eq("id", row.id);
      if (e) return NextResponse.json({ error: e.message }, { status: 500 });
      updated++;
    } else {
      const { error: e } = await admin.from("expired_listings").insert({
        list_date: today, domain, platform: "dropcatch", kind: "auction", ...fields, robot_status: "auction", max_bid: a.max_bid,
      });
      if (e) return NextResponse.json({ error: e.message }, { status: 500 });
      created++;
    }
  }
  return NextResponse.json({ ok: true, updated, created });
}

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Page /expires : liste du jour des domaines expirés (médical, psy, sport) + trafic + plateformes.
async function requireUser() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  return !error && !!user;
}

export async function GET(request: NextRequest) {
  if (!(await requireUser())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const admin = createAdminClient();

  // Jours disponibles (les 60 derniers), le plus récent par défaut
  const { data: dateRows } = await admin.from("expired_listings").select("list_date").order("list_date", { ascending: false }).limit(5000);
  const dates = [...new Set((dateRows ?? []).map((r) => r.list_date))].slice(0, 60);
  const date = request.nextUrl.searchParams.get("date") || dates[0] || null;
  if (!date) return NextResponse.json({ dates, date, rows: [] });

  type L = { domain: string; platform: string; kind: string; price: string | null; ends_at: string | null; ends_at_ts: string | null; backorder_placed: boolean; robot_requested: boolean; max_bid: number | null; robot_status: string | null; robot_note: string | null };
  const listings: L[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin.from("expired_listings")
      .select("domain, platform, kind, price, ends_at, ends_at_ts, backorder_placed, robot_requested, max_bid, robot_status, robot_note")
      .eq("list_date", date).range(from, from + 999);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    listings.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  const names = [...new Set(listings.map((l) => l.domain))];
  const info = new Map<string, Record<string, unknown>>();
  for (let i = 0; i < names.length; i += 500) {
    const { data } = await admin.from("expired_domains")
      .select("domain, category, label, tld, traffic_current, traffic_6m, traffic_peak, peak_month, traffic_series, traffic_checked_at, first_seen")
      .in("domain", names.slice(i, i + 500));
    for (const r of data ?? []) info.set(r.domain, r);
  }
  const rows = names.map((domain) => ({
    ...(info.get(domain) ?? { domain }),
    sources: listings.filter((l) => l.domain === domain).map((l) => ({ platform: l.platform, kind: l.kind, price: l.price, ends_at: l.ends_at, ends_at_ts: l.ends_at_ts, backorder_placed: l.backorder_placed, robot_requested: l.robot_requested, max_bid: l.max_bid, robot_status: l.robot_status, robot_note: l.robot_note })),
  }));
  return NextResponse.json({ dates, date, rows });
}

// Actions de Leo sur une plateforme :
//   { action: "placed", placed }            → note « backorder posé à la main »
//   { action: "robot", robot, max_bid? }    → ordre au robot du Mini (Catched : poser le backorder ; Nicsell : miser max_bid 5 min avant la fin)
const ROBOT_PLATFORMS = new Set(["catched", "nicsell"]);

export async function POST(request: NextRequest) {
  if (!(await requireUser())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => null) as { action?: string; list_date?: string; domain?: string; platform?: string; placed?: boolean; robot?: boolean; max_bid?: number | null } | null;
  if (!body?.list_date || !body.domain || !body.platform) return NextResponse.json({ error: "list_date, domain, platform requis" }, { status: 400 });

  let update: Record<string, unknown>;
  if (body.action === "robot") {
    if (!ROBOT_PLATFORMS.has(body.platform)) return NextResponse.json({ error: "Robot disponible seulement sur Catched et Nicsell" }, { status: 400 });
    const robot = !!body.robot;
    const maxBid = body.max_bid == null ? null : Number(body.max_bid);
    if (robot && body.platform === "nicsell" && !(maxBid && maxBid >= 10)) return NextResponse.json({ error: "Prix max Nicsell requis (10 € minimum)" }, { status: 400 });
    update = { robot_requested: robot, max_bid: maxBid, robot_status: robot ? "pending" : "cancelled", robot_note: robot ? null : "annulé par Leo", robot_at: new Date().toISOString() };
  } else {
    const placed = !!body.placed;
    update = { backorder_placed: placed, placed_at: placed ? new Date().toISOString() : null };
  }
  const { error } = await createAdminClient().from("expired_listings").update(update)
    .eq("list_date", body.list_date).eq("domain", body.domain).eq("platform", body.platform);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

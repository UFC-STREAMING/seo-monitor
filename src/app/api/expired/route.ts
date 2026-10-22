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

  const listings: { domain: string; platform: string; kind: string; price: string | null; ends_at: string | null; backorder_placed: boolean }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin.from("expired_listings")
      .select("domain, platform, kind, price, ends_at, backorder_placed")
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
    sources: listings.filter((l) => l.domain === domain).map((l) => ({ platform: l.platform, kind: l.kind, price: l.price, ends_at: l.ends_at, backorder_placed: l.backorder_placed })),
  }));
  return NextResponse.json({ dates, date, rows });
}

// Case « backorder posé » cochée / décochée par Leo
export async function POST(request: NextRequest) {
  if (!(await requireUser())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => null) as { list_date?: string; domain?: string; platform?: string; placed?: boolean } | null;
  if (!body?.list_date || !body.domain || !body.platform) return NextResponse.json({ error: "list_date, domain, platform requis" }, { status: 400 });
  const placed = !!body.placed;
  const { error } = await createAdminClient().from("expired_listings")
    .update({ backorder_placed: placed, placed_at: placed ? new Date().toISOString() : null })
    .eq("list_date", body.list_date).eq("domain", body.domain).eq("platform", body.platform);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

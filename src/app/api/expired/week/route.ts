import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Vue « Semaine » de /expires (Leo 27/10/2026) : DomainOrder et Realtime.at publient le lundi les domaines qui tombent
// dans la semaine ; les mêmes noms repassent ensuite sur Catched, Nicsell… Une ligne par domaine de la liste du lundi,
// avec toutes ses apparitions de la semaine (plateforme, jour, fin, prix).
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const ref = request.nextUrl.searchParams.get("date") || new Date().toISOString().slice(0, 10);
  const d = new Date(ref + "T12:00:00Z");
  const monday = new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * 86400000).toISOString().slice(0, 10);
  const sunday = new Date(new Date(monday + "T12:00:00Z").getTime() + 6 * 86400000).toISOString().slice(0, 10);
  const admin = createAdminClient();

  type L = { list_date: string; domain: string; platform: string; kind: string; price: string | null; ends_at_ts: string | null; backorder_placed: boolean; robot_requested: boolean; robot_status: string | null };
  const listings: L[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin.from("expired_listings")
      .select("list_date, domain, platform, kind, price, ends_at_ts, backorder_placed, robot_requested, robot_status")
      .gte("list_date", monday).lte("list_date", sunday).neq("platform", "regfree").range(from, from + 999);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    listings.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  // Domaines de la liste hebdo (DomainOrder / Realtime) ; les autres plateformes s'y rattachent
  const weekly = new Set(listings.filter((l) => l.platform === "domainorder" || l.platform === "realtime").map((l) => l.domain));
  const names = [...weekly];
  const info = new Map<string, Record<string, unknown>>();
  for (let i = 0; i < names.length; i += 500) {
    const { data } = await admin.from("expired_domains")
      .select("domain, category, label, traffic_current, traffic_6m, traffic_peak, peak_month, traffic_checked_at")
      .in("domain", names.slice(i, i + 500));
    for (const r of data ?? []) info.set(r.domain, r);
  }
  const rows = names.map((domain) => ({
    ...(info.get(domain) ?? { domain }),
    appearances: listings.filter((l) => l.domain === domain)
      .sort((a, b) => (a.ends_at_ts ?? a.list_date).localeCompare(b.ends_at_ts ?? b.list_date)),
  }));
  return NextResponse.json({ monday, sunday, rows });
}

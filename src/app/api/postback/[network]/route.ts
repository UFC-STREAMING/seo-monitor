import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Postbacks des réseaux hors Everflow (Leo 12/10/2026), d'abord Dr.Cash :
//   https://seo-monitor-one.vercel.app/api/postback/drcash?k=<POSTBACK_SECRET>&status={…}&payout={…}&stream={…}…
// Tous les paramètres reçus sont gardés tels quels (raw) ; les noms courants sont rangés en colonnes.
// GET ou POST, réponse 200 « ok » (les réseaux réessaient tant qu'ils n'ont pas de 200).

const pick = (q: Record<string, string>, names: string[]) => {
  for (const n of names) if (q[n] !== undefined && q[n] !== "" && !/^\{.*\}$/.test(q[n])) return q[n];
  return null;
};

async function handle(request: NextRequest, network: string) {
  const q: Record<string, string> = Object.fromEntries(request.nextUrl.searchParams);
  if (request.method === "POST") {
    const ct = request.headers.get("content-type") ?? "";
    try {
      if (ct.includes("json")) Object.assign(q, await request.json());
      else Object.assign(q, Object.fromEntries(new URLSearchParams(await request.text())));
    } catch { /* corps illisible : on garde la query */ }
  }
  if (!process.env.POSTBACK_SECRET || q.k !== process.env.POSTBACK_SECRET) {
    return new NextResponse("forbidden", { status: 403 });
  }
  delete q.k;
  const payout = pick(q, ["payout", "revenue", "sum", "amount", "price"]);
  let stream = pick(q, ["stream", "stream_code", "flow", "subdomain", "stream_id"]);
  // Le code du stream peut aussi arriver sous forme d'URL / domaine (u3kwp.doctorluckysh.com)
  if (stream && stream.includes(".")) stream = stream.replace(/^https?:\/\//, "").split(".")[0];
  await createAdminClient().from("network_conversions").insert({
    network: network.toLowerCase(),
    stream: stream?.toLowerCase() ?? null,
    offer: pick(q, ["offer", "offer_id", "offer_name"]),
    status: pick(q, ["status", "lead_status", "state"])?.toLowerCase() ?? null,
    payout: payout !== null && Number.isFinite(Number(payout)) ? Number(payout) : null,
    currency: pick(q, ["currency", "cur"]),
    country: pick(q, ["country", "geo", "country_code"]),
    click_id: pick(q, ["click_id", "clickid", "uuid", "lead_id", "order_id", "id"]),
    raw: q,
  });
  return new NextResponse("ok", { status: 200 });
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ network: string }> }) {
  return handle(request, (await params).network);
}
export async function POST(request: NextRequest, { params }: { params: Promise<{ network: string }> }) {
  return handle(request, (await params).network);
}

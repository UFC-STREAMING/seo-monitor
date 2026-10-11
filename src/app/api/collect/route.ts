import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Réception des clics sur les boutons des EMD (mini-script posé avec Clarity, Leo 11/10/2026).
// Envoyé par navigator.sendBeacon (text/plain, sans pré-vol CORS). Public : seuls les
// domaines EMD connus sont acceptés ; nos propres pays (Thaïlande/Bulgarie) sont ignorés.

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const OWN_COUNTRIES = new Set(["TH", "BG"]);
let siteCache: { at: number; byDomain: Map<string, string> } | null = null;

async function siteId(domain: string): Promise<string | undefined> {
  if (!siteCache || Date.now() - siteCache.at > 10 * 60_000) {
    const { data } = await createAdminClient().from("sites").select("id, domain").eq("category", "emd");
    siteCache = { at: Date.now(), byDomain: new Map((data ?? []).map((s) => [s.domain, s.id])) };
  }
  return siteCache.byDomain.get(domain);
}

const clip = (v: unknown, n: number) => (typeof v === "string" ? v.slice(0, n) : null);
const int = (v: unknown) => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : null);

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function POST(request: NextRequest) {
  const country = request.headers.get("x-vercel-ip-country") ?? null;
  if (country && OWN_COUNTRIES.has(country)) return new NextResponse(null, { status: 204, headers: CORS });
  let b: Record<string, unknown>;
  try {
    b = JSON.parse(await request.text());
  } catch {
    return new NextResponse(null, { status: 400, headers: CORS });
  }
  const domain = String(b.d ?? "").toLowerCase().replace(/^www\./, "");
  const id = await siteId(domain);
  if (!id) return new NextResponse(null, { status: 204, headers: CORS });
  const pos = clip(b.pos, 20);
  await createAdminClient().from("cta_clicks").insert({
    site_id: id,
    domain,
    page_path: clip(b.p, 200),
    position: pos && ["haut", "milieu", "bas", "barre-fixe"].includes(pos) ? pos : null,
    cta_index: int(b.i),
    cta_text: clip(b.t, 80),
    y_pct: int(b.y),
    device: b.m === 1 ? "mobile" : "desktop",
    country,
  });
  return new NextResponse(null, { status: 204, headers: CORS });
}

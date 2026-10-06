import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { computeEmdGaps } from "@/lib/emd/gaps";

export const maxDuration = 300;

// Offres × pays qui ont vendu sur les N derniers jours (défaut 7) sans EMD
// concurrent dans le top 10 Google du pays. Appelé par le Mini
// (~/emd-sync/emd_gap_launcher.py) qui lance l'agent Hermes EMD sur les `gap`.
// Auth : Bearer CRON_SECRET uniquement (chaque appel coûte des SERP).
export async function GET(request: NextRequest) {
  if (request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const days = Math.min(30, Math.max(1, Number(request.nextUrl.searchParams.get("days")) || 7));

  try {
    const { data: sites, error } = await createAdminClient()
      .from("sites")
      .select("domain")
      .eq("category", "emd");
    if (error) throw new Error(error.message);
    const gaps = await computeEmdGaps((sites ?? []).map((s) => s.domain), days);
    return NextResponse.json({ days, gaps });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

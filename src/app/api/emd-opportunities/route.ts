import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { computeEmdOpportunities } from "@/lib/everflow/opportunities";

export const maxDuration = 60;

// Offres × pays qui vendent via les sites expirés (referer Everflow), avec les
// EMD déjà possédés pour la marque. Encart « EMD à lancer » de /rankings.
// Auth : session dashboard OU Bearer CRON_SECRET (agent Hermes EMD).
export async function GET(request: NextRequest) {
  const isCron =
    request.headers.get("authorization") === `Bearer ${process.env.CRON_SECRET}`;

  if (!isCron) {
    const supabase = await createClient();
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();
    if (error || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const days = Math.min(365, Math.max(7, Number(request.nextUrl.searchParams.get("days")) || 90));

  try {
    const { data: sites, error } = await createAdminClient()
      .from("sites")
      .select("domain")
      .eq("category", "emd");
    if (error) throw new Error(error.message);
    const opportunities = await computeEmdOpportunities(
      (sites ?? []).map((s) => s.domain),
      days
    );
    return NextResponse.json({ days, opportunities });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

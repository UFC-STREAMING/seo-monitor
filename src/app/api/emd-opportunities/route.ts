import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getEmdBoard } from "@/lib/emd/board";

export const maxDuration = 300;

// Encart « EMD à lancer » de /rankings : marque × pays avec ventes (Everflow,
// 90 j), impressions des fiches produit (Search Console, 28 j) et EMD
// concurrents dans le top 10 Google du pays. Calcul mis en cache 24 h.
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

  try {
    return NextResponse.json({ rows: await getEmdBoard() });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

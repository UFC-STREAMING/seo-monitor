import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { runPositionChecks } from "@/lib/positions/check";

export const maxDuration = 300;

// Cron hebdo (lundi 7h UTC, vercel.json) : check SERP DataForSEO de tous les
// mots-clés EMD, AVANT le rapport de l'agent Hermes EMD (lundi 9h) qui lit
// ensuite les résultats via /api/agent/emd-report.
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await runPositionChecks(createAdminClient());
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

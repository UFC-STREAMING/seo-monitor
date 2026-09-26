import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { runAffiliateChecks } from "@/lib/affiliate/check";

export const maxDuration = 300;

// Cron quotidien (6h40 UTC, vercel.json) : lien /go/ de chaque EMD → offre
// Everflow + statut d'approbation + sub1. Ne requête JAMAIS le tracker.
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const results = await runAffiliateChecks(createAdminClient());
    const count = (v: string) => results.filter((r) => r.verdict === v).length;
    return NextResponse.json({
      success: true,
      checked: results.length,
      ok: count("ok"),
      pending: count("pending"),
      ko: count("ko"),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

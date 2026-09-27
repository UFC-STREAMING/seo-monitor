import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { runAffiliateChecks } from "@/lib/affiliate/check";

export const maxDuration = 300;

// Vérification des liens affiliés à la demande (bouton de /rankings).
// Auth : session dashboard OU Bearer CRON_SECRET (agent Hermes).
export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const isCron = authHeader === `Bearer ${process.env.CRON_SECRET}`;

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

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { runPositionChecks } from "@/lib/positions/check";

export const maxDuration = 800;

// Check SERP à la demande (bouton "Check maintenant" de /rankings).
// Body optionnel : { site_id: "..." } pour ne vérifier qu'un seul domaine.
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

  let siteId: string | undefined;
  try {
    const body = await request.json();
    siteId = body?.site_id ?? undefined;
  } catch {
    // pas de body = check global
  }

  try {
    const result = await runPositionChecks(createAdminClient(), { siteId });
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

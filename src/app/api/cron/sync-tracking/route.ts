import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { syncBing, syncEverflow } from "@/lib/tracking/sync";

export const maxDuration = 300;

// Cron quotidien 6h20 UTC (vercel.json) : collecte de la section Tracking.
// Bing (30 j glissants, la donnée Bing arrive avec ~48 h de retard) + Everflow (3 j).
export async function GET(request: NextRequest) {
  if (request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const supabase = createAdminClient();
  const out: Record<string, unknown> = {};
  try { out.bing = await syncBing(supabase, 30); } catch (e) { out.bing = { error: String(e) }; }
  try { out.everflow = await syncEverflow(supabase, 3); } catch (e) { out.everflow = { error: String(e) }; }
  return NextResponse.json({ success: true, ...out });
}

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { expiredFunnel } from "@/lib/tracking/expired";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Entonnoir des sites expirés nutra : Search Console par fiche → ventes Everflow.
export async function GET(request: NextRequest) {
  const isCron = request.headers.get("authorization") === `Bearer ${process.env.CRON_SECRET}`;
  if (!isCron) {
    const { data: { user }, error } = await (await createClient()).auth.getUser();
    if (error || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const days = Math.min(90, Math.max(7, Number(request.nextUrl.searchParams.get("days")) || 28));
  try {
    return NextResponse.json({ days, ...(await expiredFunnel(createAdminClient(), days)) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

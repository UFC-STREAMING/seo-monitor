import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { scanPages } from "@/lib/tracking/page-features";

export const maxDuration = 300;

// Cron quotidien 6h00 UTC : éléments de la page d'accueil de chaque EMD (section Tracking).
export async function GET(request: NextRequest) {
  if (request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ success: true, ...(await scanPages(createAdminClient())) });
}

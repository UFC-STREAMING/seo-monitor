import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { scanPages } from "@/lib/tracking/page-features";
import { scanFiches } from "@/lib/tracking/expired";

export const maxDuration = 300;

// Cron quotidien 6h00 UTC : éléments de la page d'accueil de chaque EMD + réseaux
// derrière les boutons des fiches des sites expirés (section Tracking).
export async function GET(request: NextRequest) {
  if (request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const supabase = createAdminClient();
  const emd = await scanPages(supabase);
  const fiches = await scanFiches(supabase); // réseaux derrière les boutons des fiches des sites expirés
  return NextResponse.json({ success: true, emd, fiches });
}

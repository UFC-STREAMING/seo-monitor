import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 30;

// Liste de tous les domaines connus de seo-monitor (toutes catégories), pour la
// synchro automatique des achats registrar sur le Mac Mini (Bearer CRON_SECRET).
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();
  const domains: string[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("sites")
      .select("domain")
      .range(from, from + 999);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    domains.push(...(data ?? []).map((d) => d.domain));
    if (!data || data.length < 1000) break;
  }
  return NextResponse.json({ count: domains.length, domains });
}

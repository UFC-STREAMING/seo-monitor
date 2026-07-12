import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { listAllCloudflareZones } from "@/lib/cloudflare";
import { sendTelegramMessage } from "@/lib/telegram";

export const maxDuration = 60;

// Inventaire complet des domaines : synchronise les zones des comptes
// Cloudflare (principal / flokinet / leoblackseo) vers SM.sites.
//
// Règles :
//   - Jamais de DELETE : un domaine disparu de CF reste en base.
//   - Nouveau domaine  -> category='other', is_active=false, site_type='other'.
//     Il est INERTE (aucun cron GSC/SERP ne le touche) tant que Leo ne l'a pas
//     classé en 'emd' + saisi un mot-clé depuis /rankings.
//   - Domaine existant -> on remplit cf_account s'il est vide.
//   - DataForSEO n'est jamais déclenché ici (voir cron/check-positions).

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();

  const { zones, errors } = await listAllCloudflareZones();
  if (zones.length === 0) {
    return NextResponse.json(
      { error: "No Cloudflare zones fetched", details: errors },
      { status: 500 }
    );
  }

  // Dédup (un même domaine peut théoriquement exister sur 2 comptes)
  const zoneByDomain = new Map<string, (typeof zones)[number]>();
  for (const z of zones) {
    if (!zoneByDomain.has(z.domain)) zoneByDomain.set(z.domain, z);
  }

  const { data: existing, error: sitesErr } = await supabase
    .from("sites")
    .select("id, domain, cf_account, user_id");
  if (sitesErr || !existing) {
    return NextResponse.json(
      { error: "Failed to fetch sites", details: sitesErr?.message },
      { status: 500 }
    );
  }

  // user_id : mono-utilisateur — on réutilise celui des sites existants
  const userId = existing[0]?.user_id ?? process.env.DEFAULT_USER_ID;
  if (!userId) {
    return NextResponse.json(
      { error: "No user_id available (empty sites table and no DEFAULT_USER_ID)" },
      { status: 500 }
    );
  }

  const existingByDomain = new Map(existing.map((s) => [s.domain, s]));

  const toInsert = [];
  const backfilledCfAccount: string[] = [];

  for (const [domain, zone] of zoneByDomain) {
    const site = existingByDomain.get(domain);
    if (!site) {
      toInsert.push({
        user_id: userId,
        domain,
        niche: "nutra" as const,
        site_type: "other" as const,
        category: "other" as const,
        serp_tracking_enabled: false,
        is_active: false,
        hosting: "cloudflare",
        cf_account: zone.cf_account,
      });
    } else if (!site.cf_account) {
      const { error } = await supabase
        .from("sites")
        .update({ cf_account: zone.cf_account })
        .eq("id", site.id);
      if (!error) backfilledCfAccount.push(domain);
    }
  }

  let inserted: string[] = [];
  if (toInsert.length > 0) {
    const { data, error } = await supabase
      .from("sites")
      .insert(toInsert)
      .select("domain");
    if (error) {
      return NextResponse.json(
        { error: "Insert failed", details: error.message },
        { status: 500 }
      );
    }
    inserted = (data ?? []).map((s) => s.domain);
  }

  // Notif Telegram uniquement quand il y a du nouveau à classer
  if (inserted.length > 0) {
    const list = inserted.slice(0, 15).map((d) => `  • ${d}`).join("\n");
    const more = inserted.length > 15 ? `\n  ... et ${inserted.length - 15} autres` : "";
    await sendTelegramMessage(
      `<b>🌐 SEO Monitor — ${inserted.length} nouveau(x) domaine(s) Cloudflare</b>\n${list}${more}\n\n→ À classer (EMD / shop) dans /rankings`
    );
  }

  return NextResponse.json({
    success: true,
    cf_zones_total: zoneByDomain.size,
    inserted_count: inserted.length,
    inserted,
    backfilled_cf_account: backfilledCfAccount,
    cf_errors: errors,
  });
}

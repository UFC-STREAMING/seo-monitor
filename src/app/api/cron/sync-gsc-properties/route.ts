import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { gscClient } from "@/lib/google/search-console";

export const maxDuration = 120;

/**
 * GET /api/cron/sync-gsc-properties
 *
 * Refresh la liste des proprietes GSC depuis Google, upsert dans gsc_properties,
 * puis link aux sites existants par domain matching.
 * Auth: Bearer ${CRON_SECRET}
 *
 * Idempotent: peut etre relance autant de fois que voulu.
 * A relancer quand tu ajoutes le service account sur de nouvelles proprietes GSC.
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!gscClient.isConfigured()) {
    return NextResponse.json(
      { error: "GOOGLE_SERVICE_ACCOUNT_KEY not configured" },
      { status: 500 }
    );
  }

  const userId = process.env.SEO_MONITOR_USER_ID;
  if (!userId) {
    return NextResponse.json(
      { error: "SEO_MONITOR_USER_ID not configured" },
      { status: 500 }
    );
  }

  const admin = createAdminClient();

  const gscSites = await gscClient.listSites();
  if (gscSites.length === 0) {
    return NextResponse.json({
      message: "No GSC properties found for service account",
      service_account: gscClient.getServiceAccountEmail(),
      synced: 0,
      linked: 0,
      created: 0,
    });
  }

  // Upsert all properties
  const toUpsert = gscSites.map((s) => ({
    user_id: userId,
    site_url: s.siteUrl,
    permission_level: s.permissionLevel,
    is_active: true,
  }));

  const { error: upsertErr } = await admin
    .from("gsc_properties")
    .upsert(toUpsert, { onConflict: "user_id,site_url" });

  if (upsertErr) {
    return NextResponse.json({ error: upsertErr.message }, { status: 500 });
  }

  // Re-fetch with ids
  const { data: properties } = await admin
    .from("gsc_properties")
    .select("id, site_url, site_id")
    .eq("user_id", userId);

  const { data: userSites } = await admin
    .from("sites")
    .select("id, domain")
    .eq("user_id", userId);

  let linked = 0;
  let created = 0;
  const linkedDomains: string[] = [];

  if (properties && userSites) {
    const sitesByDomain = new Map(userSites.map((s) => [s.domain, s.id]));

    for (const prop of properties) {
      if (prop.site_id) continue;

      let propDomain = prop.site_url;
      if (propDomain.startsWith("sc-domain:")) {
        propDomain = propDomain.replace("sc-domain:", "");
      } else {
        try {
          propDomain = new URL(propDomain).hostname;
        } catch {
          continue;
        }
      }

      const cleanDomain = propDomain.replace(/^www\./, "");
      const matchId =
        sitesByDomain.get(cleanDomain) ||
        sitesByDomain.get(`www.${cleanDomain}`);

      if (matchId) {
        await admin
          .from("gsc_properties")
          .update({ site_id: matchId, is_active: true })
          .eq("id", prop.id);
        linked++;
        linkedDomains.push(cleanDomain);
      } else {
        // Auto-create site for property not yet in our sites table
        const { data: newSite } = await admin
          .from("sites")
          .insert({
            user_id: userId,
            domain: cleanDomain,
            niche: "nutra",
            site_type: "nutra",
            is_active: true,
          })
          .select("id")
          .single();

        if (newSite) {
          await admin
            .from("gsc_properties")
            .update({ site_id: newSite.id, is_active: true })
            .eq("id", prop.id);
          linked++;
          created++;
          linkedDomains.push(cleanDomain);
        }
      }
    }
  }

  return NextResponse.json({
    success: true,
    synced: gscSites.length,
    linked,
    created,
    linked_domains: linkedDomains,
    service_account: gscClient.getServiceAccountEmail(),
  });
}

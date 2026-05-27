import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createNutraFactoryClient } from "@/lib/supabase/nutra-factory";

export const maxDuration = 60;

// Nutra Factory is the source of truth for which nutra sites should be
// monitored. A site is considered monitorable when NF.status === 'active'.
//
// This cron syncs SM.sites.is_active to mirror NF status:
//   - NF active           -> SM is_active = true
//   - NF paused / missing -> SM is_active = false
//
// It does NOT auto-create SM rows for new NF sites - that path goes through
// /api/cron/sync-gsc which creates a SM site when a linked GSC property is
// discovered (auto-link behavior). This cron only flips the active flag.

interface NfSite {
  domain: string;
  status: string;
}

interface SmSiteRow {
  id: string;
  domain: string;
  is_active: boolean;
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();

  let nfSites: NfSite[];
  try {
    const nfClient = createNutraFactoryClient();
    const { data, error } = await nfClient
      .from("sites")
      .select("domain, status");
    if (error || !data) {
      return NextResponse.json(
        { error: "Failed to fetch NF sites", details: error?.message },
        { status: 500 }
      );
    }
    nfSites = data as NfSite[];
  } catch (e) {
    return NextResponse.json(
      { error: "NF client error", details: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }

  // Build expected state from NF
  const nfActiveDomains = new Set(
    nfSites.filter((s) => s.status === "active").map((s) => s.domain)
  );

  // Get current SM nutra sites
  const { data: smSites, error: smErr } = await supabase
    .from("sites")
    .select("id, domain, is_active")
    .eq("niche", "nutra");
  if (smErr || !smSites) {
    return NextResponse.json(
      { error: "Failed to fetch SM sites", details: smErr },
      { status: 500 }
    );
  }

  const toActivate: SmSiteRow[] = [];
  const toDeactivate: SmSiteRow[] = [];
  for (const site of smSites as SmSiteRow[]) {
    const shouldBeActive = nfActiveDomains.has(site.domain);
    if (shouldBeActive && !site.is_active) toActivate.push(site);
    if (!shouldBeActive && site.is_active) toDeactivate.push(site);
  }

  const sbAny = supabase as never as {
    from: (t: string) => {
      update: (
        v: Record<string, unknown>
      ) => { in: (col: string, vals: unknown[]) => Promise<unknown> };
    };
  };

  if (toActivate.length > 0) {
    await sbAny
      .from("sites")
      .update({ is_active: true, updated_at: new Date().toISOString() })
      .in("id", toActivate.map((s) => s.id));
  }
  if (toDeactivate.length > 0) {
    await sbAny
      .from("sites")
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .in("id", toDeactivate.map((s) => s.id));
  }

  // Surface NF domains that are not yet in SM (for visibility / Hermes alert)
  const smDomains = new Set(smSites.map((s) => s.domain));
  const missingInSm = nfSites
    .filter((s) => s.status === "active" && !smDomains.has(s.domain))
    .map((s) => s.domain);

  return NextResponse.json({
    success: true,
    nf_total: nfSites.length,
    nf_active: nfActiveDomains.size,
    sm_total: smSites.length,
    activated: toActivate.map((s) => s.domain),
    deactivated: toDeactivate.map((s) => s.domain),
    nf_active_not_in_sm: missingInSm,
  });
}

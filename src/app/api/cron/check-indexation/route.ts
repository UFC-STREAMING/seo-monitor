import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { computeIndexationForSite } from "@/lib/indexation/sitemap-check";

export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();
  const today = new Date().toISOString().split("T")[0];

  const { data: sites, error: sitesErr } = await supabase
    .from("sites")
    .select("id, domain, gsc_properties(id)")
    .eq("is_active", true);

  if (sitesErr || !sites) {
    return NextResponse.json({ error: "Failed to fetch sites", details: sitesErr }, { status: 500 });
  }

  const results = [];
  let totalSitemap = 0;
  let totalIndexed = 0;
  let totalNotIndexed = 0;
  let totalErrored = 0;

  for (const site of sites) {
    const siteForLib = {
      id: site.id,
      domain: site.domain,
      template_type: null,
      gsc_properties: site.gsc_properties as { id: string }[] | null,
    };

    const result = await computeIndexationForSite(siteForLib, supabase as never);

    const { error: upsertErr } = await (supabase as never as {
      from: (t: string) => {
        upsert: (row: Record<string, unknown>, opts: { onConflict: string }) => Promise<{ error: unknown }>;
      };
    })
      .from("indexation_snapshots")
      .upsert({
        site_id: result.site_id,
        snapshot_date: today,
        sitemap_urls_count: result.sitemap_urls_count,
        indexed_urls_count: result.indexed_urls_count,
        not_indexed_urls_count: result.not_indexed_urls_count,
        indexation_rate: result.indexation_rate,
        not_indexed_urls: result.not_indexed_urls,
        sitemap_source: result.sitemap_source,
        template_type: result.template_type,
        error: result.error ?? null,
      }, { onConflict: "site_id,snapshot_date" });

    if (upsertErr) {
      console.error(`Upsert error for ${site.domain}:`, upsertErr);
    }

    totalSitemap += result.sitemap_urls_count;
    totalIndexed += result.indexed_urls_count;
    totalNotIndexed += result.not_indexed_urls_count;
    if (result.error) totalErrored++;

    results.push({
      domain: result.domain,
      sitemap_urls: result.sitemap_urls_count,
      indexed: result.indexed_urls_count,
      not_indexed: result.not_indexed_urls_count,
      indexation_rate: result.indexation_rate,
      error: result.error ?? null,
    });
  }

  return NextResponse.json({
    success: true,
    snapshot_date: today,
    summary: {
      total_sites: sites.length,
      total_sitemap_urls: totalSitemap,
      total_indexed: totalIndexed,
      total_not_indexed: totalNotIndexed,
      global_indexation_rate: totalSitemap > 0
        ? Math.round((totalIndexed / totalSitemap) * 1000) / 10
        : 0,
      sites_with_errors: totalErrored,
    },
    results,
  });
}

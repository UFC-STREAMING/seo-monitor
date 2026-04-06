import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Get all user's sites
    const { data: sites } = await supabase
      .from("sites")
      .select("id, domain")
      .eq("user_id", user.id)
      .order("domain");

    if (!sites || sites.length === 0) {
      return NextResponse.json([]);
    }

    const siteIds = sites.map((s) => s.id);

    // Get all site_pages for these sites
    const { data: pages } = await supabase
      .from("site_pages")
      .select("site_id, url, source, index_status, product_name, submitted_at, indexed_at, created_at")
      .in("site_id", siteIds);

    // Build per-site stats
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const result = sites.map((site) => {
      const sitePages = (pages ?? []).filter((p) => p.site_id === site.id);

      const stats = {
        total_pages: sitePages.length,
        indexed: sitePages.filter((p) => p.index_status === "indexed").length,
        not_indexed: sitePages.filter((p) => p.index_status === "not_indexed").length,
        submitted: sitePages.filter((p) =>
          p.index_status === "reindex_submitted" || p.index_status === "submitted"
        ).length,
        unknown: sitePages.filter((p) =>
          !["indexed", "not_indexed", "reindex_submitted", "submitted"].includes(p.index_status)
        ).length,
        recently_submitted_7d: sitePages.filter((p) =>
          p.submitted_at && new Date(p.submitted_at) >= sevenDaysAgo
        ).length,
      };

      // Get webhook pages with timeline
      const webhookPages = sitePages
        .filter((p) => p.source === "webhook")
        .map((p) => {
          const daysToIndex =
            p.indexed_at && p.submitted_at
              ? Math.round(
                  (new Date(p.indexed_at).getTime() -
                    new Date(p.submitted_at).getTime()) /
                    (1000 * 60 * 60 * 24)
                )
              : null;

          return {
            url: p.url,
            product_name: p.product_name,
            created_at: p.created_at,
            submitted_at: p.submitted_at,
            indexed_at: p.indexed_at,
            index_status: p.index_status,
            days_to_index: daysToIndex,
          };
        })
        .sort(
          (a, b) =>
            new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        );

      return {
        site_id: site.id,
        domain: site.domain,
        ...stats,
        webhook_pages: webhookPages,
      };
    });

    return NextResponse.json(result);
  } catch (err) {
    console.error("Indexation stats error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

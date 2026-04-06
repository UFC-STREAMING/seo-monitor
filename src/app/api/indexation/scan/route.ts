import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { discoverSitemapUrls } from "@/lib/sitemap/parser";
import { createIndexerService } from "@/lib/indexer/factory";

export const maxDuration = 300; // 5 minutes max

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { siteId, method = "gsc", urls: manualUrls } = await request.json();

  if (!siteId) {
    return NextResponse.json({ error: "siteId is required" }, { status: 400 });
  }

  // Get site info
  const { data: site } = await supabase
    .from("sites")
    .select("id, domain")
    .eq("id", siteId)
    .eq("user_id", user.id)
    .single();

  if (!site) {
    return NextResponse.json({ error: "Site not found" }, { status: 404 });
  }

  // Get URLs: manual or from sitemap
  let urls: string[];
  let source: string;

  if (manualUrls && Array.isArray(manualUrls) && manualUrls.length > 0) {
    urls = manualUrls.filter((u: string) => u.trim());
    source = "manual";
  } else {
    urls = await discoverSitemapUrls(site.domain);
    source = "sitemap";
    if (urls.length === 0) {
      return NextResponse.json({ error: `No sitemap found for ${site.domain}` }, { status: 404 });
    }
  }

  // Upsert URLs into site_pages
  const toUpsert = urls.map((url) => ({
    site_id: siteId,
    url,
    source,
  }));

  for (let i = 0; i < toUpsert.length; i += 500) {
    const chunk = toUpsert.slice(i, i + 500);
    await supabase
      .from("site_pages")
      .upsert(chunk, { onConflict: "site_id,url", ignoreDuplicates: true });
  }

  if (method === "rapid") {
    return await handleRapidCheck(supabase, siteId, urls, user.id);
  } else {
    return await handleGscCheck(supabase, siteId, urls, user.id);
  }
}

async function handleRapidCheck(
  supabase: Awaited<ReturnType<typeof createClient>>,
  siteId: string,
  urls: string[],
  userId: string,
) {
  try {
    const indexer = createIndexerService();
    const { taskId } = await indexer.checkUrls(urls);

    await supabase
      .from("site_pages")
      .update({ checker_task_id: taskId, index_status: "checking" })
      .eq("site_id", siteId)
      .in("url", urls);

    await supabase.from("api_usage_log").insert({
      user_id: userId,
      service: "rapid_indexer",
      endpoint: "create_task/checker",
      credits_used: urls.length,
      cost_usd: 0,
    });

    return NextResponse.json({
      method: "rapid",
      taskId,
      urlsSubmitted: urls.length,
      message: `Submitted ${urls.length} URLs for index checking via Rapid Indexer`,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Rapid Indexer check failed" },
      { status: 500 },
    );
  }
}

async function handleGscCheck(
  supabase: Awaited<ReturnType<typeof createClient>>,
  siteId: string,
  urls: string[],
  userId: string,
) {
  // Get the GSC property linked to this site
  const { data: gscProperty } = await supabase
    .from("gsc_properties")
    .select("id")
    .eq("site_id", siteId)
    .eq("user_id", userId)
    .eq("is_active", true)
    .limit(1)
    .single();

  if (!gscProperty) {
    return NextResponse.json(
      { error: "No GSC property linked to this site. Link one in the Search Console page." },
      { status: 400 },
    );
  }

  // Get pages that appear in GSC (last 30 days = indexed)
  const sinceDate = new Date();
  sinceDate.setDate(sinceDate.getDate() - 30);
  const dateStr = sinceDate.toISOString().split("T")[0];

  const { data: gscPages } = await supabase
    .from("gsc_search_data")
    .select("page")
    .eq("gsc_property_id", gscProperty.id)
    .gte("date", dateStr)
    .gt("impressions", 0)
    .not("page", "is", null);

  const indexedPages = new Set(
    (gscPages ?? []).filter((p: { page: string | null }) => p.page !== null).map((p: { page: string | null }) => p.page as string)
  );

  let indexed = 0;
  let notIndexed = 0;
  const now = new Date().toISOString();

  for (const url of urls) {
    if (indexedPages.has(url)) {
      indexed++;
      await supabase
        .from("site_pages")
        .update({
          index_status: "indexed",
          last_checked_at: now,
          indexed_at: now,
        })
        .eq("site_id", siteId)
        .eq("url", url);
    } else {
      notIndexed++;
      await supabase
        .from("site_pages")
        .update({
          index_status: "not_indexed",
          last_checked_at: now,
        })
        .eq("site_id", siteId)
        .eq("url", url);
    }
  }

  // Log usage (GSC = free)
  await supabase.from("api_usage_log").insert({
    user_id: userId,
    service: "gsc",
    endpoint: "indexation/gsc-check",
    credits_used: 0,
    cost_usd: 0,
  });

  return NextResponse.json({
    method: "gsc",
    totalUrls: urls.length,
    indexed,
    notIndexed,
  });
}

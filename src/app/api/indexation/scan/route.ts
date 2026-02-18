import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { discoverSitemapUrls } from "@/lib/sitemap/parser";
import { extractSlugFromUrl, slugToKeyword, urlContainsSlug } from "@/lib/sitemap/slug";
import { DataForSeoClient } from "@/lib/dataforseo/client";
import { createIndexerService } from "@/lib/indexer/factory";

export const maxDuration = 300; // 5 minutes max

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { siteId, method = "google", urls: manualUrls } = await request.json();

  if (!siteId) {
    return NextResponse.json({ error: "siteId is required" }, { status: 400 });
  }

  // Get site info
  const { data: site } = await supabase
    .from("sites")
    .select("id, domain, location_code, locations(default_language)")
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

  // Upsert URLs into site_pages (ignore duplicates)
  const toUpsert = urls.map((url) => ({
    site_id: siteId,
    url,
    source,
  }));

  // Batch upsert in chunks of 500
  for (let i = 0; i < toUpsert.length; i += 500) {
    const chunk = toUpsert.slice(i, i + 500);
    await supabase
      .from("site_pages")
      .upsert(chunk, { onConflict: "site_id,url", ignoreDuplicates: true });
  }

  if (method === "rapid") {
    // Quick scan via Rapid Indexer checker
    return await handleRapidCheck(supabase, siteId, urls, user.id);
  } else {
    // Google check via DataForSEO site: queries
    const loc = site.locations as unknown as { default_language: string } | null;
    const locationCode = site.location_code ?? 2840; // default US
    const language = loc?.default_language ?? "en";
    return await handleGoogleCheck(supabase, site.domain, siteId, urls, locationCode, language, user.id);
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

    // Update site_pages with the checker task ID
    await supabase
      .from("site_pages")
      .update({ checker_task_id: taskId, index_status: "checking" })
      .eq("site_id", siteId)
      .in("url", urls);

    // Log usage
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

async function handleGoogleCheck(
  supabase: Awaited<ReturnType<typeof createClient>>,
  domain: string,
  siteId: string,
  urls: string[],
  locationCode: number,
  language: string,
  userId: string,
) {
  const dataforseo = new DataForSeoClient();
  let apiCalls = 0;
  let indexed = 0;
  let notIndexed = 0;
  const errors: string[] = [];

  for (const url of urls) {
    const slug = extractSlugFromUrl(url);
    if (!slug) {
      // Skip URLs without a meaningful slug (homepage, etc.)
      continue;
    }

    const keyword = slugToKeyword(slug);

    try {
      const result = await dataforseo.checkIndexation(
        domain,
        keyword,
        slug,
        locationCode,
        language,
      );
      apiCalls++;

      const now = new Date().toISOString();
      if (result.indexed) {
        indexed++;
        await supabase
          .from("site_pages")
          .update({ index_status: "indexed", last_checked_at: now })
          .eq("site_id", siteId)
          .eq("url", url);
      } else {
        notIndexed++;
        await supabase
          .from("site_pages")
          .update({ index_status: "not_indexed", last_checked_at: now })
          .eq("site_id", siteId)
          .eq("url", url);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${url}: ${msg}`);
    }
  }

  // Log API usage
  if (apiCalls > 0) {
    await supabase.from("api_usage_log").insert({
      user_id: userId,
      service: "dataforseo",
      endpoint: "serp/google/organic/live (site: check)",
      credits_used: apiCalls,
      cost_usd: apiCalls * 0.002,
    });
  }

  return NextResponse.json({
    method: "google",
    totalUrls: urls.length,
    indexed,
    notIndexed,
    apiCalls,
    errors: errors.length > 0 ? errors : undefined,
  });
}

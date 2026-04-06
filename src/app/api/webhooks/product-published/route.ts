import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { gscClient } from "@/lib/google/search-console";
import { RapidIndexerService } from "@/lib/indexer/rapid-indexer";

export async function POST(request: Request) {
  // Authenticate via shared webhook secret
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.WEBHOOK_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { url, domain, product_name } = await request.json();

  if (!url || !domain) {
    return NextResponse.json(
      { error: "url and domain are required" },
      { status: 400 }
    );
  }

  const supabase = createAdminClient();

  // Find site by domain
  const { data: site } = await supabase
    .from("sites")
    .select("id, user_id")
    .eq("domain", domain.replace(/^www\./, ""))
    .limit(1)
    .single();

  if (!site) {
    // Try with www prefix
    const { data: siteWww } = await supabase
      .from("sites")
      .select("id, user_id")
      .eq("domain", `www.${domain.replace(/^www\./, "")}`)
      .limit(1)
      .single();

    if (!siteWww) {
      return NextResponse.json(
        { error: `Site not found for domain: ${domain}` },
        { status: 404 }
      );
    }

    return processWebhook(supabase, siteWww, url, product_name);
  }

  return processWebhook(supabase, site, url, product_name);
}

async function processWebhook(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  site: { id: string; user_id: string },
  url: string,
  productName: string | undefined,
) {
  const now = new Date().toISOString();

  // Upsert into site_pages
  await supabase.from("site_pages").upsert(
    {
      site_id: site.id,
      url,
      source: "webhook",
      index_status: "submitted",
      product_name: productName ?? null,
      submitted_at: now,
    },
    { onConflict: "site_id,url" }
  );

  // Submit to Google Indexing API
  let googleSubmitted = false;
  if (gscClient.isConfigured()) {
    try {
      await gscClient.notifyUrlUpdate(url);
      googleSubmitted = true;
    } catch (err) {
      console.warn("[WEBHOOK] Google Indexing API error:", err);
    }
  }

  // Submit to Rapid Indexer
  let rapidTaskId: string | null = null;
  try {
    const rapidIndexer = new RapidIndexerService();
    const { taskId } = await rapidIndexer.submitUrls([url]);
    rapidTaskId = taskId;

    await supabase.from("indexer_tasks").insert({
      task_id: taskId,
      site_id: site.id,
      urls: [url],
      status: "pending",
    });
  } catch (err) {
    console.warn("[WEBHOOK] Rapid Indexer error:", err);
  }

  // Ping sitemaps (Google + Bing) - gratuit, no auth
  const domain = new URL(url).origin;
  const sitemapUrls = [
    `${domain}/sitemap.xml`,
    `${domain}/sitemap_index.xml`,
  ];
  let sitemapPinged = false;
  for (const sitemapUrl of sitemapUrls) {
    try {
      // Google ping
      await fetch(`https://www.google.com/ping?sitemap=${encodeURIComponent(sitemapUrl)}`);
      // Bing ping
      await fetch(`https://www.bing.com/ping?sitemap=${encodeURIComponent(sitemapUrl)}`);
      sitemapPinged = true;
      break; // Un seul sitemap suffit
    } catch {
      // Essayer le suivant
    }
  }

  // IndexNow (Bing/Yandex/Naver) - gratuit, accepte tout type de page
  let indexNowSubmitted = false;
  const indexNowKey = process.env.INDEXNOW_KEY;
  if (indexNowKey) {
    try {
      const res = await fetch("https://api.indexnow.org/indexnow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          host: new URL(url).hostname,
          key: indexNowKey,
          urlList: [url],
        }),
      });
      indexNowSubmitted = res.ok || res.status === 202;
    } catch (err) {
      console.warn("[WEBHOOK] IndexNow error:", err);
    }
  }

  // Log API usage
  await supabase.from("api_usage_log").insert({
    user_id: site.user_id,
    service: "google_indexing",
    endpoint: "webhook/product-published",
    credits_used: 1,
    cost_usd: 0,
  });

  console.log(
    `[WEBHOOK] Product published: ${url} (google: ${googleSubmitted}, rapid: ${rapidTaskId}, sitemap_ping: ${sitemapPinged}, indexnow: ${indexNowSubmitted})`
  );

  return NextResponse.json({
    success: true,
    url,
    google_submitted: googleSubmitted,
    rapid_task_id: rapidTaskId,
    sitemap_pinged: sitemapPinged,
    indexnow_submitted: indexNowSubmitted,
  });
}

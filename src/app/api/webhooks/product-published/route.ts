import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(request: Request) {
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
      product_name: productName ?? null,
      submitted_at: now,
    },
    { onConflict: "site_id,url" }
  );

  // Ping sitemaps (Google + Bing) - free, no auth
  const origin = new URL(url).origin;
  const sitemapUrls = [
    `${origin}/sitemap.xml`,
    `${origin}/sitemap_index.xml`,
  ];
  let sitemapPinged = false;
  for (const sitemapUrl of sitemapUrls) {
    try {
      await fetch(`https://www.google.com/ping?sitemap=${encodeURIComponent(sitemapUrl)}`);
      await fetch(`https://www.bing.com/ping?sitemap=${encodeURIComponent(sitemapUrl)}`);
      sitemapPinged = true;
      break;
    } catch {
      // try next
    }
  }

  // IndexNow (Bing/Yandex/Naver) - free
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
    } catch {
      // ignore
    }
  }

  return NextResponse.json({
    success: true,
    url,
    sitemap_pinged: sitemapPinged,
    indexnow_submitted: indexNowSubmitted,
  });
}

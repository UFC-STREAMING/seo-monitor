import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

/**
 * POST: Sync keywords to all sites — ensures every site has all keywords
 * for its location_code. Fixes cases where sites were added before keywords
 * existed, or where auto-copy failed.
 */
export async function POST() {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Get all user sites
    const { data: sites } = await supabase
      .from("sites")
      .select("id, location_code")
      .eq("user_id", user.id)
      .not("location_code", "is", null);

    if (!sites || sites.length === 0) {
      return NextResponse.json({ message: "No sites found", added: 0 });
    }

    // Get all existing keywords for user's sites
    const siteIds = sites.map((s) => s.id);
    const { data: existingKeywords } = await supabase
      .from("keywords")
      .select("keyword, location_code, site_id")
      .in("site_id", siteIds);

    // Build a set of existing (keyword, location_code, site_id) combos
    const existingSet = new Set(
      (existingKeywords ?? []).map(
        (k) => `${k.keyword}::${k.location_code}::${k.site_id}`
      )
    );

    // Build a set of unique (keyword, location_code) pairs
    const uniqueKeywords = new Map<string, { keyword: string; location_code: number }>();
    (existingKeywords ?? []).forEach((k) => {
      const key = `${k.keyword}::${k.location_code}`;
      if (!uniqueKeywords.has(key)) {
        uniqueKeywords.set(key, { keyword: k.keyword, location_code: k.location_code });
      }
    });

    // For each site, check which keywords from the same location_code it's missing
    const toInsert: Array<{ site_id: string; keyword: string; location_code: number }> = [];

    sites.forEach((site) => {
      uniqueKeywords.forEach(({ keyword, location_code }) => {
        if (location_code !== site.location_code) return;
        const key = `${keyword}::${location_code}::${site.id}`;
        if (!existingSet.has(key)) {
          toInsert.push({ site_id: site.id, keyword, location_code });
          existingSet.add(key);
        }
      });
    });

    if (toInsert.length === 0) {
      return NextResponse.json({ message: "All sites already have all keywords", added: 0 });
    }

    // Insert in chunks
    let added = 0;
    const CHUNK = 100;
    for (let i = 0; i < toInsert.length; i += CHUNK) {
      const chunk = toInsert.slice(i, i + CHUNK);
      const { error } = await supabase.from("keywords").insert(chunk);
      if (!error) added += chunk.length;
    }

    return NextResponse.json({
      message: `Synced ${added} keyword entries across sites`,
      added,
    });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getSecondaryKeywords(supabase: any, userId: string) {
  // Get all keywords for the user's sites
  const { data: keywords, error } = await supabase
    .from("keywords")
    .select("id, keyword, location_code, site_id, sites!inner(user_id)")
    .eq("sites.user_id", userId);

  if (error || !keywords) return { brands: [], secondary: [], error };

  const typedKeywords = keywords as Array<{
    id: string;
    keyword: string;
    location_code: number;
    site_id: string;
  }>;

  // Group by location_code
  const byLocation = new Map<number, Array<{ id: string; keyword: string; site_id: string }>>();
  typedKeywords.forEach((k) => {
    const list = byLocation.get(k.location_code) || [];
    list.push({ id: k.id, keyword: k.keyword, site_id: k.site_id });
    byLocation.set(k.location_code, list);
  });

  const brands: string[] = [];
  const secondary: Array<{ id: string; keyword: string; location_code: number }> = [];

  // Collect ALL unique keywords across all locations to build the brand list
  const allUniqueKeywords = new Set<string>();
  byLocation.forEach((kwList) => {
    kwList.forEach((k) => allUniqueKeywords.add(k.keyword));
  });

  // Normalize: build a map of lowercase → original keyword
  // Single-word keywords or short keywords (<=2 words) that appear standalone = brands
  const allKwArray = [...allUniqueKeywords];
  allKwArray.sort((a, b) => a.length - b.length);

  // Build brand set: a keyword is a brand if it's a single word OR
  // if no shorter keyword is fully contained in it as a word boundary match
  const globalBrandSet = new Set<string>();

  allKwArray.forEach((kw) => {
    const kwLower = kw.toLowerCase().replace(/[^a-z0-9àâäéèêëïîôùûüçß\s]/g, "");
    const kwWords = kwLower.split(/\s+/);

    // Check if this keyword CONTAINS any existing brand as a word/phrase
    const containsBrand = [...globalBrandSet].some((brand) => {
      const brandLower = brand.toLowerCase().replace(/[^a-z0-9àâäéèêëïîôùûüçß\s]/g, "");
      if (kwLower === brandLower) return false; // same keyword
      // Check if brand appears as a whole word in this keyword
      const brandWords = brandLower.split(/\s+/);
      // Check contiguous subsequence match
      for (let i = 0; i <= kwWords.length - brandWords.length; i++) {
        const slice = kwWords.slice(i, i + brandWords.length).join(" ");
        if (slice === brandWords.join(" ")) return true;
      }
      // Also check normalized (no spaces) match: "SlimJara" vs "slim jara"
      const kwNoSpace = kwLower.replace(/\s+/g, "");
      const brandNoSpace = brandLower.replace(/\s+/g, "");
      if (kwNoSpace !== brandNoSpace && kwNoSpace.includes(brandNoSpace) && brandNoSpace.length >= 4) return true;
      return false;
    });

    if (!containsBrand) {
      globalBrandSet.add(kw);
    }
  });

  byLocation.forEach((kwList, locationCode) => {
    kwList.forEach((k) => {
      if (globalBrandSet.has(k.keyword)) {
        brands.push(k.keyword);
      } else {
        secondary.push({ id: k.id, keyword: k.keyword, location_code: locationCode });
      }
    });
  });

  return { brands: [...new Set(brands)], secondary, error: null };
}

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { brands, secondary, error } = await getSecondaryKeywords(supabase, user.id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Group secondary by keyword for a cleaner preview
    const grouped = new Map<string, { keyword: string; count: number; location_codes: number[] }>();
    secondary.forEach((s) => {
      const key = `${s.keyword}::${s.location_code}`;
      const existing = grouped.get(key);
      if (existing) {
        existing.count++;
      } else {
        grouped.set(key, { keyword: s.keyword, count: 1, location_codes: [s.location_code] });
      }
    });

    return NextResponse.json({
      brands,
      toRemove: Array.from(grouped.values()),
      totalEntries: secondary.length,
    });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { secondary, error } = await getSecondaryKeywords(supabase, user.id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (secondary.length === 0) {
      return NextResponse.json({ message: "No secondary keywords to remove", removed: 0 });
    }

    // Delete in chunks of 100
    let removed = 0;
    const CHUNK = 100;
    for (let i = 0; i < secondary.length; i += CHUNK) {
      const ids = secondary.slice(i, i + CHUNK).map((s) => s.id);
      const { count } = await supabase
        .from("keywords")
        .delete({ count: "exact" })
        .in("id", ids);
      removed += count ?? 0;
    }

    return NextResponse.json({
      message: `Removed ${removed} secondary keyword entries`,
      removed,
    });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

export async function GET() {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const { data: sites, error } = await supabase
      .from("sites")
      .select("*, keywords(count), locations(name, country_iso)")
      .eq("user_id", user.id)
      .order("domain");

    if (error) {
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }

    const sitesWithCount = (sites ?? []).map((site) => ({
      ...site,
      keyword_count:
        (site.keywords as unknown as { count: number }[])?.[0]?.count ?? 0,
    }));

    return NextResponse.json(sitesWithCount);
  } catch (err) {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { domain, niche, site_type, location_code, ip, hosting } = body;

    if (!domain || !niche || !site_type) {
      return NextResponse.json(
        { error: "domain, niche, and site_type are required" },
        { status: 400 }
      );
    }

    if (!["casino", "nutra"].includes(niche)) {
      return NextResponse.json(
        { error: "niche must be 'casino' or 'nutra'" },
        { status: 400 }
      );
    }

    if (!["money", "emd", "pbn", "nutra"].includes(site_type)) {
      return NextResponse.json(
        { error: "site_type must be 'money', 'emd', 'pbn', or 'nutra'" },
        { status: 400 }
      );
    }

    const { data: site, error } = await supabase
      .from("sites")
      .insert({
        user_id: user.id,
        domain: domain.trim(),
        niche,
        site_type,
        location_code: location_code || null,
        ip: ip?.trim() || null,
        hosting: hosting?.trim() || null,
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }

    // Auto-copy keywords: get all unique keywords for this country from other sites
    if (site && location_code) {
      try {
        const { data: existingKeywords } = await supabase
          .from("keywords")
          .select("keyword, location_code")
          .eq("location_code", location_code)
          .neq("site_id", site.id);

        // Deduplicate by keyword
        const unique = new Map<string, { keyword: string; location_code: number }>();
        (existingKeywords ?? []).forEach((k) => {
          if (!unique.has(k.keyword)) {
            unique.set(k.keyword, { keyword: k.keyword, location_code: k.location_code });
          }
        });

        if (unique.size > 0) {
          const toInsert = Array.from(unique.values()).map((kw) => ({
            site_id: site.id,
            keyword: kw.keyword,
            location_code: kw.location_code,
          }));

          await supabase.from("keywords").insert(toInsert);
        }
      } catch (err) {
        console.error("Auto-copy keywords error:", err);
      }
    }

    return NextResponse.json(site, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

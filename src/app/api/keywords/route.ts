import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
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

    const { searchParams } = new URL(request.url);
    const siteId = searchParams.get("site_id");

    let query = supabase
      .from("keywords")
      .select("*, sites!inner(user_id, domain), locations(*)")
      .eq("sites.user_id", user.id)
      .order("keyword");

    if (siteId) {
      query = query.eq("site_id", siteId);
    }

    const { data: keywords, error } = await query;

    if (error) {
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json(keywords);
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
    const { keyword, location_code, site_id } = body;

    if (!keyword || !location_code) {
      return NextResponse.json(
        { error: "keyword and location_code are required" },
        { status: 400 }
      );
    }

    // Verify the location exists
    const { data: location } = await supabase
      .from("locations")
      .select("code")
      .eq("code", location_code)
      .single();

    if (!location) {
      return NextResponse.json(
        { error: "Invalid location_code" },
        { status: 400 }
      );
    }

    // If site_id is provided, add to that site only (legacy per-site add)
    if (site_id) {
      const { data: site } = await supabase
        .from("sites")
        .select("id")
        .eq("id", site_id)
        .eq("user_id", user.id)
        .single();

      if (!site) {
        return NextResponse.json(
          { error: "Site not found" },
          { status: 404 }
        );
      }

      const { data: newKeyword, error } = await supabase
        .from("keywords")
        .insert({
          site_id,
          keyword: keyword.trim(),
          location_code,
        })
        .select("*, locations(*)")
        .single();

      if (error) {
        return NextResponse.json(
          { error: error.message },
          { status: 500 }
        );
      }

      return NextResponse.json(newKeyword, { status: 201 });
    }

    // Global add: add keyword to ALL sites that have this location_code
    const { data: sites } = await supabase
      .from("sites")
      .select("id")
      .eq("user_id", user.id)
      .eq("location_code", location_code);

    if (!sites || sites.length === 0) {
      return NextResponse.json(
        { error: `No sites found for this country. Add sites first.` },
        { status: 400 }
      );
    }

    // Check which sites already have this keyword to avoid duplicates
    const { data: existingKeywords } = await supabase
      .from("keywords")
      .select("site_id")
      .eq("keyword", keyword.trim())
      .eq("location_code", location_code)
      .in("site_id", sites.map((s) => s.id));

    const existingSet = new Set((existingKeywords ?? []).map((k) => k.site_id));
    const toInsert = sites
      .filter((s) => !existingSet.has(s.id))
      .map((s) => ({
        site_id: s.id,
        keyword: keyword.trim(),
        location_code,
      }));

    if (toInsert.length === 0) {
      return NextResponse.json(
        { message: "Keyword already exists on all sites for this country" },
        { status: 200 }
      );
    }

    const { error } = await supabase.from("keywords").insert(toInsert);

    if (error) {
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { message: `Keyword "${keyword}" added to ${toInsert.length} sites`, count: toInsert.length },
      { status: 201 }
    );
  } catch (err) {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
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

    const { searchParams } = new URL(request.url);
    const keyword = searchParams.get("keyword");
    const locationCode = searchParams.get("location_code");

    if (!keyword || !locationCode) {
      return NextResponse.json(
        { error: "keyword and location_code are required" },
        { status: 400 }
      );
    }

    // Get user's site IDs to ensure ownership
    const { data: sites } = await supabase
      .from("sites")
      .select("id")
      .eq("user_id", user.id);

    if (!sites || sites.length === 0) {
      return NextResponse.json({ message: "No sites found" }, { status: 404 });
    }

    const siteIds = sites.map((s) => s.id);

    const { error, count } = await supabase
      .from("keywords")
      .delete({ count: "exact" })
      .eq("keyword", keyword)
      .eq("location_code", parseInt(locationCode, 10))
      .in("site_id", siteIds);

    if (error) {
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      message: `Keyword "${keyword}" deleted from ${count} sites`,
      count,
    });
  } catch (err) {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

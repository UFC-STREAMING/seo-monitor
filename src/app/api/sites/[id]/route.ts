import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
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

    // Fetch site
    const { data: site, error: siteError } = await supabase
      .from("sites")
      .select("*")
      .eq("id", id)
      .eq("user_id", user.id)
      .single();

    if (siteError || !site) {
      return NextResponse.json(
        { error: "Site not found" },
        { status: 404 }
      );
    }

    // Fetch keywords with locations
    const { data: keywords } = await supabase
      .from("keywords")
      .select("*, locations(*)")
      .eq("site_id", id)
      .order("keyword");

    return NextResponse.json({
      ...site,
      keywords: keywords ?? [],
    });
  } catch (err) {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
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

    // Verify ownership
    const { data: existingSite } = await supabase
      .from("sites")
      .select("id")
      .eq("id", id)
      .eq("user_id", user.id)
      .single();

    if (!existingSite) {
      return NextResponse.json(
        { error: "Site not found" },
        { status: 404 }
      );
    }

    const body = await request.json();
    const { domain, niche, site_type, ip, hosting, is_active } = body;

    // Validate optional fields
    if (niche && !["casino", "nutra"].includes(niche)) {
      return NextResponse.json(
        { error: "niche must be 'casino' or 'nutra'" },
        { status: 400 }
      );
    }

    if (site_type && !["money", "emd", "pbn", "nutra"].includes(site_type)) {
      return NextResponse.json(
        { error: "site_type must be 'money', 'emd', 'pbn', or 'nutra'" },
        { status: 400 }
      );
    }

    const updateData: Record<string, unknown> = {};
    if (domain !== undefined) updateData.domain = domain.trim();
    if (niche !== undefined) updateData.niche = niche;
    if (site_type !== undefined) updateData.site_type = site_type;
    if (ip !== undefined) updateData.ip = ip?.trim() || null;
    if (hosting !== undefined) updateData.hosting = hosting?.trim() || null;
    if (is_active !== undefined) updateData.is_active = is_active;

    const { data: site, error } = await supabase
      .from("sites")
      .update(updateData)
      .eq("id", id)
      .select()
      .single();

    if (error) {
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json(site);
  } catch (err) {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
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

    // Verify ownership
    const { data: existingSite } = await supabase
      .from("sites")
      .select("id")
      .eq("id", id)
      .eq("user_id", user.id)
      .single();

    if (!existingSite) {
      return NextResponse.json(
        { error: "Site not found" },
        { status: 404 }
      );
    }

    // Delete associated GSC properties (and their search data via cascade)
    await supabase
      .from("gsc_properties")
      .delete()
      .eq("site_id", id);

    const { error } = await supabase
      .from("sites")
      .delete()
      .eq("id", id);

    if (error) {
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ message: "Site deleted successfully" });
  } catch (err) {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

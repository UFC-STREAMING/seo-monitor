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
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: rules } = await supabase
      .from("gsc_auto_rules")
      .select("*")
      .eq("user_id", user.id)
      .single();

    // Return defaults if no rules exist
    return NextResponse.json(
      rules ?? {
        min_clicks_keyword: 23,
        min_clicks_page_daily: 5,
        auto_add_enabled: true,
      }
    );
  } catch (err) {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { min_clicks_keyword, min_clicks_page_daily, auto_add_enabled } =
      body;

    const { data, error } = await supabase
      .from("gsc_auto_rules")
      .upsert(
        {
          user_id: user.id,
          min_clicks_keyword: min_clicks_keyword ?? 23,
          min_clicks_page_daily: min_clicks_page_daily ?? 5,
          auto_add_enabled: auto_add_enabled ?? true,
        },
        { onConflict: "user_id" }
      )
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

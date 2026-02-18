import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createIndexerService } from "@/lib/indexer/factory";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const indexer = createIndexerService();
    const { remaining } = await indexer.getCredits();
    return NextResponse.json({ remaining });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch credits" },
      { status: 500 }
    );
  }
}

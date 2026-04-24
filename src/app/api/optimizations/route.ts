import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { OptimizationStatus, OptimizationTrigger } from "@/types/database";

export const maxDuration = 30;

/**
 * GET /api/optimizations
 * Liste les optimisations de contenu.
 *
 * Query params:
 *   - status: pending | in_progress | completed | failed | all (défaut: all)
 *   - limit: nombre max (défaut: 50)
 *   - agent: filtrer par agent_name
 */
export async function GET(request: NextRequest) {
  const supabase = createAdminClient();

  const authHeader = request.headers.get("authorization");
  const isCron = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  if (!isCron) {
    const { createClient } = await import("@/lib/supabase/server");
    const userSupabase = await createClient();
    const { data: { user }, error } = await userSupabase.auth.getUser();
    if (error || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status") ?? "all";
  const limit = parseInt(searchParams.get("limit") ?? "50", 10);
  const agent = searchParams.get("agent");

  let query = supabase
    .from("content_optimizations")
    .select("*")
    .order("requested_at", { ascending: false })
    .limit(limit);

  if (status !== "all") {
    query = query.eq("status", status as OptimizationStatus);
  }
  if (agent) {
    query = query.eq("agent_name", agent);
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Summary counts
  const { count: pendingCount } = await supabase
    .from("content_optimizations")
    .select("*", { count: "exact", head: true })
    .eq("status", "pending");

  const { count: inProgressCount } = await supabase
    .from("content_optimizations")
    .select("*", { count: "exact", head: true })
    .eq("status", "in_progress");

  const { count: completedCount } = await supabase
    .from("content_optimizations")
    .select("*", { count: "exact", head: true })
    .eq("status", "completed");

  return NextResponse.json({
    optimizations: data ?? [],
    total: (data ?? []).length,
    summary: {
      pending: pendingCount ?? 0,
      in_progress: inProgressCount ?? 0,
      completed: completedCount ?? 0,
    },
  });
}

/**
 * POST /api/optimizations
 * Créer une nouvelle tâche d'optimisation (appelé par to-optimize ou manuellement).
 *
 * Body: { page_url, site_id?, trigger, metrics_before?, agent_name?, brand_name? }
 */
export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { page_url, site_id, trigger, metrics_before, agent_name, brand_name } = body;

  if (!page_url || !trigger) {
    return NextResponse.json({ error: "page_url and trigger are required" }, { status: 400 });
  }

  const supabase = createAdminClient();

  // Avoid duplicates: don't create if same page+trigger is pending/in_progress
  const { data: existing } = await supabase
    .from("content_optimizations")
    .select("id")
    .eq("page_url", page_url)
    .in("status", ["pending", "in_progress"])
    .maybeSingle();

  if (existing) {
    return NextResponse.json({ message: "Optimization already queued", id: existing.id });
  }

  const { data, error } = await supabase
    .from("content_optimizations")
    .insert({
      page_url,
      site_id: site_id ?? null,
      trigger: trigger as OptimizationTrigger,
      metrics_before: metrics_before ?? {},
      agent_name: agent_name ?? null,
      brand_name: brand_name ?? null,
    })
    .select("id")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ id: data.id, status: "pending" }, { status: 201 });
}

/**
 * PATCH /api/optimizations
 * Reporter le résultat d'une optimisation (appelé par Hermes après exécution).
 *
 * Body: { id, status, changes_made?, metrics_after? }
 */
export async function PATCH(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { id, status, changes_made, metrics_after } = body;

  if (!id || !status) {
    return NextResponse.json({ error: "id and status are required" }, { status: 400 });
  }

  const supabase = createAdminClient();

  const update: Record<string, unknown> = {
    status: status as OptimizationStatus,
  };

  if (status === "in_progress") {
    update.started_at = new Date().toISOString();
  }
  if (status === "completed" || status === "failed") {
    update.completed_at = new Date().toISOString();
  }
  if (changes_made) update.changes_made = changes_made;
  if (metrics_after) update.metrics_after = metrics_after;

  const { error } = await supabase
    .from("content_optimizations")
    .update(update)
    .eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ id, status });
}

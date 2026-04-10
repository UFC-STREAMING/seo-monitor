import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 60;

/**
 * GET /api/cron/archive-old-alerts
 *
 * Cron nightly qui auto-archive (is_read=true) toutes les alertes > 7 jours.
 *
 * Rationale : une alerte qui n'a pas été lue en 7 jours ne le sera jamais.
 * Elle est soit obsolète, soit plus pertinente. Passer le compteur de 1005
 * à ~50 permet au cerveau de voir à nouveau les vrais signaux.
 *
 * Schedule : 0 3 * * *  (tous les jours à 3h du matin, avant le daily-briefing 7h)
 */
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();

  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const cutoffIso = sevenDaysAgo.toISOString();

  // Count total unread (before any update)
  const { count: unreadBefore } = await supabase
    .from("alerts")
    .select("*", { count: "exact", head: true })
    .eq("is_read", false);

  // Count how many will be archived (>7d + unread)
  const { count: toArchive } = await supabase
    .from("alerts")
    .select("*", { count: "exact", head: true })
    .lt("created_at", cutoffIso)
    .eq("is_read", false);

  // Archive old unread alerts (update itself doesn't return count via JS client)
  const { error } = await supabase
    .from("alerts")
    .update({ is_read: true })
    .lt("created_at", cutoffIso)
    .eq("is_read", false);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Count after
  const { count: unreadAfter } = await supabase
    .from("alerts")
    .select("*", { count: "exact", head: true })
    .eq("is_read", false);

  return NextResponse.json({
    archived: toArchive ?? 0,
    unread_before: unreadBefore ?? 0,
    unread_after: unreadAfter ?? 0,
    cutoff_date: cutoffIso,
    timestamp: new Date().toISOString(),
  });
}

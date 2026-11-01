/**
 * Recalcule les clics Everflow de tracking_daily après un changement de filtre.
 *   npx tsx scripts/backfill-tracking.ts 28
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { createAdminClient } from "@/lib/supabase/admin";
import { syncEverflow } from "@/lib/tracking/sync";

syncEverflow(createAdminClient(), Number(process.argv[2]) || 28).then((r) => console.log(r));

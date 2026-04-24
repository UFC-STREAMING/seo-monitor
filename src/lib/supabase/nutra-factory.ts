import { createClient } from "@supabase/supabase-js";

/**
 * Client Supabase pour Nutra Factory (base externe).
 * Utilisé pour récupérer les noms de produits (brands) à tracker.
 */
export function createNutraFactoryClient() {
  const url = process.env.NUTRA_FACTORY_SUPABASE_URL;
  const key = process.env.NUTRA_FACTORY_SUPABASE_KEY;

  if (!url || !key) {
    throw new Error("NUTRA_FACTORY_SUPABASE_URL and NUTRA_FACTORY_SUPABASE_KEY must be set");
  }

  return createClient(url, key);
}

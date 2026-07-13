import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 60;

// Écriture par l'agent Hermes EMD Generator (Bearer CRON_SECRET).
// C'est LUI qui achète les domaines et déploie les sites : il enregistre ici
// le domaine, le mot-clé cible, le pays et les COÛTS réels (prix d'achat
// registrar, renouvellement) au moment de la création → le ROI de la page
// /rankings est calculé automatiquement, sans saisie manuelle de Leo.
//
// Body JSON (tout optionnel sauf domain) :
// {
//   "domain": "jetterix.es",
//   "keyword": "jetterix",            // mot-clé principal SERP
//   "country_iso": "ES",              // pays cible (2 lettres)
//   "purchase_price": 8.43,           // prix d'achat USD (Dynadot/InternetBS)
//   "purchase_date": "2026-07-13",
//   "renewal_price": 12.99,
//   "renewal_date": "2027-07-13",
//   "registrar": "dynadot",
//   "niche": "nutra" | "casino",
//   "notes": "offre Everflow XYZ"
// }
// Idempotent : rappeler avec le même domain met à jour les champs fournis.
export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body JSON requis" }, { status: 400 });
  }

  const domain = String(body.domain ?? "").trim().toLowerCase();
  if (!domain || !domain.includes(".")) {
    return NextResponse.json({ error: "domain invalide" }, { status: 400 });
  }

  const supabase = createAdminClient();

  // user_id mono-utilisateur (repris d'un site existant)
  const { data: anySite } = await supabase
    .from("sites")
    .select("user_id")
    .limit(1)
    .single();
  if (!anySite) {
    return NextResponse.json({ error: "Aucun user_id disponible" }, { status: 500 });
  }

  // Pays -> location_code DataForSEO
  const countryIso = body.country_iso
    ? String(body.country_iso).trim().toUpperCase()
    : null;
  let locationCode: number | null = null;
  if (countryIso) {
    const { data: loc } = await supabase
      .from("locations")
      .select("code")
      .eq("country_iso", countryIso)
      .limit(1)
      .maybeSingle();
    if (!loc) {
      return NextResponse.json({ error: `Pays inconnu: ${countryIso}` }, { status: 400 });
    }
    locationCode = loc.code;
  }

  const keyword = body.keyword ? String(body.keyword).trim().toLowerCase() : null;
  const niche = body.niche === "casino" ? "casino" : "nutra";

  // ── Site (upsert par domain) ────────────────────────────────────────────
  const { data: existing } = await supabase
    .from("sites")
    .select("id")
    .eq("domain", domain)
    .maybeSingle();

  let siteId: string;
  if (existing) {
    siteId = existing.id;
    const patch: Record<string, unknown> = {
      category: "emd",
      site_type: "emd",
      is_active: true,
    };
    if (locationCode) patch.location_code = locationCode;
    if (body.registrar) patch.registrar = String(body.registrar);
    if (keyword) patch.serp_tracking_enabled = true;
    const { error } = await supabase.from("sites").update(patch).eq("id", siteId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  } else {
    const { data, error } = await supabase
      .from("sites")
      .insert({
        user_id: anySite.user_id,
        domain,
        niche,
        site_type: "emd",
        category: "emd",
        serp_tracking_enabled: !!keyword,
        is_active: true,
        hosting: "cloudflare",
        registrar: body.registrar ? String(body.registrar) : null,
        location_code: locationCode,
      })
      .select("id")
      .single();
    if (error || !data) {
      return NextResponse.json({ error: error?.message }, { status: 500 });
    }
    siteId = data.id;
  }

  // ── Mot-clé principal ───────────────────────────────────────────────────
  let keywordSet = false;
  if (keyword && locationCode) {
    const { data: oldPrimary } = await supabase
      .from("keywords")
      .select("id, keyword, location_code")
      .eq("site_id", siteId)
      .eq("is_primary", true)
      .maybeSingle();

    if (!oldPrimary || oldPrimary.keyword !== keyword || oldPrimary.location_code !== locationCode) {
      if (oldPrimary) {
        await supabase.from("keywords").update({ is_primary: false }).eq("id", oldPrimary.id);
      }
      const { data: sameRow } = await supabase
        .from("keywords")
        .select("id")
        .eq("site_id", siteId)
        .eq("keyword", keyword)
        .eq("location_code", locationCode)
        .maybeSingle();
      if (sameRow) {
        await supabase.from("keywords").update({ is_primary: true }).eq("id", sameRow.id);
      } else {
        const { error } = await supabase
          .from("keywords")
          .insert({ site_id: siteId, keyword, location_code: locationCode, is_primary: true });
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      }
    }
    keywordSet = true;
  }

  // ── Finance (upsert, seuls les champs fournis sont écrits) ─────────────
  const finPatch: Record<string, unknown> = {};
  if (body.purchase_price !== undefined) finPatch.purchase_price = Number(body.purchase_price) || 0;
  if (body.renewal_price !== undefined) finPatch.renewal_price = Number(body.renewal_price) || 0;
  if (body.purchase_date !== undefined) finPatch.purchase_date = body.purchase_date || null;
  if (body.renewal_date !== undefined) finPatch.renewal_date = body.renewal_date || null;
  if (body.notes !== undefined) finPatch.notes = body.notes || null;

  const { data: fin } = await supabase
    .from("domain_finance")
    .select("id")
    .eq("site_id", siteId)
    .maybeSingle();

  if (fin) {
    if (Object.keys(finPatch).length > 0) {
      const { error } = await supabase
        .from("domain_finance")
        .update({ ...finPatch, updated_at: new Date().toISOString() })
        .eq("id", fin.id);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }
  } else {
    const { error } = await supabase
      .from("domain_finance")
      .insert({ site_id: siteId, ...finPatch });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    site_id: siteId,
    domain,
    keyword_set: keywordSet,
    finance_updated: Object.keys(finPatch).length > 0,
    // Rappel pour le pipeline : le sub1 à mettre dans le worker
    sub1: domain.replace(/\./g, "-"),
  });
}

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// API de la page /rankings : suivi domaines EMD (mot-clé principal, positions,
// coûts, revenus, ROI) + classement des domaines importés de Cloudflare.

const HISTORY_DAYS = 180;

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Sites EMD + à classer
  const { data: sites, error: sitesErr } = await supabase
    .from("sites")
    .select("id, domain, category, site_type, cf_account, hosting, created_at, affiliate_url, affiliate_status, affiliate_detail, affiliate_offer, affiliate_checked_at, is_active, serp_tracking_enabled, location_code, last_rebuild_at, last_rebuild_reason, last_rebuild_by, indexed_pages")
    .in("category", ["emd", "other"])
    .eq("user_id", user.id)
    .order("domain");
  if (sitesErr) {
    return NextResponse.json({ error: sitesErr.message }, { status: 500 });
  }

  const emdSites = (sites ?? []).filter((s) => s.category === "emd");
  const toClassify = (sites ?? []).filter((s) => s.category === "other");
  const emdIds = emdSites.map((s) => s.id);

  // Mot-clé principal de chaque site EMD
  const { data: primaryKeywords } = emdIds.length
    ? await supabase
        .from("keywords")
        .select("id, site_id, keyword, location_code, locations(country_iso)")
        .in("site_id", emdIds)
        .eq("is_primary", true)
    : { data: [] };

  const kwBySite = new Map(
    (primaryKeywords ?? []).map((k) => [k.site_id, k])
  );
  const keywordIds = (primaryKeywords ?? []).map((k) => k.id);

  // Historique des positions (180 jours) du mot-clé principal
  const since = new Date(Date.now() - HISTORY_DAYS * 86400_000).toISOString();
  const { data: positions } = keywordIds.length
    ? await supabase
        .from("keyword_positions")
        .select("keyword_id, position, url_found, checked_at")
        .in("keyword_id", keywordIds)
        .gte("checked_at", since)
        .order("checked_at", { ascending: true })
    : { data: [] };

  const historyByKeyword = new Map<string, Array<{ position: number | null; checked_at: string }>>();
  for (const p of positions ?? []) {
    const list = historyByKeyword.get(p.keyword_id) ?? [];
    list.push({ position: p.position, checked_at: p.checked_at });
    historyByKeyword.set(p.keyword_id, list);
  }

  // Finance + revenus
  const { data: finance } = emdIds.length
    ? await supabase.from("domain_finance").select("*").in("site_id", emdIds)
    : { data: [] };
  const financeBySite = new Map((finance ?? []).map((f) => [f.site_id, f]));

  const { data: revenue } = emdIds.length
    ? await supabase
        .from("domain_revenue")
        .select("site_id, conversions, revenue_usd")
        .in("site_id", emdIds)
    : { data: [] };
  const revenueBySite = new Map<string, { revenue: number; conversions: number }>();
  for (const r of revenue ?? []) {
    const cur = revenueBySite.get(r.site_id) ?? { revenue: 0, conversions: 0 };
    cur.revenue += Number(r.revenue_usd);
    cur.conversions += r.conversions;
    revenueBySite.set(r.site_id, cur);
  }

  let totalSpent = 0;
  let totalRevenue = 0;

  const rows = emdSites.map((site) => {
    const kw = kwBySite.get(site.id);
    const history = kw ? historyByKeyword.get(kw.id) ?? [] : [];
    const current = history.length ? history[history.length - 1] : null;
    const previous = history.length > 1 ? history[history.length - 2] : null;
    const fin = financeBySite.get(site.id) ?? null;
    const rev = revenueBySite.get(site.id) ?? { revenue: 0, conversions: 0 };

    const spent = fin ? Number(fin.purchase_price) + Number(fin.renewal_price) : 0;
    totalSpent += spent;
    totalRevenue += rev.revenue;

    const loc = kw?.locations as unknown as { country_iso: string } | null;

    return {
      site_id: site.id,
      domain: site.domain,
      is_active: site.is_active,
      // Suivi des refontes : l'agent quotidien met un domaine en
      // quarantaine 30 jours apres l'avoir retravaille.
      last_rebuild_at: site.last_rebuild_at ?? null,
      last_rebuild_reason: site.last_rebuild_reason ?? null,
      last_rebuild_by: site.last_rebuild_by ?? null,
      indexed_pages: site.indexed_pages ?? null,
      serp_tracking_enabled: site.serp_tracking_enabled,
      cf_account: site.cf_account,
      hosting: site.hosting ?? null,
      affiliate: {
        url: site.affiliate_url ?? null,
        status: site.affiliate_status ?? null,
        detail: site.affiliate_detail ?? null,
        offer: site.affiliate_offer ?? null,
        checked_at: site.affiliate_checked_at ?? null,
      },
      // Date d'achat réelle (registrar) sinon date d'entrée dans seo-monitor
      purchased_at: fin?.purchase_date ?? site.created_at?.slice(0, 10) ?? null,
      keyword: kw?.keyword ?? null,
      keyword_id: kw?.id ?? null,
      country_iso: loc?.country_iso ?? null,
      position: current?.position ?? null,
      previous_position: previous?.position ?? null,
      last_checked_at: current?.checked_at ?? null,
      history,
      finance: fin
        ? {
            purchase_price: Number(fin.purchase_price),
            purchase_date: fin.purchase_date,
            renewal_price: Number(fin.renewal_price),
            renewal_date: fin.renewal_date,
          }
        : null,
      revenue_usd: Math.round(rev.revenue * 100) / 100,
      conversions: rev.conversions,
      roi_usd: Math.round((rev.revenue - spent) * 100) / 100,
    };
  });

  // Ordre d'achat : le plus récent en haut
  rows.sort((a, b) => (b.purchased_at ?? "").localeCompare(a.purchased_at ?? ""));

  return NextResponse.json({
    emd: rows,
    to_classify: toClassify.map((s) => ({
      site_id: s.id,
      domain: s.domain,
      cf_account: s.cf_account,
    })),
    totals: {
      spent_usd: Math.round(totalSpent * 100) / 100,
      revenue_usd: Math.round(totalRevenue * 100) / 100,
      roi_usd: Math.round((totalRevenue - totalSpent) * 100) / 100,
      emd_count: emdSites.length,
      to_classify_count: toClassify.length,
    },
  });
}

// Actions : set_keyword | set_finance | classify
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { action, site_id } = body as { action: string; site_id: string };
  if (!action || !site_id) {
    return NextResponse.json({ error: "action et site_id requis" }, { status: 400 });
  }

  // Vérification de propriété (RLS protège déjà, ceci clarifie les erreurs)
  const { data: site } = await supabase
    .from("sites")
    .select("id, category, location_code")
    .eq("id", site_id)
    .eq("user_id", user.id)
    .single();
  if (!site) {
    return NextResponse.json({ error: "Site introuvable" }, { status: 404 });
  }

  // ── toggle_active : ON/OFF du suivi automatique ─────────────────────────
  // Un domaine OFF garde son historique mais l'agent d'amelioration
  // quotidien l'ignore. Sert aux EMD dont l'offre affiliee est morte.
  if (action === "toggle_active") {
    const nextActive = Boolean(body.is_active);
    const { error } = await supabase
      .from("sites")
      .update({ is_active: nextActive })
      .eq("id", site_id);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true, is_active: nextActive });
  }

  // ── set_keyword : définit LE mot-clé principal (1 par domaine) ────────────
  if (action === "set_keyword") {
    const keyword = String(body.keyword ?? "").trim().toLowerCase();
    const countryIso = String(body.country_iso ?? "").trim().toUpperCase();
    if (!keyword) {
      return NextResponse.json({ error: "keyword requis" }, { status: 400 });
    }

    // Résolution du pays -> location_code
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

    // Ancien mot-clé principal
    const { data: oldPrimary } = await supabase
      .from("keywords")
      .select("id, keyword, location_code")
      .eq("site_id", site_id)
      .eq("is_primary", true)
      .maybeSingle();

    if (!locationCode) {
      locationCode = oldPrimary?.location_code ?? site.location_code;
    }
    if (!locationCode) {
      return NextResponse.json(
        { error: "country_iso requis (aucun pays connu pour ce site)" },
        { status: 400 }
      );
    }

    if (oldPrimary && oldPrimary.keyword === keyword && oldPrimary.location_code === locationCode) {
      return NextResponse.json({ success: true, unchanged: true });
    }

    // L'historique reste attaché à l'ancien keyword ; le nouveau repart à zéro
    if (oldPrimary) {
      await supabase.from("keywords").update({ is_primary: false }).eq("id", oldPrimary.id);
    }

    // Réutiliser une ligne existante (UNIQUE site+keyword+location) sinon créer
    const { data: existing } = await supabase
      .from("keywords")
      .select("id")
      .eq("site_id", site_id)
      .eq("keyword", keyword)
      .eq("location_code", locationCode)
      .maybeSingle();

    if (existing) {
      await supabase.from("keywords").update({ is_primary: true }).eq("id", existing.id);
    } else {
      const { error } = await supabase.from("keywords").insert({
        site_id,
        keyword,
        location_code: locationCode,
        is_primary: true,
      });
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
    }

    // Un mot-clé saisi sur un site EMD => tracking activé
    if (site.category === "emd") {
      await supabase
        .from("sites")
        .update({ serp_tracking_enabled: true, location_code: locationCode })
        .eq("id", site_id);
    }

    return NextResponse.json({ success: true });
  }

  // ── set_finance : coûts d'achat / renouvellement ──────────────────────────
  if (action === "set_finance") {
    const patch: Record<string, unknown> = {};
    if (body.purchase_price !== undefined) patch.purchase_price = Number(body.purchase_price) || 0;
    if (body.renewal_price !== undefined) patch.renewal_price = Number(body.renewal_price) || 0;
    if (body.purchase_date !== undefined) patch.purchase_date = body.purchase_date || null;
    if (body.renewal_date !== undefined) patch.renewal_date = body.renewal_date || null;
    if (body.notes !== undefined) patch.notes = body.notes || null;

    const { data: existing } = await supabase
      .from("domain_finance")
      .select("id")
      .eq("site_id", site_id)
      .maybeSingle();

    const { error } = existing
      ? await supabase
          .from("domain_finance")
          .update({ ...patch, updated_at: new Date().toISOString() })
          .eq("id", existing.id)
      : await supabase.from("domain_finance").insert({ site_id, ...patch });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ success: true });
  }

  // ── classify : domaine 'other' -> emd | shop ──────────────────────────────
  if (action === "classify") {
    const category = body.category as string;
    if (!["emd", "shop", "other"].includes(category)) {
      return NextResponse.json({ error: "category invalide" }, { status: 400 });
    }

    const patch: Record<string, unknown> =
      category === "emd"
        ? { category, site_type: "emd", is_active: true }
        : // shop/other : jamais de tracking SERP payant
          { category, serp_tracking_enabled: false };

    const { error } = await supabase.from("sites").update(patch).eq("id", site_id);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Ligne finance prête à remplir pour les nouveaux EMD
    if (category === "emd") {
      const { data: fin } = await supabase
        .from("domain_finance")
        .select("id")
        .eq("site_id", site_id)
        .maybeSingle();
      if (!fin) await supabase.from("domain_finance").insert({ site_id });
    }

    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: `action inconnue: ${action}` }, { status: 400 });
}

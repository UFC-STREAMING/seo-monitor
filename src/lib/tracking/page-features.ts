// Éléments de la page d'accueil de chaque EMD (Leo 11/10/2026). Les EMD statiques ont
// chacun leur squelette (règle anti-empreinte) : on compare donc des ÉLÉMENTS de page
// (bouton en haut, barre fixe, longueur, avis, prix…) plutôt que des templates nommés.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

export interface PageFeatures {
  platform: "wordpress" | "statique";
  words: number;
  ctas: number;
  cta_in_top: boolean; // un bouton dans le premier cinquième de la page
  sticky_cta: boolean; // bouton dans l'en-tête ou dans une barre fixe
  images: number;
  reviews: boolean;
  prices: boolean;
  faq: boolean;
}

const CTA_RE = /href="[^"]*(?:\/go\/?|\/goto\/|\/out\/|clickrtrckr|treejammer|diginear|primesavingslink|premierdiscountlink|tricklyn|spacefaller|pixlbonk)[^"]*"/gi;

export function extractFeatures(html: string): PageFeatures {
  const body = html.slice(Math.max(0, html.search(/<body/i)));
  const text = body
    .replace(/<(script|style|noscript|svg)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const ctaMatches = [...body.matchAll(CTA_RE)];
  const firstCta = ctaMatches[0]?.index ?? -1;
  // Bouton dans l'en-tête (souvent fixe) ou dans une barre marquée sticky/fixed
  const header = body.match(/<header[\s\S]*?<\/header>/i)?.[0] ?? "";
  const sticky =
    new RegExp(CTA_RE.source, "i").test(header) ||
    ctaMatches.some((m) => /class="[^"]*(sticky|fixed|floating|mobile-bar|buybar|cta-bar)[^"]*"/i.test(body.slice(Math.max(0, (m.index ?? 0) - 400), (m.index ?? 0) + 50)));
  return {
    platform: /wp-content|wp-includes/i.test(html) ? "wordpress" : "statique",
    words: text ? text.split(" ").length : 0,
    ctas: ctaMatches.length,
    cta_in_top: firstCta >= 0 && firstCta < body.length * 0.2,
    sticky_cta: sticky,
    images: (body.match(/<img\b/gi) ?? []).length,
    reviews: /"@type"\s*:\s*"(Review|AggregateRating)"|avis|reviews|bewertungen|opiniones|recensioni/i.test(html),
    prices: /"@type"\s*:\s*"Offer"|[€$£]\s?\d{2,3}[.,]\d{2}|\d{2,3}[.,]\d{2}\s?[€$£]/.test(text) || /"price"\s*:/.test(html),
    faq: /"FAQPage"|<details[\s>]|<h[23][^>]*>[^<]*(faq|questions fr[ée]quentes|h[äa]ufige fragen|preguntas frecuentes|domande frequenti|frequently asked)/i.test(html),
  };
}

/** Scan des pages d'accueil des EMD actifs (8 en parallèle). */
export async function scanPages(supabase: SupabaseClient<Database>): Promise<{ scanned: number; errors: string[] }> {
  const { data: sites } = await supabase.from("sites").select("id, domain").eq("category", "emd").eq("is_active", true);
  const errors: string[] = [];
  let scanned = 0;
  const list = sites ?? [];
  for (let i = 0; i < list.length; i += 8) {
    await Promise.all(
      list.slice(i, i + 8).map(async (s) => {
        try {
          const res = await fetch(`https://${s.domain}/`, {
            headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36" },
            signal: AbortSignal.timeout(15_000),
          });
          if (!res.ok) { errors.push(`${s.domain}: HTTP ${res.status}`); return; }
          const features = extractFeatures(await res.text());
          await supabase.from("sites").update({ page_features: features as unknown as Record<string, unknown>, page_scanned_at: new Date().toISOString() }).eq("id", s.id);
          scanned++;
        } catch (e) {
          errors.push(`${s.domain}: ${e instanceof Error ? e.message : String(e)}`);
        }
      })
    );
  }
  return { scanned, errors };
}

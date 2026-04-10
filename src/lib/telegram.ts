const TELEGRAM_API = "https://api.telegram.org";

/**
 * Client Telegram minimal pour envoyer des notifications à Hermes.
 * Env vars: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID
 */
export async function sendTelegramMessage(text: string, parseMode: "HTML" | "Markdown" = "HTML") {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    console.warn("[TELEGRAM] Bot token or chat ID not configured, skipping notification");
    return false;
  }

  try {
    const res = await fetch(`${TELEGRAM_API}/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: parseMode,
        disable_web_page_preview: true,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error("[TELEGRAM] Send failed:", err);
      return false;
    }

    return true;
  } catch (err) {
    console.error("[TELEGRAM] Send error:", err);
    return false;
  }
}

/**
 * Formate un message de notification pour les changements de brands.
 */
export function formatBrandAlert(changes: {
  newHot: Array<{ brand: string; country: string; impressions: number }>;
  newCooling: Array<{ brand: string; country: string; impressions: number }>;
  removed: number;
}): string | null {
  const lines: string[] = [];

  if (changes.newHot.length > 0) {
    lines.push("<b>🔥 Nouvelles brands HOT</b>");
    for (const b of changes.newHot.slice(0, 10)) {
      lines.push(`  • <b>${b.brand}</b> (${b.country}) — ${b.impressions.toLocaleString()} imp/sem`);
    }
    if (changes.newHot.length > 10) {
      lines.push(`  ... et ${changes.newHot.length - 10} autres`);
    }
  }

  if (changes.newCooling.length > 0) {
    lines.push("");
    lines.push("<b>❄️ Brands en refroidissement</b>");
    for (const b of changes.newCooling.slice(0, 5)) {
      lines.push(`  • ${b.brand} (${b.country}) — ${b.impressions.toLocaleString()} imp/sem`);
    }
    if (changes.newCooling.length > 5) {
      lines.push(`  ... et ${changes.newCooling.length - 5} autres`);
    }
  }

  if (changes.removed > 0) {
    lines.push("");
    lines.push(`<b>🗑 ${changes.removed} brands retirées</b> (cooling > 3 sem)`);
  }

  if (lines.length === 0) return null;

  lines.unshift("<b>📊 SEO Monitor — Brand Tracking</b>");
  lines.push("");
  lines.push(`<i>${new Date().toLocaleDateString("fr-FR")} — Rapport hebdomadaire</i>`);

  return lines.join("\n");
}

/**
 * Formate un message pour les pages à optimiser.
 */
export function formatPagesToOptimize(pages: Array<{
  page: string;
  reason: string;
  priority: string;
  impressions: number;
  avg_position: number;
}>): string | null {
  if (pages.length === 0) return null;

  const lines: string[] = [
    "<b>📝 SEO Monitor — Pages à optimiser</b>",
    "",
  ];

  const critical = pages.filter((p) => p.priority === "critical");
  const high = pages.filter((p) => p.priority === "high");
  const medium = pages.filter((p) => p.priority === "medium");

  if (critical.length > 0) {
    lines.push(`<b>🔴 Critiques (${critical.length})</b>`);
    for (const p of critical.slice(0, 5)) {
      const slug = new URL(p.page).pathname;
      lines.push(`  • ${slug} — ${p.reason} (pos ${p.avg_position})`);
    }
  }

  if (high.length > 0) {
    lines.push(`<b>🟠 Importantes (${high.length})</b>`);
    for (const p of high.slice(0, 5)) {
      const slug = new URL(p.page).pathname;
      lines.push(`  • ${slug} — ${p.reason} (${p.impressions} imp)`);
    }
  }

  if (medium.length > 0) {
    lines.push(`<b>🟡 Moyennes (${medium.length})</b>`);
  }

  lines.push("");
  lines.push(`Total: ${pages.length} pages à traiter`);

  return lines.join("\n");
}

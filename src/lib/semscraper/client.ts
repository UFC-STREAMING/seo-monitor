// Client Semscraper — SERP Google organique (remplace DataForSEO, solde à 0
// depuis août 2026 : le suivi EMD était mort depuis le 17/08).
// API asynchrone : POST /serp (jusqu'à 100 jobs) puis polling GET /serp?ids=.
// Coût mesuré : 0,0021 €/SERP à depth=10 (top 100).
//
// Utilisé UNIQUEMENT pour les sites category='emd' avec serp_tracking_enabled
// (garde-fou dans lib/positions/check.ts).

const SEMSCRAPER_API = "https://api.semscraper.com/v1";
const BATCH_MAX = 100;
const POLL_INTERVAL_MS = 5_000;

/** Crédit épuisé (HTTP 402 ou message explicite) — à traiter explicitement. */
export class SemscraperBalanceError extends Error {
  constructor(message = "Semscraper: crédit insuffisant") {
    super(message);
    this.name = "SemscraperBalanceError";
  }
}

export interface SerpQuery {
  keyword: string;
  /** Code pays ISO de la table locations (FR, US, GB...). */
  countryIso: string;
  languageCode: string;
  targetDomain: string;
}

export interface SerpCheckResult {
  /** Position organique 1-100, null = introuvable dans le top 100. */
  position: number | null;
  urlFound: string | null;
  /** Types de blocs SERP présents (people_also_ask, ai_overview_panel, ...). */
  serpFeatures: string[];
  /** Coût facturé par Semscraper (EUR). */
  cost: number;
  error?: string;
}

// Les codes Semscraper ne sont PAS de l'ISO : « gb » refusé (→ « uk ») et
// « us » n'existe pas (→ google.com « en » + géolocalisation pays).
// Couples vérifiés via GET /serp/google/location.
function toSemscraperLocale(countryIso: string, languageCode: string) {
  const iso = countryIso.toLowerCase();
  if (iso === "us") return { location: "en", language: "en", geolocation: "United States" };
  if (iso === "gb") return { location: "uk", language: "en" };
  return { location: iso, language: languageCode.toLowerCase() };
}

function getKey(): string {
  const key = process.env.SEMSCRAPER_API_KEY;
  if (!key) throw new Error("SEMSCRAPER_API_KEY manquante");
  return key;
}

function domainMatches(itemDomain: string | undefined, target: string): boolean {
  if (!itemDomain) return false;
  const d = itemDomain.toLowerCase().replace(/^www\./, "");
  const t = target.toLowerCase().replace(/^www\./, "");
  return d === t || d.endsWith(`.${t}`);
}

interface SemItem {
  rank_type?: number;
  domain?: string;
  url?: string;
}
interface SemRow {
  id: string;
  status: string;
  cost?: number;
  results?: Array<{ type: string; items?: SemItem[] }>;
}

async function throwIfError(res: Response, what: string): Promise<void> {
  if (res.ok) return;
  const text = await res.text();
  if (res.status === 402 || /credit|balance|solde|insufficient/i.test(text)) {
    throw new SemscraperBalanceError(`Semscraper ${what} ${res.status}: ${text.slice(0, 200)}`);
  }
  throw new Error(`Semscraper ${what} HTTP ${res.status}: ${text.slice(0, 200)}`);
}

// La réponse contient parfois des caractères de contrôle bruts dans les
// snippets → JSON.parse strict échoue. On les neutralise avant parsing.
async function parseLoose<T>(res: Response): Promise<T> {
  const text = await res.text();
  // eslint-disable-next-line no-control-regex
  return JSON.parse(text.replace(/[\u0000-\u001f]/g, " ")) as T;
}

function extract(row: SemRow, target: string): SerpCheckResult {
  const blocks = row.results ?? [];
  const serpFeatures = [...new Set(blocks.map((b) => b.type))].filter((t) => t !== "organic");
  let match: SemItem | undefined;
  for (const b of blocks) {
    if (b.type !== "organic") continue;
    match = (b.items ?? []).find((i) => domainMatches(i.domain, target));
    if (match) break;
  }
  const position = match?.rank_type ?? null;
  return {
    position: position !== null && position <= 100 ? position : null,
    urlFound: match?.url ?? null,
    serpFeatures,
    cost: row.cost ?? 0,
  };
}

/**
 * Vérifie la position de chaque domaine sur son mot-clé (top 100 organique).
 * Un seul POST par lot de 100, puis polling jusqu'à `timeoutMs`.
 * Les résultats sont renvoyés dans le même ordre que `queries`.
 * @throws SemscraperBalanceError si le crédit est épuisé.
 */
export async function checkSerpPositions(
  queries: SerpQuery[],
  opts: { timeoutMs?: number } = {}
): Promise<SerpCheckResult[]> {
  const key = getKey();
  const out: SerpCheckResult[] = [];

  for (let i = 0; i < queries.length; i += BATCH_MAX) {
    const batch = queries.slice(i, i + BATCH_MAX);
    const created = await fetch(`${SEMSCRAPER_API}/serp`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(
        batch.map((q) => ({
          search_engine: "google_search",
          keyword: q.keyword,
          device: "desktop",
          depth: 10,
          ...toSemscraperLocale(q.countryIso, q.languageCode),
        }))
      ),
    });
    await throwIfError(created, "POST");
    const job = await parseLoose<{ data?: Array<{ id: string }> }>(created);
    const ids = (job.data ?? []).map((d) => d.id);
    if (ids.length !== batch.length) {
      throw new Error(`Semscraper: ${ids.length} jobs créés pour ${batch.length} requêtes`);
    }

    const done = new Map<string, SemRow>();
    const deadline = Date.now() + (opts.timeoutMs ?? 240_000);
    while (done.size < ids.length && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      const pending = ids.filter((id) => !done.has(id));
      const res = await fetch(`${SEMSCRAPER_API}/serp?ids=${pending.join(",")}&output=json`, {
        headers: { Authorization: `Bearer ${key}` },
      });
      if (!res.ok) continue;
      const json = await parseLoose<{ data?: SemRow[] }>(res);
      for (const row of json.data ?? []) {
        if (row.status === "done") done.set(row.id, row);
      }
    }

    batch.forEach((q, idx) => {
      const row = done.get(ids[idx]);
      out.push(
        row
          ? extract(row, q.targetDomain)
          : { position: null, urlFound: null, serpFeatures: [], cost: 0, error: "Semscraper: timeout" }
      );
    });
  }

  return out;
}

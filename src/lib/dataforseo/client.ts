// Client DataForSEO minimal — SERP Google organique live.
// Utilisé UNIQUEMENT pour les sites category='emd' avec serp_tracking_enabled
// (jamais pour les shops e-commerce — garde-fou dans lib/positions/check.ts).

const DFS_API = "https://api.dataforseo.com/v3";

/** Solde insuffisant (HTTP 402 / status 40200) — à traiter explicitement. */
export class DataForSeoBalanceError extends Error {
  constructor(message = "DataForSEO: solde insuffisant (402)") {
    super(message);
    this.name = "DataForSeoBalanceError";
  }
}

export interface SerpCheckResult {
  /** Position organique (rank_group) 1-100, null = introuvable dans le top 100. */
  position: number | null;
  urlFound: string | null;
  /** Types d'éléments SERP présents (people_also_ask, ai_overview, ...). */
  serpFeatures: string[];
  /** Coût réel facturé par DataForSEO pour cette requête. */
  costUsd: number;
}

function getAuthHeader(): string {
  const user = process.env.DATAFORSEO_USERNAME;
  const pass = process.env.DATAFORSEO_PASSWORD;
  if (!user || !pass) throw new Error("DATAFORSEO_USERNAME / DATAFORSEO_PASSWORD manquants");
  return `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`;
}

function domainMatches(itemDomain: string | undefined, target: string): boolean {
  if (!itemDomain) return false;
  const d = itemDomain.toLowerCase().replace(/^www\./, "");
  const t = target.toLowerCase().replace(/^www\./, "");
  return d === t || d.endsWith(`.${t}`);
}

interface DfsOrganicItem {
  type: string;
  rank_group?: number;
  domain?: string;
  url?: string;
}

/**
 * Vérifie la position d'un domaine sur un mot-clé (top 100 organique).
 * @throws DataForSeoBalanceError si le solde du compte est épuisé.
 */
export async function checkSerpPosition(params: {
  keyword: string;
  locationCode: number;
  languageCode: string;
  targetDomain: string;
}): Promise<SerpCheckResult> {
  const res = await fetch(`${DFS_API}/serp/google/organic/live/advanced`, {
    method: "POST",
    headers: {
      Authorization: getAuthHeader(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify([
      {
        keyword: params.keyword,
        location_code: params.locationCode,
        language_code: params.languageCode,
        depth: 100,
        device: "desktop",
      },
    ]),
  });

  if (res.status === 402) throw new DataForSeoBalanceError();
  if (!res.ok) throw new Error(`DataForSEO HTTP ${res.status}: ${await res.text()}`);

  const json = (await res.json()) as {
    status_code: number;
    status_message: string;
    tasks?: Array<{
      status_code: number;
      status_message: string;
      cost: number;
      result?: Array<{ items?: DfsOrganicItem[] }>;
    }>;
  };

  if (json.status_code === 40200) throw new DataForSeoBalanceError();
  const task = json.tasks?.[0];
  if (!task) throw new Error(`DataForSEO: réponse sans task (${json.status_message})`);
  if (task.status_code === 40200) throw new DataForSeoBalanceError();
  if (task.status_code !== 20000) {
    throw new Error(`DataForSEO task ${task.status_code}: ${task.status_message}`);
  }

  const items = task.result?.[0]?.items ?? [];
  const serpFeatures = [...new Set(items.map((i) => i.type))].filter(
    (t) => t !== "organic"
  );

  const match = items.find(
    (i) => i.type === "organic" && domainMatches(i.domain, params.targetDomain)
  );

  return {
    position: match?.rank_group ?? null,
    urlFound: match?.url ?? null,
    serpFeatures,
    costUsd: task.cost ?? 0,
  };
}

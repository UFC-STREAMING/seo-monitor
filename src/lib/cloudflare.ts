// Client Cloudflare minimal : liste les zones de tous les comptes configurés.
// Sert au cron sync-cloudflare-zones pour maintenir l'inventaire complet des
// domaines (y compris ceux créés à la volée par l'agent EMD via Telegram).

const CF_API = "https://api.cloudflare.com/client/v4";

interface CfAccountConfig {
  label: string;
  tokenEnv: string;
}

// Un token API Cloudflare est scopé à un compte : un fetch /zones par token
// renvoie uniquement les zones de ce compte.
const CF_ACCOUNTS: CfAccountConfig[] = [
  { label: "principal", tokenEnv: "CLOUDFLARE_API_TOKEN" },
  { label: "flokinet", tokenEnv: "CLOUDFLARE_FLOKINET_API_TOKEN" },
  { label: "leoblackseo", tokenEnv: "CLOUDFLARE_O2SWITCH_API_TOKEN" },
];

export interface CfZoneInfo {
  domain: string;
  status: string; // 'active' | 'pending' | ...
  cf_account: string;
}

async function listZonesForToken(
  token: string,
  label: string
): Promise<CfZoneInfo[]> {
  const zones: CfZoneInfo[] = [];
  let page = 1;
  // Garde-fou pagination (50 zones/page, 40 pages = 2000 zones max)
  while (page <= 40) {
    const res = await fetch(`${CF_API}/zones?per_page=50&page=${page}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      throw new Error(`Cloudflare ${label}: HTTP ${res.status} ${await res.text()}`);
    }
    const json = (await res.json()) as {
      success: boolean;
      result: Array<{ name: string; status: string }>;
      result_info: { total_pages: number };
      errors: unknown[];
    };
    if (!json.success) {
      throw new Error(`Cloudflare ${label}: ${JSON.stringify(json.errors)}`);
    }
    for (const z of json.result) {
      zones.push({ domain: z.name, status: z.status, cf_account: label });
    }
    if (page >= (json.result_info?.total_pages ?? 1)) break;
    page++;
  }
  return zones;
}

/**
 * Liste les zones de tous les comptes Cloudflare configurés.
 * Un compte sans token en env est simplement ignoré (avec warning).
 */
export async function listAllCloudflareZones(): Promise<{
  zones: CfZoneInfo[];
  errors: string[];
}> {
  const zones: CfZoneInfo[] = [];
  const errors: string[] = [];

  for (const account of CF_ACCOUNTS) {
    const token = process.env[account.tokenEnv];
    if (!token) {
      console.warn(`[CLOUDFLARE] Token manquant pour ${account.label} (${account.tokenEnv})`);
      continue;
    }
    try {
      zones.push(...(await listZonesForToken(token, account.label)));
    } catch (err) {
      // Un compte en erreur ne doit pas bloquer les autres
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }

  return { zones, errors };
}

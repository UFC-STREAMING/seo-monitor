// Prix d'ACHAT 1re année (€) par extension et par registrar — relevé du 25/11/2026 (script ~/Obsidian/claude-code/infra/cmp_tld.py).
// Openprovider = at-cost HT + 0,50 € de membership ; OVH = catalogue public HT ; Dynadot = compte ricardodesali (EUR) ; InternetBS converti depuis l'USD.
// Renouvellement ignoré : on ne renouvelle rien (Leo 25/11).
export type Registrar = "dynadot" | "ovh" | "openprovider" | "internetbs";
export const REGISTRAR_LABEL: Record<Registrar, string> = { dynadot: "Dynadot", ovh: "OVH", openprovider: "Openprovider", internetbs: "InternetBS" };
export const TLD_PRICES: Record<string, Partial<Record<Registrar, number>>> = {
  "com": { dynadot: 10.87, internetbs: 14.59, ovh: 8.49, openprovider: 11.2 },
  "net": { dynadot: 7.01, internetbs: 13.55, ovh: 10.99, openprovider: 11.86 },
  "org": { dynadot: 7.48, internetbs: 15.04, ovh: 7.99, openprovider: 7.68 },
  "info": { dynadot: 3.74, internetbs: 30.09, ovh: 3.49, openprovider: 4.88 },
  "io": { dynadot: 20.01, internetbs: 61.07, ovh: 17.49, openprovider: 48.39 },
  "co": { dynadot: 14.5, internetbs: 36.93, ovh: 30.89, openprovider: 14.87 },
  "ai": { dynadot: 80.04, internetbs: 100.34, ovh: 88.99, openprovider: 77.12 },
  "xyz": { dynadot: 1.41, internetbs: 18.69, ovh: 1.49, openprovider: 1.94 },
  "shop": { dynadot: 1.4, internetbs: 50.12, ovh: 2.99, openprovider: 1.44 },
  "online": { dynadot: 2.34, internetbs: 29.27, ovh: 0.99, openprovider: 27.03 },
  "site": { dynadot: 2.34, internetbs: 29.27, ovh: 0.99, openprovider: 27.03 },
  "store": { dynadot: 2.34, internetbs: 44.48, ovh: 0.99, openprovider: 38.98 },
  "fr": { dynadot: 5.99, internetbs: 8.28, ovh: 4.99, openprovider: 5.58 },
  "de": { dynadot: 3.59, internetbs: 5.28, ovh: 6.99, openprovider: 4.18 },
  "es": { internetbs: 7.4, ovh: 11.99, openprovider: 4.59 },
  "it": { dynadot: 6.01, internetbs: 6.34, ovh: 6.99, openprovider: 4.5 },
  "pt": { dynadot: 10.54, ovh: 24.99, openprovider: 10.1 },
  "nl": { dynadot: 6.74, internetbs: 11.09, ovh: 5.31, openprovider: 4.88 },
  "be": { dynadot: 6.77, internetbs: 7.4, ovh: 2.99, openprovider: 6.0 },
  "eu": { dynadot: 3.94, internetbs: 4.22, ovh: 7.49, openprovider: 5.1 },
  "pl": { dynadot: 4.83, internetbs: 13.67, ovh: 12.59, openprovider: 4.01 },
  "ro": { dynadot: 9.23, internetbs: 9.11, ovh: 41.99, openprovider: 6.5 },
  "ch": { dynadot: 7.72, internetbs: 8.2, ovh: 9.99, openprovider: 7.07 },
  "at": { dynadot: 10.03, internetbs: 12.68, ovh: 10.19, openprovider: 9.0 },
  "co.uk": { dynadot: 5.74, internetbs: 7.4, ovh: 7.49, openprovider: 5.41 },
  "uk": { dynadot: 5.74, internetbs: 7.4, ovh: 5.79, openprovider: 5.41 },
  "ie": { dynadot: 14.76, ovh: 49.99, openprovider: 12.5 },
  "in": { dynadot: 6.04, internetbs: 23.25, ovh: 6.99, openprovider: 5.65 },
  "co.in": { dynadot: 4.83, internetbs: 16.87, ovh: 8.99, openprovider: 4.62 },
  "se": { internetbs: 32.83, ovh: 18.09, openprovider: 16.88 },
  "dk": { dynadot: 11.94, internetbs: 15.95, ovh: 19.49, openprovider: 8.65 },
  "no": { dynadot: 7.46, openprovider: 26.91 },
  "fi": { internetbs: 26.96, ovh: 10.99, openprovider: 12.5 },
  "cz": { dynadot: 8.06, internetbs: 10.94, ovh: 10.19, openprovider: 7.82 },
  "gr": { openprovider: 6.75 },
  "hu": { openprovider: 20.5 },
  "sk": { internetbs: 13.74, openprovider: 48.0 },
  "mx": { dynadot: 22.01, internetbs: 36.93, ovh: 48.39, openprovider: 16.78 },
  "com.br": { ovh: 23.09, openprovider: 34.6 },
  "ca": { dynadot: 8.56, internetbs: 10.51, ovh: 8.99, openprovider: 7.52 },
  "us": { dynadot: 4.02, internetbs: 7.29, ovh: 7.49, openprovider: 6.73 },
  "com.co": { dynadot: 16.55, internetbs: 28.72, ovh: 12.49, openprovider: 14.87 },
  "cl": { dynadot: 11.01, internetbs: 50.08, ovh: 17.29, openprovider: 11.04 },
  "pe": { internetbs: 64.67, ovh: 58.79, openprovider: 101.07 },
  "ar": { openprovider: 177.69 },
};

// Extensions hors Europe / hors US (pays) : règle « le moins cher » même pour le nutra.
const NON_EU_US = new Set(["in", "co.in", "mx", "com.mx", "com.br", "br", "ca", "cl", "pe", "ar", "com.ar", "com.co", "au", "com.au", "nz", "jp", "ma", "za", "ae", "sg", "ph", "my", "id", "tr", "com.tr"]);
// .it chez Openprovider : bloqué (n° de TVA exigé), on ne le propose pas.
const BLOCKED: Record<string, Registrar[]> = { it: ["openprovider"] };

export const tldOf = (domain: string) => {
  const parts = domain.toLowerCase().split(".");
  const two = parts.slice(-2).join(".");
  return parts.length > 2 && TLD_PRICES[two] ? two : parts[parts.length - 1];
};

// Règle Leo 25/11 : nutra (médical) en Europe / US = Dynadot sans hésiter ; betting foot et hors Europe = le moins cher.
export function chooseRegistrar(domain: string, category?: string | null): { registrar: Registrar; price: number; rule: string } | null {
  const tld = tldOf(domain);
  const prices = Object.entries(TLD_PRICES[tld] ?? {}).filter(([r]) => !(BLOCKED[tld] ?? []).includes(r as Registrar)) as [Registrar, number][];
  if (!prices.length) return null;
  const nutraEuUs = category !== "sport" && !NON_EU_US.has(tld);
  const dyn = prices.find(([r]) => r === "dynadot");
  if (nutraEuUs && dyn) return { registrar: "dynadot", price: dyn[1], rule: "nutra Europe/US = Dynadot" };
  const [registrar, price] = prices.sort((a, b) => a[1] - b[1])[0];
  return { registrar, price, rule: category === "sport" ? "betting = le moins cher" : nutraEuUs ? "Dynadot ne vend pas cette extension : le moins cher" : "hors Europe = le moins cher" };
}

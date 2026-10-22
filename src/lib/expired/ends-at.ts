// Fin d'enchère / de backorder → horodatage UTC.
// Formats reçus : « 2026-10-22 00:00:00 » (Catched, heure de Paris), « 2026-10-22 20:00 » (Nicsell, heure de Paris),
// « 2026/10/22 13:00 PST » (Dynadot, heure de Los Angeles).

function zoneOffsetMinutes(date: Date, timeZone: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
      .formatToParts(date).map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return (asUtc - date.getTime()) / 60000;
}

// Heure murale dans un fuseau → instant UTC
function wallClockToUtc(y: number, mo: number, d: number, h: number, mi: number, timeZone: string): Date {
  const guess = new Date(Date.UTC(y, mo - 1, d, h, mi));
  const off = zoneOffsetMinutes(guess, timeZone);
  const first = new Date(guess.getTime() - off * 60000);
  const off2 = zoneOffsetMinutes(first, timeZone);
  return off2 === off ? first : new Date(guess.getTime() - off2 * 60000);
}

export function parseEndsAt(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const m = raw.trim().match(/^(\d{4})[-/](\d{2})[-/](\d{2})[ T](\d{1,2}):(\d{2})(?::\d{2})?\s*(PST|PDT|PT|UTC|Z)?/i);
  if (!m) return null;
  const tz = m[6] ? (/^(UTC|Z)$/i.test(m[6]) ? "UTC" : "America/Los_Angeles") : "Europe/Paris";
  return wallClockToUtc(+m[1], +m[2], +m[3], +m[4], +m[5], tz).toISOString();
}

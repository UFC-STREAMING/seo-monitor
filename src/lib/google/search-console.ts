import { GoogleAuth } from "./auth";

const WEBMASTERS_API = "https://www.googleapis.com/webmasters/v3";
const SEARCH_CONSOLE_API = "https://searchconsole.googleapis.com/v1";
const GSC_SCOPES = ["https://www.googleapis.com/auth/webmasters.readonly"];

export interface GscSiteEntry {
  siteUrl: string;
  permissionLevel: string;
}

export interface GscSearchAnalyticsRow {
  keys: string[];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface GscUrlInspectionResult {
  verdict: "PASS" | "NEUTRAL" | "FAIL" | "VERDICT_UNSPECIFIED";
  coverageState?: string;
  robotsTxtState?: string;
  indexingState?: string;
  pageFetchState?: string;
  lastCrawlTime?: string;
  crawledAs?: string;
  googleCanonical?: string;
  userCanonical?: string;
}

export class GoogleSearchConsoleClient {
  private auth: GoogleAuth;

  constructor() {
    this.auth = new GoogleAuth();
  }

  isConfigured(): boolean {
    return this.auth.isConfigured();
  }

  getServiceAccountEmail(): string {
    return this.auth.getClientEmail();
  }

  /** List all GSC properties the service account has access to */
  async listSites(): Promise<GscSiteEntry[]> {
    const token = await this.auth.getAccessToken(GSC_SCOPES);

    const response = await fetch(`${WEBMASTERS_API}/sites`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`GSC listSites failed: ${response.status} ${error}`);
    }

    const data = await response.json();
    return data.siteEntry ?? [];
  }

  /**
   * Fetch search analytics data for a property.
   *
   * @param dataState
   *   - "final" (default): only finalized data, 2-3 day delay, stable
   *   - "all": includes fresh data (~4-6h delay), may change slightly
   */
  async searchAnalytics(
    siteUrl: string,
    startDate: string,
    endDate: string,
    dimensions: ("query" | "page" | "country" | "device" | "date")[],
    rowLimit: number = 25000,
    dataState: "final" | "all" = "final"
  ): Promise<GscSearchAnalyticsRow[]> {
    const token = await this.auth.getAccessToken(GSC_SCOPES);
    const encodedUrl = encodeURIComponent(siteUrl);

    const response = await fetch(
      `${WEBMASTERS_API}/sites/${encodedUrl}/searchAnalytics/query`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          startDate,
          endDate,
          dimensions,
          rowLimit,
          dataState,
        }),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(
        `GSC searchAnalytics failed for ${siteUrl}: ${response.status} ${error}`
      );
    }

    const data = await response.json();
    return data.rows ?? [];
  }

  /**
   * Inspect a URL for its real indexation status (uses urlInspection API).
   * Quota: 2000 requests/day/property, 600/minute.
   * Returns null on HTTP error (caller logs and skips).
   */
  async inspectUrl(
    siteProperty: string,
    inspectionUrl: string,
    languageCode = "en-US"
  ): Promise<{ result: GscUrlInspectionResult | null; error?: string }> {
    const token = await this.auth.getAccessToken(GSC_SCOPES);

    const response = await fetch(
      `${SEARCH_CONSOLE_API}/urlInspection/index:inspect`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          inspectionUrl,
          siteUrl: siteProperty,
          languageCode,
        }),
      }
    );

    if (!response.ok) {
      const body = await response.text();
      return { result: null, error: `HTTP ${response.status}: ${body.slice(0, 200)}` };
    }

    const data = await response.json();
    return { result: data.inspectionResult?.indexStatusResult ?? null };
  }
}

/** Singleton instance */
export const gscClient = new GoogleSearchConsoleClient();

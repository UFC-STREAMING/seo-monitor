import { GoogleAuth } from "./auth";

const WEBMASTERS_API = "https://www.googleapis.com/webmasters/v3";
const INDEXING_API = "https://indexing.googleapis.com/v3/urlNotifications";

const GSC_SCOPES = ["https://www.googleapis.com/auth/webmasters.readonly"];
const INDEXING_SCOPES = ["https://www.googleapis.com/auth/indexing"];

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

  /** Fetch search analytics data for a property */
  async searchAnalytics(
    siteUrl: string,
    startDate: string,
    endDate: string,
    dimensions: ("query" | "page" | "country" | "device" | "date")[],
    rowLimit: number = 25000
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
          dataState: "final",
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
   * Notify Google Indexing API that a URL has been updated.
   * Returns true if accepted, false if error.
   * Quota: 200 requests/day per project by default.
   */
  async notifyUrlUpdate(url: string): Promise<{ success: boolean; error?: string }> {
    const token = await this.auth.getAccessToken(INDEXING_SCOPES);

    const response = await fetch(`${INDEXING_API}:publish`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url,
        type: "URL_UPDATED",
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      return { success: false, error: `${response.status}: ${error}` };
    }

    return { success: true };
  }

  /**
   * Batch notify Google Indexing API for multiple URLs.
   * Respects rate limiting with small delays between requests.
   * Returns summary of results.
   */
  async notifyUrlUpdateBatch(
    urls: string[],
    onProgress?: (done: number, total: number) => void
  ): Promise<{ submitted: number; failed: number; errors: string[] }> {
    let submitted = 0;
    let failed = 0;
    const errors: string[] = [];

    for (let i = 0; i < urls.length; i++) {
      const result = await this.notifyUrlUpdate(urls[i]);
      if (result.success) {
        submitted++;
      } else {
        failed++;
        errors.push(`${urls[i]}: ${result.error}`);
        // Stop if quota exceeded (429)
        if (result.error?.includes("429")) {
          errors.push("Quota exceeded — stopping batch");
          break;
        }
        // Skip 403 permission errors silently (site not owned by service account)
        // Don't break — continue with other URLs from other sites
      }
      onProgress?.(i + 1, urls.length);
      // Small delay to avoid rate limiting (200ms between requests)
      if (i < urls.length - 1) {
        await new Promise((r) => setTimeout(r, 200));
      }
    }

    return { submitted, failed, errors };
  }
}

/** Singleton instance */
export const gscClient = new GoogleSearchConsoleClient();

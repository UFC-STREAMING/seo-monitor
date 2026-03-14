// ---------------------------------------------------------------------------
// DataForSEO SERP API client
// Docs: https://docs.dataforseo.com/v3/serp/google/organic/overview/
// Auth: Basic Auth with base64-encoded "login:password"
// ---------------------------------------------------------------------------

const BASE_URL = "https://api.dataforseo.com/v3";

// ---- Response envelope types ------------------------------------------------

/** Top-level wrapper returned by every DataForSEO endpoint. */
export interface DataForSeoResponse<T> {
  version: string;
  status_code: number;
  status_message: string;
  time: string;
  cost: number;
  tasks_count: number;
  tasks_error: number;
  tasks: T[];
}

/** Common shape of a single task object in the `tasks` array. */
export interface DataForSeoTask<R = unknown> {
  id: string;
  status_code: number;
  status_message: string;
  time: string;
  cost: number;
  result_count: number;
  path: string[];
  data: Record<string, unknown>;
  result: R[] | null;
}

// ---- SERP-specific types ----------------------------------------------------

/** A single organic SERP item returned inside a SerpResult. */
export interface SerpItem {
  type: string;
  rank_group: number;
  rank_absolute: number;
  position: string;
  xpath: string;
  domain: string;
  title: string;
  url: string;
  description: string;
  breadcrumb: string;
  is_image: boolean;
  is_video: boolean;
  is_featured_snippet: boolean;
  is_malicious: boolean;
  is_web_story: boolean;
  highlighted: string[];
}

/** The result object returned by SERP task_get endpoints. */
export interface SerpResult {
  keyword: string;
  type: string;
  se_domain: string;
  location_code: number;
  language_code: string;
  check_url: string;
  datetime: string;
  spell: unknown;
  refinement_chips: unknown;
  item_types: string[];
  se_results_count: number;
  items_count: number;
  items: SerpItem[];
}

/** Shortened task type used by the task_post response (no result yet). */
export interface SerpTaskPosted {
  id: string;
  status_code: number;
  status_message: string;
  tag?: string;
}

/** Task shape returned by the tasks_ready endpoint. */
export interface SerpTaskReady {
  id: string;
  se: string;
  se_type: string;
  date_posted: string;
  tag?: string;
  endpoint_regular: string;
  endpoint_advanced: string;
  endpoint_html: string;
}

// ---- Convenience type aliases -----------------------------------------------

export type SerpPostResponse = DataForSeoResponse<DataForSeoTask<SerpTaskPosted>>;
export type SerpReadyResponse = DataForSeoResponse<DataForSeoTask<SerpTaskReady>>;
export type SerpResultResponse = DataForSeoResponse<DataForSeoTask<SerpResult>>;

// ---- Client -----------------------------------------------------------------

export class DataForSeoClient {
  private authHeader: string;

  constructor() {
    const login = process.env.DATAFORSEO_USERNAME!;
    const password = process.env.DATAFORSEO_PASSWORD!;
    this.authHeader =
      "Basic " + Buffer.from(`${login}:${password}`).toString("base64");
  }

  // -- Generic request helper ------------------------------------------------

  private async request<T>(endpoint: string, body?: unknown): Promise<T> {
    const res = await fetch(`${BASE_URL}${endpoint}`, {
      method: body ? "POST" : "GET",
      headers: {
        Authorization: this.authHeader,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `DataForSEO error ${res.status}: ${res.statusText}. ${text}`,
      );
    }

    return res.json();
  }

  // -- SERP endpoints --------------------------------------------------------

  /** Post a single SERP task for one keyword + location. */
  async postSerpTask(
    keyword: string,
    locationCode: number,
    languageCode?: string,
  ): Promise<SerpPostResponse> {
    return this.request<SerpPostResponse>(
      "/serp/google/organic/task_post",
      [
        {
          keyword,
          location_code: locationCode,
          language_code: languageCode || "en",
          depth: 100, // top 100 results
        },
      ],
    );
  }

  /**
   * Post multiple SERP tasks at once (batch).
   * DataForSEO allows up to 100 tasks per request.
   */
  async postSerpTasksBatch(
    tasks: Array<{
      keyword: string;
      locationCode: number;
      languageCode?: string;
      tag?: string;
    }>,
  ): Promise<SerpPostResponse> {
    const body = tasks.map((t) => ({
      keyword: t.keyword,
      location_code: t.locationCode,
      language_code: t.languageCode || "en",
      depth: 100,
      tag: t.tag, // used to identify the task when retrieving results
    }));
    return this.request<SerpPostResponse>(
      "/serp/google/organic/task_post",
      body,
    );
  }

  /** List SERP tasks whose results are ready to be collected. */
  async getSerpTasksReady(): Promise<SerpReadyResponse> {
    return this.request<SerpReadyResponse>(
      "/serp/google/organic/tasks_ready",
    );
  }

  /** Retrieve the full result for a specific SERP task. */
  async getSerpTaskResult(taskId: string): Promise<SerpResultResponse> {
    return this.request<SerpResultResponse>(
      `/serp/google/organic/task_get/regular/${taskId}`,
    );
  }

  /**
   * Live SERP request: returns results immediately (no polling needed).
   * Sends one keyword at a time and gets results in the same response.
   */
  async getSerpLive(
    keyword: string,
    locationCode: number,
    languageCode?: string,
  ): Promise<SerpResultResponse> {
    return this.request<SerpResultResponse>(
      "/serp/google/organic/live/regular",
      [
        {
          keyword,
          location_code: locationCode,
          language_code: languageCode || "en",
          depth: 100,
        },
      ],
    );
  }

  /**
   * Check if a specific page is indexed on Google using "site:domain keyword" query.
   * Searches Google for "site:domain.com keyword" and checks if any result URL
   * contains the expected slug. This avoids false positives from internal links.
   */
  async checkIndexation(
    domain: string,
    keyword: string,
    slug: string,
    locationCode: number,
    languageCode?: string,
  ): Promise<{ indexed: boolean; matchedUrl: string | null }> {
    const query = `site:${domain} ${keyword}`;
    const response = await this.getSerpLive(query, locationCode, languageCode);

    const task = response?.tasks?.[0];
    if (!task) {
      throw new Error("DataForSEO error: no task returned");
    }

    // "No Search Results" = page not indexed (not an error)
    if (task.status_code === 40501 || task.status_message === "No Search Results.") {
      return { indexed: false, matchedUrl: null };
    }

    if (task.status_code !== 20000) {
      throw new Error(`DataForSEO error: ${task.status_message || "Unknown"}`);
    }

    const items = task.result?.[0]?.items ?? [];
    const normalizedSlug = slug.toLowerCase();

    for (const item of items) {
      if (item.type !== "organic") continue;
      try {
        const { pathname } = new URL(item.url);
        if (pathname.toLowerCase().includes(normalizedSlug)) {
          return { indexed: true, matchedUrl: item.url };
        }
      } catch {
        continue;
      }
    }

    return { indexed: false, matchedUrl: null };
  }
}

/** Pre-instantiated client singleton for convenience. */
export const dataforseo = new DataForSeoClient();

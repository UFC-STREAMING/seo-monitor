// ---------------------------------------------------------------------------
// Rapid Indexer API implementation of IndexerService
// Base URL: https://rapid-indexer.com/api/v1/index.php
// Auth: X-API-Key header
// ---------------------------------------------------------------------------

import type {
  IndexerService,
  TaskStatus,
  LinkStatus,
  CreditsInfo,
  SubmitResult,
} from "./interface";

const BASE_URL = "https://rapid-indexer.com/api/v1/index.php";

// ---- Raw API response shapes ------------------------------------------------

interface RapidMeResponse {
  success: boolean;
  user: {
    id: number;
    email: string;
    credits_balance: number;
    created_at: string;
  };
}

interface RapidCreateTaskResponse {
  success: boolean;
  message: string;
  task_id: number;
  is_drip_feed: boolean;
}

interface RapidLinkEntry {
  url: string;
  status: string;
  error_code: string | null;
  checked_at: string | null;
}

interface RapidGetTaskLinksResponse {
  success: boolean;
  links: RapidLinkEntry[];
}

// ---- Status mappers ---------------------------------------------------------

function mapLinkStatus(raw: string): LinkStatus["status"] {
  const normalized = raw.toLowerCase();
  if (normalized === "indexed") return "indexed";
  if (normalized === "not_indexed") return "not_indexed";
  if (normalized === "error" || normalized === "failed") return "error";
  return "pending";
}

// ---- Service implementation -------------------------------------------------

export class RapidIndexerService implements IndexerService {
  private apiKey: string;

  constructor() {
    this.apiKey = process.env.RAPID_INDEXER_API_KEY!;
  }

  private get headers(): Record<string, string> {
    return {
      "X-API-Key": this.apiKey,
      "Content-Type": "application/json",
    };
  }

  private async get<T>(params: Record<string, string>): Promise<T> {
    const url = new URL(BASE_URL);
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }

    const res = await fetch(url.toString(), {
      method: "GET",
      headers: this.headers,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `Rapid Indexer GET error ${res.status}: ${res.statusText}. ${text}`,
      );
    }

    const data = await res.json();
    if (data.success === false) {
      throw new Error(`Rapid Indexer error: ${data.error || "Unknown error"}`);
    }

    return data;
  }

  private async post<T>(
    params: Record<string, string>,
    body: unknown,
  ): Promise<T> {
    const url = new URL(BASE_URL);
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }

    const res = await fetch(url.toString(), {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `Rapid Indexer POST error ${res.status}: ${res.statusText}. ${text}`,
      );
    }

    const data = await res.json();
    if (data.success === false) {
      throw new Error(`Rapid Indexer error: ${data.error || "Unknown error"}`);
    }

    return data;
  }

  // -- IndexerService implementation -----------------------------------------

  async submitUrls(urls: string[]): Promise<SubmitResult> {
    const data = await this.post<RapidCreateTaskResponse>(
      { action: "create_task" },
      {
        type: "indexer",
        engine: "google",
        urls,
      },
    );

    return { taskId: String(data.task_id) };
  }

  async checkUrls(urls: string[]): Promise<SubmitResult> {
    const data = await this.post<RapidCreateTaskResponse>(
      { action: "create_task" },
      {
        type: "checker",
        engine: "google",
        urls,
      },
    );

    return { taskId: String(data.task_id) };
  }

  async getTaskStatus(taskId: string): Promise<TaskStatus> {
    // get_task endpoint is unreliable, derive status from get_task_links
    const links = await this.getTaskLinks(taskId);

    const totalLinks = links.length;
    const indexedLinks = links.filter((l) => l.status === "indexed").length;
    const pendingLinks = links.filter((l) => l.status === "pending").length;

    let status: TaskStatus["status"] = "pending";
    if (totalLinks > 0 && pendingLinks === 0) {
      status = "completed";
    } else if (indexedLinks > 0 || pendingLinks < totalLinks) {
      status = "processing";
    }

    return {
      taskId,
      status,
      totalLinks,
      indexedLinks,
      createdAt: "",
    };
  }

  async getTaskLinks(taskId: string): Promise<LinkStatus[]> {
    const data = await this.get<RapidGetTaskLinksResponse>({
      action: "get_task_links",
      task_id: taskId,
    });

    return data.links.map((link) => ({
      url: link.url,
      status: mapLinkStatus(link.status),
      lastChecked: link.checked_at ?? undefined,
    }));
  }

  async getCredits(): Promise<CreditsInfo> {
    const data = await this.get<RapidMeResponse>({
      action: "me",
    });

    return { remaining: data.user.credits_balance };
  }
}

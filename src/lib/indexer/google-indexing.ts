// ---------------------------------------------------------------------------
// Google Indexing API implementation of IndexerService
// Uses the Google Indexing API v3 via the service account.
// ---------------------------------------------------------------------------

import type {
  IndexerService,
  TaskStatus,
  LinkStatus,
  CreditsInfo,
  SubmitResult,
} from "./interface";
import { gscClient } from "@/lib/google/search-console";

const DAILY_QUOTA = 200;

export class GoogleIndexingService implements IndexerService {
  async submitUrls(urls: string[]): Promise<SubmitResult> {
    const result = await gscClient.notifyUrlUpdateBatch(urls);

    // Use a synthetic task ID (Google Indexing API doesn't have tasks)
    const taskId = `google-indexing-${Date.now()}`;

    return { taskId };
  }

  async checkUrls(_urls: string[]): Promise<SubmitResult> {
    // Google Indexing API doesn't support checking — use DataForSEO or Rapid Indexer for that
    throw new Error(
      "Google Indexing API does not support index checking. Use DataForSEO or Rapid Indexer."
    );
  }

  async getTaskStatus(taskId: string): Promise<TaskStatus> {
    // Google Indexing API is fire-and-forget, no task polling
    return {
      taskId,
      status: "completed",
      totalLinks: 0,
      indexedLinks: 0,
      createdAt: "",
    };
  }

  async getTaskLinks(_taskId: string): Promise<LinkStatus[]> {
    return [];
  }

  async getCredits(): Promise<CreditsInfo> {
    return { remaining: DAILY_QUOTA };
  }
}

// ---------------------------------------------------------------------------
// IndexerService – provider-agnostic interface for URL indexation services.
// Implementations live in sibling files (e.g. rapid-indexer.ts).
// ---------------------------------------------------------------------------

/** Overall status of a submitted indexation task. */
export interface TaskStatus {
  taskId: string;
  status: "pending" | "processing" | "completed" | "failed";
  totalLinks: number;
  indexedLinks: number;
  createdAt: string;
}

/** Per-URL indexation status within a task. */
export interface LinkStatus {
  url: string;
  status: "indexed" | "not_indexed" | "pending" | "error";
  lastChecked?: string;
}

/** Remaining credit information returned by the indexer provider. */
export interface CreditsInfo {
  remaining: number;
}

/** Submission acknowledgement returned after creating a new task. */
export interface SubmitResult {
  taskId: string;
}

/**
 * Contract that every indexer provider must implement.
 * This makes it trivial to swap providers (Rapid Indexer, SpeedyIndex, etc.)
 * without touching any consumer code.
 */
export interface IndexerService {
  /** Submit a batch of URLs for indexation. */
  submitUrls(urls: string[]): Promise<SubmitResult>;

  /** Submit a batch of URLs for index checking (not indexation). */
  checkUrls(urls: string[]): Promise<SubmitResult>;

  /** Poll the overall status of a previously submitted task. */
  getTaskStatus(taskId: string): Promise<TaskStatus>;

  /** Get the per-URL status for every link in a task. */
  getTaskLinks(taskId: string): Promise<LinkStatus[]>;

  /** Check how many credits are remaining on the account. */
  getCredits(): Promise<CreditsInfo>;
}

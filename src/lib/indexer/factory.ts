// ---------------------------------------------------------------------------
// Indexer service factory
// Centralises provider selection so the rest of the codebase only depends on
// the IndexerService interface, never on a concrete implementation.
// ---------------------------------------------------------------------------

import type { IndexerService } from "./interface";
import { RapidIndexerService } from "./rapid-indexer";

/**
 * Create and return the active IndexerService implementation.
 *
 * To switch providers (e.g. SpeedyIndex, IndexNow, etc.) simply swap the
 * return value here -- no other files need to change.
 */
export function createIndexerService(): IndexerService {
  return new RapidIndexerService();
}

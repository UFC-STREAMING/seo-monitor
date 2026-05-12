-- Daily snapshot of indexation status per site
-- Stored daily by /api/cron/check-indexation
-- Read by /api/agent/indexation (Oussama)

CREATE TABLE IF NOT EXISTS indexation_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  snapshot_date DATE NOT NULL,

  -- counts
  sitemap_urls_count INT NOT NULL DEFAULT 0,
  indexed_urls_count INT NOT NULL DEFAULT 0,
  not_indexed_urls_count INT NOT NULL DEFAULT 0,
  indexation_rate NUMERIC(5,2) NOT NULL DEFAULT 0,

  -- details
  not_indexed_urls TEXT[] NOT NULL DEFAULT '{}',
  sitemap_source TEXT,
  template_type TEXT,

  -- error tracking
  error TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE(site_id, snapshot_date)
);

CREATE INDEX IF NOT EXISTS idx_indexation_snapshots_site_date
  ON indexation_snapshots(site_id, snapshot_date DESC);

CREATE INDEX IF NOT EXISTS idx_indexation_snapshots_date
  ON indexation_snapshots(snapshot_date DESC);

COMMENT ON TABLE indexation_snapshots IS
  'Daily snapshot of indexation status: sitemap URLs vs GSC indexed URLs. Computed by cron, read by Oussama.';

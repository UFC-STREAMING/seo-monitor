-- =============================================================================
-- Content Optimizations: suivi des optimisations de contenu par Hermes
-- =============================================================================

CREATE TYPE optimization_status AS ENUM ('pending', 'in_progress', 'completed', 'failed');
CREATE TYPE optimization_trigger AS ENUM ('drop', 'opportunity', 'low_ctr', 'brand_hot', 'manual');

CREATE TABLE content_optimizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  page_url text NOT NULL,
  site_id uuid REFERENCES sites(id) ON DELETE SET NULL,
  trigger optimization_trigger NOT NULL,
  status optimization_status NOT NULL DEFAULT 'pending',

  -- Métriques avant optimisation
  metrics_before jsonb NOT NULL DEFAULT '{}',
  -- Métriques après optimisation (rempli par le report)
  metrics_after jsonb,

  -- Détails de l'optimisation
  changes_made text,           -- description des changements
  agent_name text,             -- "hermes", "manual", etc.
  brand_name text,             -- si lié à un brand tracking

  -- Timestamps
  requested_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_content_opt_status ON content_optimizations (status);
CREATE INDEX idx_content_opt_page ON content_optimizations (page_url);
CREATE INDEX idx_content_opt_site ON content_optimizations (site_id);
CREATE INDEX idx_content_opt_requested ON content_optimizations (requested_at DESC);

-- Auto-update updated_at
CREATE TRIGGER content_optimizations_updated_at
  BEFORE UPDATE ON content_optimizations
  FOR EACH ROW
  EXECUTE FUNCTION update_brand_tracking_updated_at();

-- RLS
ALTER TABLE content_optimizations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on content_optimizations"
  ON content_optimizations
  FOR ALL
  USING (true)
  WITH CHECK (true);

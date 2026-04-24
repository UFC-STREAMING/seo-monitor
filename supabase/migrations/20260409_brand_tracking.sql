-- =============================================================================
-- Brand Tracking: détection automatique de tendances par brand/geo
-- =============================================================================

-- Status enum type
CREATE TYPE brand_status AS ENUM ('hot', 'cooling', 'removed');

-- Main table
CREATE TABLE brand_tracking (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_name text NOT NULL,
  nutra_product_id uuid,  -- lien Nutra Factory (externe, pas de FK)
  country text NOT NULL,   -- alpha3 (DEU, FRA, ESP, ITA...)
  status brand_status NOT NULL DEFAULT 'hot',
  impressions_current_week int NOT NULL DEFAULT 0,
  impressions_previous_week int NOT NULL DEFAULT 0,
  entered_at timestamptz NOT NULL DEFAULT now(),
  cooling_since timestamptz,
  dataforseo_position float,
  dataforseo_last_check timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Unique constraint: une seule entrée par brand+country
CREATE UNIQUE INDEX idx_brand_tracking_brand_country
  ON brand_tracking (brand_name, country);

-- Index pour les queries fréquentes
CREATE INDEX idx_brand_tracking_status ON brand_tracking (status);
CREATE INDEX idx_brand_tracking_entered ON brand_tracking (entered_at DESC);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_brand_tracking_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER brand_tracking_updated_at
  BEFORE UPDATE ON brand_tracking
  FOR EACH ROW
  EXECUTE FUNCTION update_brand_tracking_updated_at();

-- RLS
ALTER TABLE brand_tracking ENABLE ROW LEVEL SECURITY;

-- Policy: service role a accès complet (les crons utilisent le service role)
CREATE POLICY "Service role full access on brand_tracking"
  ON brand_tracking
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- =============================================================================
-- Brand Tracking Enrichment: metadata produit depuis Nutra Factory
-- =============================================================================

ALTER TABLE brand_tracking
  ADD COLUMN product_category text,
  ADD COLUMN product_countries text[],     -- pays où le produit est vendu (DE, FR, ES...)
  ADD COLUMN product_active boolean DEFAULT true,
  ADD COLUMN affiliate_url text,
  ADD COLUMN last_enriched_at timestamptz;

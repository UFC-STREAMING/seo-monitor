-- Migration: Remove SERP tracking, enhance GSC analytics, prepare webhook indexation
-- Date: 2026-04-05

-- 1. Drop keyword_positions table (SERP tracking removed)
DROP TABLE IF EXISTS keyword_positions CASCADE;

-- 2. Add columns to site_pages for webhook/timeline tracking
ALTER TABLE site_pages ADD COLUMN IF NOT EXISTS product_name text;
ALTER TABLE site_pages ADD COLUMN IF NOT EXISTS submitted_at timestamptz;
ALTER TABLE site_pages ADD COLUMN IF NOT EXISTS indexed_at timestamptz;

-- 3. Performance indexes for GSC analytics queries
CREATE INDEX IF NOT EXISTS idx_gsc_data_page ON gsc_search_data(page);
CREATE INDEX IF NOT EXISTS idx_gsc_data_position ON gsc_search_data(position);
CREATE INDEX IF NOT EXISTS idx_gsc_data_query_impressions ON gsc_search_data(query, impressions DESC);

-- 4. Indexes for site_pages timeline queries
CREATE INDEX IF NOT EXISTS idx_site_pages_source ON site_pages(source);
CREATE INDEX IF NOT EXISTS idx_site_pages_submitted_at ON site_pages(submitted_at);

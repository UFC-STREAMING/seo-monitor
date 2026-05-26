-- Verdict GSC par URL (API urlInspection, vraie source de verite).
-- Ecrit par /api/cron/inspect-urls, lu par /api/agent/indexation.
-- Remplace l'inference impressions > 0 qui produisait des faux negatifs
-- (ex: page "calorie-active-spray" indexee mais classee not_indexed le 2026-05-25).

CREATE TABLE IF NOT EXISTS url_inspections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  url TEXT NOT NULL,

  -- GSC verdict
  verdict TEXT NOT NULL,                -- PASS | NEUTRAL | FAIL | ERROR
  coverage_state TEXT,                  -- "Gesendet und indexiert", "Gecrawlt - zurzeit nicht indexiert", "Nicht gefunden (404)", etc.
  indexing_state TEXT,                  -- INDEXING_ALLOWED | BLOCKED_BY_ROBOTS_TXT | ...
  page_fetch_state TEXT,                -- SUCCESSFUL | NOT_FOUND | SOFT_404 | ...
  robots_txt_state TEXT,                -- ALLOWED | DISALLOWED | ...
  last_crawl_time TIMESTAMPTZ,
  crawled_as TEXT,                      -- MOBILE | DESKTOP
  google_canonical TEXT,
  user_canonical TEXT,

  -- traceability
  gsc_property TEXT NOT NULL,           -- "sc-domain:drhalabian.de" ou "https://www..."
  inspected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  error TEXT,

  UNIQUE(site_id, url)
);

CREATE INDEX IF NOT EXISTS idx_url_inspections_site
  ON url_inspections(site_id, verdict);

CREATE INDEX IF NOT EXISTS idx_url_inspections_not_indexed
  ON url_inspections(site_id) WHERE verdict <> 'PASS';

CREATE INDEX IF NOT EXISTS idx_url_inspections_inspected_at
  ON url_inspections(inspected_at DESC);

COMMENT ON TABLE url_inspections IS
  'Vrai statut indexation par URL via API GSC urlInspection. Source de verite (pas d''inference). Ecrit par cron, lu par Oussama.';

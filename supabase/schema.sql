-- =============================================================================
-- SEO Monitoring Dashboard - Complete Database Schema
-- =============================================================================
-- Supabase (PostgreSQL) schema with tables, indexes, RLS policies, triggers,
-- and seed data for the SEO monitoring platform.
-- =============================================================================


-- ---------------------------------------------------------------------------
-- 0. Extensions
-- ---------------------------------------------------------------------------
-- pgcrypto is enabled by default in Supabase for gen_random_uuid().


-- ---------------------------------------------------------------------------
-- 1. LOCATIONS (reference table for DataForSEO country/location codes)
-- ---------------------------------------------------------------------------
CREATE TABLE locations (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    code            integer     UNIQUE NOT NULL,   -- DataForSEO location_code
    name            text        NOT NULL,
    country_iso     text        NOT NULL,           -- 2-letter ISO 3166-1 alpha-2
    default_language text       NOT NULL
);

COMMENT ON TABLE  locations IS 'Reference table mapping DataForSEO location codes to countries.';
COMMENT ON COLUMN locations.code IS 'DataForSEO numeric location identifier.';


-- ---------------------------------------------------------------------------
-- 2. SITES
-- ---------------------------------------------------------------------------
CREATE TABLE sites (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         uuid        NOT NULL REFERENCES auth.users ON DELETE CASCADE,
    domain          text        NOT NULL,
    niche           text        NOT NULL CHECK (niche IN ('casino', 'nutra')),
    site_type       text        NOT NULL CHECK (site_type IN ('money', 'emd', 'pbn', 'nutra')),
    ip              text,
    hosting         text,
    is_active       boolean     DEFAULT true,
    created_at      timestamptz DEFAULT now(),
    updated_at      timestamptz DEFAULT now(),

    UNIQUE (user_id, domain)
);

COMMENT ON TABLE sites IS 'Websites tracked by the platform, owned by a user.';


-- ---------------------------------------------------------------------------
-- 3. KEYWORDS
-- ---------------------------------------------------------------------------
CREATE TABLE keywords (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    site_id         uuid        NOT NULL REFERENCES sites ON DELETE CASCADE,
    keyword         text        NOT NULL,
    location_code   integer     NOT NULL REFERENCES locations (code),
    created_at      timestamptz DEFAULT now(),

    UNIQUE (site_id, keyword, location_code)
);

COMMENT ON TABLE keywords IS 'Target keywords tracked per site and location.';


-- ---------------------------------------------------------------------------
-- 4. KEYWORD_POSITIONS
-- ---------------------------------------------------------------------------
CREATE TABLE keyword_positions (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    keyword_id      uuid        NOT NULL REFERENCES keywords ON DELETE CASCADE,
    site_id         uuid        NOT NULL REFERENCES sites ON DELETE CASCADE,
    position        integer,                        -- null = not found in top 100
    url_found       text,
    serp_features   jsonb       DEFAULT '[]'::jsonb,
    checked_at      timestamptz DEFAULT now()
);

COMMENT ON TABLE  keyword_positions IS 'Historical SERP position snapshots for each keyword.';
COMMENT ON COLUMN keyword_positions.position IS 'Ranking position (1-100). NULL means the site was not found in the top 100.';


-- ---------------------------------------------------------------------------
-- 5. DEINDEXED_URLS
-- ---------------------------------------------------------------------------
CREATE TABLE deindexed_urls (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    site_id         uuid        NOT NULL REFERENCES sites ON DELETE CASCADE,
    keyword_id      uuid        NOT NULL REFERENCES keywords ON DELETE CASCADE,
    url             text        NOT NULL,
    status          text        NOT NULL DEFAULT 'detected'
                                CHECK (status IN ('detected', 'reindex_submitted', 'reindexed')),
    detected_at     timestamptz DEFAULT now(),
    reindexed_at    timestamptz,
    indexer_task_id text
);

COMMENT ON TABLE deindexed_urls IS 'URLs detected as de-indexed from Google, with re-indexation tracking.';


-- ---------------------------------------------------------------------------
-- 6. TECHNICAL_AUDITS
-- ---------------------------------------------------------------------------
CREATE TABLE technical_audits (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    site_id         uuid        NOT NULL REFERENCES sites ON DELETE CASCADE,
    http_status     integer,
    has_ssl         boolean,
    robots_txt_status text,
    sitemap_status  text,
    meta_robots     text,
    load_time_ms    integer,
    checked_at      timestamptz DEFAULT now()
);

COMMENT ON TABLE technical_audits IS 'Point-in-time technical health checks for each site.';


-- ---------------------------------------------------------------------------
-- 7. SITE_LINKS (casino network / PBN link graph)
-- ---------------------------------------------------------------------------
CREATE TABLE site_links (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    source_site_id  uuid        NOT NULL REFERENCES sites ON DELETE CASCADE,
    target_site_id  uuid        NOT NULL REFERENCES sites ON DELETE CASCADE,
    anchor_text     text,
    link_url        text        NOT NULL,
    is_active       boolean     DEFAULT true,
    last_checked    timestamptz,
    created_at      timestamptz DEFAULT now()
);

COMMENT ON TABLE site_links IS 'Directional links between sites in the network (source -> target).';


-- ---------------------------------------------------------------------------
-- 8. ALERTS
-- ---------------------------------------------------------------------------
CREATE TABLE alerts (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    site_id         uuid        REFERENCES sites ON DELETE CASCADE,
    alert_type      text        NOT NULL
                                CHECK (alert_type IN ('deindex', 'position_drop', 'site_down', 'link_broken')),
    severity        text        NOT NULL
                                CHECK (severity IN ('critical', 'warning', 'info')),
    message         text        NOT NULL,
    is_read         boolean     DEFAULT false,
    created_at      timestamptz DEFAULT now()
);

COMMENT ON TABLE alerts IS 'Notifications generated by monitoring rules.';


-- ---------------------------------------------------------------------------
-- 9. ALERT_RULES
-- ---------------------------------------------------------------------------
CREATE TABLE alert_rules (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         uuid        NOT NULL REFERENCES auth.users ON DELETE CASCADE,
    site_id         uuid        REFERENCES sites ON DELETE CASCADE,   -- null = global rule
    alert_type      text        NOT NULL,
    threshold_value integer     NOT NULL,
    is_active       boolean     DEFAULT true,
    created_at      timestamptz DEFAULT now()
);

COMMENT ON TABLE  alert_rules IS 'User-defined rules that trigger alerts.';
COMMENT ON COLUMN alert_rules.site_id IS 'When NULL the rule applies to all sites owned by the user.';


-- ---------------------------------------------------------------------------
-- 10. INDEXER_TASKS
-- ---------------------------------------------------------------------------
CREATE TABLE indexer_tasks (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id         text        NOT NULL,            -- external ID from Rapid Indexer API
    site_id         uuid        REFERENCES sites ON DELETE SET NULL,
    urls            text[]      NOT NULL,
    status          text        NOT NULL DEFAULT 'pending'
                                CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    created_at      timestamptz DEFAULT now(),
    completed_at    timestamptz,
    results         jsonb
);

COMMENT ON TABLE indexer_tasks IS 'Bulk re-indexation requests submitted to Rapid Indexer.';


-- ---------------------------------------------------------------------------
-- 11. API_USAGE_LOG
-- ---------------------------------------------------------------------------
CREATE TABLE api_usage_log (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         uuid        NOT NULL REFERENCES auth.users ON DELETE CASCADE,
    service         text        NOT NULL
                                CHECK (service IN ('dataforseo', 'rapid_indexer', 'brave')),
    endpoint        text,
    credits_used    numeric     DEFAULT 0,
    cost_usd        numeric     DEFAULT 0,
    created_at      timestamptz DEFAULT now()
);

COMMENT ON TABLE api_usage_log IS 'Per-request cost/credit tracking for third-party APIs.';


-- ---------------------------------------------------------------------------
-- 12. SITE_PAGES (bulk index checker / sitemap scanner)
-- ---------------------------------------------------------------------------
CREATE TABLE site_pages (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    site_id         uuid        NOT NULL REFERENCES sites ON DELETE CASCADE,
    url             text        NOT NULL,
    source          text        NOT NULL DEFAULT 'sitemap',  -- 'sitemap' | 'manual'
    index_status    text        DEFAULT 'unknown',           -- 'unknown' | 'indexed' | 'not_indexed' | 'checking' | 'error'
    last_checked_at timestamptz,
    checker_task_id text,                                    -- Rapid Indexer checker task_id
    created_at      timestamptz DEFAULT now(),
    updated_at      timestamptz DEFAULT now(),

    UNIQUE (site_id, url)
);

COMMENT ON TABLE  site_pages IS 'All discovered pages per site (from sitemap or manual import) with Google indexation status.';
COMMENT ON COLUMN site_pages.checker_task_id IS 'Rapid Indexer checker task_id when using bulk check method.';


-- =============================================================================
-- INDEXES
-- =============================================================================

-- keyword_positions: fast lookups by keyword (time series) and by site
CREATE INDEX idx_keyword_positions_keyword_checked
    ON keyword_positions (keyword_id, checked_at DESC);

CREATE INDEX idx_keyword_positions_site_checked
    ON keyword_positions (site_id, checked_at DESC);

-- deindexed_urls: filter by site + status
CREATE INDEX idx_deindexed_urls_site_status
    ON deindexed_urls (site_id, status);

-- alerts: recent alerts per site, unread filter
CREATE INDEX idx_alerts_site_created
    ON alerts (site_id, created_at DESC);

CREATE INDEX idx_alerts_is_read
    ON alerts (is_read);

-- api_usage_log: usage history per user
CREATE INDEX idx_api_usage_log_user_created
    ON api_usage_log (user_id, created_at DESC);

-- site_pages: fast lookups by site and status
CREATE INDEX idx_site_pages_site ON site_pages(site_id);
CREATE INDEX idx_site_pages_status ON site_pages(index_status);

-- keywords: foreign key lookup and deduplication
CREATE INDEX idx_keywords_location_code
    ON keywords (location_code);

CREATE INDEX idx_keywords_site_keyword_location
    ON keywords (site_id, keyword, location_code);


-- =============================================================================
-- UPDATED_AT TRIGGER (auto-set updated_at on sites)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

CREATE TRIGGER set_sites_updated_at
    BEFORE UPDATE ON sites
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_updated_at();


-- =============================================================================
-- ROW LEVEL SECURITY
-- =============================================================================

-- Enable RLS on every table
ALTER TABLE site_pages         ENABLE ROW LEVEL SECURITY;
ALTER TABLE locations          ENABLE ROW LEVEL SECURITY;
ALTER TABLE sites              ENABLE ROW LEVEL SECURITY;
ALTER TABLE keywords           ENABLE ROW LEVEL SECURITY;
ALTER TABLE keyword_positions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE deindexed_urls     ENABLE ROW LEVEL SECURITY;
ALTER TABLE technical_audits   ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_links         ENABLE ROW LEVEL SECURITY;
ALTER TABLE alerts             ENABLE ROW LEVEL SECURITY;
ALTER TABLE alert_rules        ENABLE ROW LEVEL SECURITY;
ALTER TABLE indexer_tasks      ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_usage_log      ENABLE ROW LEVEL SECURITY;


-- ---- SITE_PAGES (owned through sites) --------------------------------------

CREATE POLICY "Users can view pages of their sites"
    ON site_pages FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM sites
            WHERE sites.id = site_pages.site_id
              AND sites.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can insert pages for their sites"
    ON site_pages FOR INSERT
    TO authenticated
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM sites
            WHERE sites.id = site_pages.site_id
              AND sites.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can update pages of their sites"
    ON site_pages FOR UPDATE
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM sites
            WHERE sites.id = site_pages.site_id
              AND sites.user_id = auth.uid()
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM sites
            WHERE sites.id = site_pages.site_id
              AND sites.user_id = auth.uid()
        )
    );


-- ---- LOCATIONS (read-only reference data for all authenticated users) ------

CREATE POLICY "Authenticated users can read locations"
    ON locations FOR SELECT
    TO authenticated
    USING (true);


-- ---- SITES -----------------------------------------------------------------

CREATE POLICY "Users can view their own sites"
    ON sites FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own sites"
    ON sites FOR INSERT
    TO authenticated
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own sites"
    ON sites FOR UPDATE
    TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own sites"
    ON sites FOR DELETE
    TO authenticated
    USING (auth.uid() = user_id);


-- ---- KEYWORDS (owned through sites) ----------------------------------------

CREATE POLICY "Users can view keywords for their sites"
    ON keywords FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM sites
            WHERE sites.id = keywords.site_id
              AND sites.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can insert keywords for their sites"
    ON keywords FOR INSERT
    TO authenticated
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM sites
            WHERE sites.id = keywords.site_id
              AND sites.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can update keywords for their sites"
    ON keywords FOR UPDATE
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM sites
            WHERE sites.id = keywords.site_id
              AND sites.user_id = auth.uid()
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM sites
            WHERE sites.id = keywords.site_id
              AND sites.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can delete keywords for their sites"
    ON keywords FOR DELETE
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM sites
            WHERE sites.id = keywords.site_id
              AND sites.user_id = auth.uid()
        )
    );


-- ---- KEYWORD_POSITIONS (owned through sites) --------------------------------

CREATE POLICY "Users can view positions for their sites"
    ON keyword_positions FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM sites
            WHERE sites.id = keyword_positions.site_id
              AND sites.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can insert positions for their sites"
    ON keyword_positions FOR INSERT
    TO authenticated
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM sites
            WHERE sites.id = keyword_positions.site_id
              AND sites.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can delete positions for their sites"
    ON keyword_positions FOR DELETE
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM sites
            WHERE sites.id = keyword_positions.site_id
              AND sites.user_id = auth.uid()
        )
    );


-- ---- DEINDEXED_URLS (owned through sites) -----------------------------------

CREATE POLICY "Users can view deindexed URLs for their sites"
    ON deindexed_urls FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM sites
            WHERE sites.id = deindexed_urls.site_id
              AND sites.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can insert deindexed URLs for their sites"
    ON deindexed_urls FOR INSERT
    TO authenticated
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM sites
            WHERE sites.id = deindexed_urls.site_id
              AND sites.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can update deindexed URLs for their sites"
    ON deindexed_urls FOR UPDATE
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM sites
            WHERE sites.id = deindexed_urls.site_id
              AND sites.user_id = auth.uid()
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM sites
            WHERE sites.id = deindexed_urls.site_id
              AND sites.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can delete deindexed URLs for their sites"
    ON deindexed_urls FOR DELETE
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM sites
            WHERE sites.id = deindexed_urls.site_id
              AND sites.user_id = auth.uid()
        )
    );


-- ---- TECHNICAL_AUDITS (owned through sites) ---------------------------------

CREATE POLICY "Users can view audits for their sites"
    ON technical_audits FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM sites
            WHERE sites.id = technical_audits.site_id
              AND sites.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can insert audits for their sites"
    ON technical_audits FOR INSERT
    TO authenticated
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM sites
            WHERE sites.id = technical_audits.site_id
              AND sites.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can delete audits for their sites"
    ON technical_audits FOR DELETE
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM sites
            WHERE sites.id = technical_audits.site_id
              AND sites.user_id = auth.uid()
        )
    );


-- ---- SITE_LINKS (user must own the source site) ----------------------------

CREATE POLICY "Users can view links from their sites"
    ON site_links FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM sites
            WHERE sites.id = site_links.source_site_id
              AND sites.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can insert links from their sites"
    ON site_links FOR INSERT
    TO authenticated
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM sites
            WHERE sites.id = site_links.source_site_id
              AND sites.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can update links from their sites"
    ON site_links FOR UPDATE
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM sites
            WHERE sites.id = site_links.source_site_id
              AND sites.user_id = auth.uid()
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM sites
            WHERE sites.id = site_links.source_site_id
              AND sites.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can delete links from their sites"
    ON site_links FOR DELETE
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM sites
            WHERE sites.id = site_links.source_site_id
              AND sites.user_id = auth.uid()
        )
    );


-- ---- ALERTS (owned through sites) ------------------------------------------

CREATE POLICY "Users can view alerts for their sites"
    ON alerts FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM sites
            WHERE sites.id = alerts.site_id
              AND sites.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can update alerts for their sites"
    ON alerts FOR UPDATE
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM sites
            WHERE sites.id = alerts.site_id
              AND sites.user_id = auth.uid()
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM sites
            WHERE sites.id = alerts.site_id
              AND sites.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can insert alerts for their sites"
    ON alerts FOR INSERT
    TO authenticated
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM sites
            WHERE sites.id = alerts.site_id
              AND sites.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can delete alerts for their sites"
    ON alerts FOR DELETE
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM sites
            WHERE sites.id = alerts.site_id
              AND sites.user_id = auth.uid()
        )
    );


-- ---- ALERT_RULES (direct user_id) ------------------------------------------

CREATE POLICY "Users can view their own alert rules"
    ON alert_rules FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own alert rules"
    ON alert_rules FOR INSERT
    TO authenticated
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own alert rules"
    ON alert_rules FOR UPDATE
    TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own alert rules"
    ON alert_rules FOR DELETE
    TO authenticated
    USING (auth.uid() = user_id);


-- ---- INDEXER_TASKS (owned through sites) ------------------------------------

CREATE POLICY "Users can view indexer tasks for their sites"
    ON indexer_tasks FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM sites
            WHERE sites.id = indexer_tasks.site_id
              AND sites.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can insert indexer tasks for their sites"
    ON indexer_tasks FOR INSERT
    TO authenticated
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM sites
            WHERE sites.id = indexer_tasks.site_id
              AND sites.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can update indexer tasks for their sites"
    ON indexer_tasks FOR UPDATE
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM sites
            WHERE sites.id = indexer_tasks.site_id
              AND sites.user_id = auth.uid()
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM sites
            WHERE sites.id = indexer_tasks.site_id
              AND sites.user_id = auth.uid()
        )
    );


-- ---- API_USAGE_LOG (direct user_id) ----------------------------------------

CREATE POLICY "Users can view their own API usage"
    ON api_usage_log FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own API usage"
    ON api_usage_log FOR INSERT
    TO authenticated
    WITH CHECK (auth.uid() = user_id);


-- =============================================================================
-- SEED DATA: LOCATIONS
-- =============================================================================
-- All DataForSEO country location codes EXCEPT Africa (148 countries).

INSERT INTO locations (code, name, country_iso, default_language) VALUES
    -- Asia
    (2004, 'Afghanistan',           'AF', 'ps'),
    (2031, 'Azerbaijan',            'AZ', 'az'),
    (2048, 'Bahrain',               'BH', 'ar'),
    (2050, 'Bangladesh',            'BD', 'bn'),
    (2064, 'Bhutan',                'BT', 'dz'),
    (2096, 'Brunei',                'BN', 'ms'),
    (2104, 'Myanmar (Burma)',       'MM', 'my'),
    (2116, 'Cambodia',              'KH', 'km'),
    (2156, 'China',                 'CN', 'zh'),
    (2268, 'Georgia',               'GE', 'ka'),
    (2356, 'India',                 'IN', 'en'),
    (2360, 'Indonesia',             'ID', 'id'),
    (2368, 'Iraq',                  'IQ', 'ar'),
    (2376, 'Israel',                'IL', 'he'),
    (2392, 'Japan',                 'JP', 'ja'),
    (2400, 'Jordan',                'JO', 'ar'),
    (2398, 'Kazakhstan',            'KZ', 'kk'),
    (2410, 'South Korea',           'KR', 'ko'),
    (2414, 'Kuwait',                'KW', 'ar'),
    (2417, 'Kyrgyzstan',            'KG', 'ky'),
    (2418, 'Laos',                  'LA', 'lo'),
    (2422, 'Lebanon',               'LB', 'ar'),
    (2458, 'Malaysia',              'MY', 'ms'),
    (2462, 'Maldives',              'MV', 'dv'),
    (2496, 'Mongolia',              'MN', 'mn'),
    (2524, 'Nepal',                 'NP', 'ne'),
    (2512, 'Oman',                  'OM', 'ar'),
    (2586, 'Pakistan',              'PK', 'ur'),
    (2608, 'Philippines',           'PH', 'en'),
    (2634, 'Qatar',                 'QA', 'ar'),
    (2682, 'Saudi Arabia',          'SA', 'ar'),
    (2702, 'Singapore',             'SG', 'en'),
    (2144, 'Sri Lanka',             'LK', 'si'),
    (2762, 'Tajikistan',            'TJ', 'tg'),
    (2764, 'Thailand',              'TH', 'th'),
    (2626, 'Timor-Leste',           'TL', 'pt'),
    (2795, 'Turkmenistan',          'TM', 'tk'),
    (2784, 'United Arab Emirates',  'AE', 'ar'),
    (2860, 'Uzbekistan',            'UZ', 'uz'),
    (2704, 'Vietnam',               'VN', 'vi'),
    (2887, 'Yemen',                 'YE', 'ar'),

    -- Europe
    (2008, 'Albania',               'AL', 'sq'),
    (2020, 'Andorra',               'AD', 'ca'),
    (2051, 'Armenia',               'AM', 'hy'),
    (2040, 'Austria',               'AT', 'de'),
    (2056, 'Belgium',               'BE', 'fr'),
    (2070, 'Bosnia and Herzegovina','BA', 'bs'),
    (2100, 'Bulgaria',              'BG', 'bg'),
    (2191, 'Croatia',               'HR', 'hr'),
    (2196, 'Cyprus',                'CY', 'el'),
    (2203, 'Czechia',               'CZ', 'cs'),
    (2208, 'Denmark',               'DK', 'da'),
    (2233, 'Estonia',               'EE', 'et'),
    (2246, 'Finland',               'FI', 'fi'),
    (2250, 'France',                'FR', 'fr'),
    (2276, 'Germany',               'DE', 'de'),
    (2300, 'Greece',                'GR', 'el'),
    (2831, 'Guernsey',              'GG', 'en'),
    (2348, 'Hungary',               'HU', 'hu'),
    (2352, 'Iceland',               'IS', 'is'),
    (2372, 'Ireland',               'IE', 'en'),
    (2833, 'Isle of Man',           'IM', 'en'),
    (2380, 'Italy',                 'IT', 'it'),
    (2832, 'Jersey',                'JE', 'en'),
    (2428, 'Latvia',                'LV', 'lv'),
    (2438, 'Liechtenstein',         'LI', 'de'),
    (2440, 'Lithuania',             'LT', 'lt'),
    (2442, 'Luxembourg',            'LU', 'fr'),
    (2470, 'Malta',                 'MT', 'en'),
    (2498, 'Moldova',               'MD', 'ro'),
    (2492, 'Monaco',                'MC', 'fr'),
    (2499, 'Montenegro',            'ME', 'sr'),
    (2528, 'Netherlands',           'NL', 'nl'),
    (2807, 'North Macedonia',       'MK', 'mk'),
    (2578, 'Norway',                'NO', 'no'),
    (2616, 'Poland',                'PL', 'pl'),
    (2620, 'Portugal',              'PT', 'pt'),
    (2642, 'Romania',               'RO', 'ro'),
    (2674, 'San Marino',            'SM', 'it'),
    (2688, 'Serbia',                'RS', 'sr'),
    (2703, 'Slovakia',              'SK', 'sk'),
    (2705, 'Slovenia',              'SI', 'sl'),
    (2724, 'Spain',                 'ES', 'es'),
    (2752, 'Sweden',                'SE', 'sv'),
    (2756, 'Switzerland',           'CH', 'de'),
    (2792, 'Turkiye',               'TR', 'tr'),
    (2804, 'Ukraine',               'UA', 'uk'),
    (2826, 'United Kingdom',        'GB', 'en'),
    (2336, 'Vatican City',          'VA', 'it'),

    -- North America
    (2016, 'American Samoa',        'AS', 'en'),
    (2028, 'Antigua and Barbuda',   'AG', 'en'),
    (2044, 'The Bahamas',           'BS', 'en'),
    (2052, 'Barbados',              'BB', 'en'),
    (2084, 'Belize',                'BZ', 'en'),
    (2124, 'Canada',                'CA', 'en'),
    (2535, 'Caribbean Netherlands', 'BQ', 'nl'),
    (2188, 'Costa Rica',            'CR', 'es'),
    (2531, 'Curacao',               'CW', 'nl'),
    (2212, 'Dominica',              'DM', 'en'),
    (2214, 'Dominican Republic',    'DO', 'es'),
    (2222, 'El Salvador',           'SV', 'es'),
    (2308, 'Grenada',               'GD', 'en'),
    (2316, 'Guam',                  'GU', 'en'),
    (2320, 'Guatemala',             'GT', 'es'),
    (2332, 'Haiti',                 'HT', 'fr'),
    (2340, 'Honduras',              'HN', 'es'),
    (2388, 'Jamaica',               'JM', 'en'),
    (2484, 'Mexico',                'MX', 'es'),
    (2558, 'Nicaragua',             'NI', 'es'),
    (2580, 'Northern Mariana Islands','MP', 'en'),
    (2591, 'Panama',                'PA', 'es'),
    (2659, 'Saint Kitts and Nevis', 'KN', 'en'),
    (2662, 'Saint Lucia',           'LC', 'en'),
    (2663, 'Saint Martin',          'MF', 'fr'),
    (2670, 'Saint Vincent and the Grenadines', 'VC', 'en'),
    (2534, 'Sint Maarten',          'SX', 'nl'),
    (2780, 'Trinidad and Tobago',   'TT', 'en'),
    (2840, 'United States',         'US', 'en'),

    -- South America
    (2032, 'Argentina',             'AR', 'es'),
    (2068, 'Bolivia',               'BO', 'es'),
    (2076, 'Brazil',                'BR', 'pt'),
    (2152, 'Chile',                 'CL', 'es'),
    (2170, 'Colombia',              'CO', 'es'),
    (2218, 'Ecuador',               'EC', 'es'),
    (2258, 'French Polynesia',      'PF', 'fr'),
    (2328, 'Guyana',                'GY', 'en'),
    (2600, 'Paraguay',              'PY', 'es'),
    (2604, 'Peru',                  'PE', 'es'),
    (2740, 'Suriname',              'SR', 'nl'),
    (2858, 'Uruguay',               'UY', 'es'),
    (2862, 'Venezuela',             'VE', 'es'),

    -- Oceania
    (2036, 'Australia',             'AU', 'en'),
    (2184, 'Cook Islands',          'CK', 'en'),
    (2242, 'Fiji',                  'FJ', 'en'),
    (2296, 'Kiribati',              'KI', 'en'),
    (2584, 'Marshall Islands',      'MH', 'en'),
    (2583, 'Micronesia',            'FM', 'en'),
    (2520, 'Nauru',                 'NR', 'en'),
    (2540, 'New Caledonia',         'NC', 'fr'),
    (2554, 'New Zealand',           'NZ', 'en'),
    (2585, 'Palau',                 'PW', 'en'),
    (2598, 'Papua New Guinea',      'PG', 'en'),
    (2882, 'Samoa',                 'WS', 'en'),
    (2090, 'Solomon Islands',       'SB', 'en'),
    (2776, 'Tonga',                 'TO', 'en'),
    (2798, 'Tuvalu',                'TV', 'en'),
    (2548, 'Vanuatu',               'VU', 'en')
ON CONFLICT (code) DO NOTHING;

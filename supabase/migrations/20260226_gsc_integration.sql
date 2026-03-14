-- =============================================================================
-- GSC Integration - Migration
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. GSC_PROPERTIES
-- ---------------------------------------------------------------------------
CREATE TABLE gsc_properties (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    site_url        text        NOT NULL,
    permission_level text,
    site_id         uuid        REFERENCES sites(id) ON DELETE SET NULL,
    is_active       boolean     DEFAULT true,
    last_synced_at  timestamptz,
    created_at      timestamptz DEFAULT now(),
    UNIQUE(user_id, site_url)
);

ALTER TABLE gsc_properties ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own gsc_properties"
    ON gsc_properties FOR SELECT TO authenticated
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own gsc_properties"
    ON gsc_properties FOR INSERT TO authenticated
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own gsc_properties"
    ON gsc_properties FOR UPDATE TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own gsc_properties"
    ON gsc_properties FOR DELETE TO authenticated
    USING (auth.uid() = user_id);


-- ---------------------------------------------------------------------------
-- 2. GSC_SEARCH_DATA
-- ---------------------------------------------------------------------------
CREATE TABLE gsc_search_data (
    id                uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
    gsc_property_id   uuid    NOT NULL REFERENCES gsc_properties(id) ON DELETE CASCADE,
    date              date    NOT NULL,
    query             text    NOT NULL,
    page              text,
    country           text    NOT NULL,  -- ISO 3166-1 alpha-3 from GSC
    clicks            integer NOT NULL DEFAULT 0,
    impressions       integer NOT NULL DEFAULT 0,
    ctr               real    NOT NULL DEFAULT 0,
    position          real    NOT NULL DEFAULT 0,
    created_at        timestamptz DEFAULT now()
);

-- Unique constraint on the combination (allows upserts)
CREATE UNIQUE INDEX idx_gsc_data_unique
    ON gsc_search_data (gsc_property_id, date, query, COALESCE(page, ''), country);

CREATE INDEX idx_gsc_data_prop_date ON gsc_search_data(gsc_property_id, date);
CREATE INDEX idx_gsc_data_clicks ON gsc_search_data(clicks DESC);
CREATE INDEX idx_gsc_data_country ON gsc_search_data(country);

ALTER TABLE gsc_search_data ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own gsc_search_data"
    ON gsc_search_data FOR SELECT TO authenticated
    USING (
        gsc_property_id IN (
            SELECT id FROM gsc_properties WHERE user_id = auth.uid()
        )
    );

CREATE POLICY "Users can insert own gsc_search_data"
    ON gsc_search_data FOR INSERT TO authenticated
    WITH CHECK (
        gsc_property_id IN (
            SELECT id FROM gsc_properties WHERE user_id = auth.uid()
        )
    );

CREATE POLICY "Users can delete own gsc_search_data"
    ON gsc_search_data FOR DELETE TO authenticated
    USING (
        gsc_property_id IN (
            SELECT id FROM gsc_properties WHERE user_id = auth.uid()
        )
    );


-- ---------------------------------------------------------------------------
-- 3. COUNTRY_CODE_MAPPING (alpha-3 GSC -> alpha-2 + DataForSEO location_code)
-- ---------------------------------------------------------------------------
CREATE TABLE country_code_mapping (
    alpha3          text    PRIMARY KEY,
    alpha2          text    NOT NULL,
    location_code   integer REFERENCES locations(code)
);

ALTER TABLE country_code_mapping ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read country_code_mapping"
    ON country_code_mapping FOR SELECT TO authenticated
    USING (true);

-- Seed country mappings (only inserts rows where location_code exists in locations)
INSERT INTO country_code_mapping (alpha3, alpha2, location_code)
SELECT v.alpha3, v.alpha2, v.loc
FROM (VALUES
    ('AFG', 'af', 2004), ('ALB', 'al', 2008), ('AND', 'ad', 2020),
    ('ARG', 'ar', 2032), ('ARM', 'am', 2051), ('AUS', 'au', 2036),
    ('AUT', 'at', 2040), ('AZE', 'az', 2031), ('BHR', 'bh', 2048),
    ('BGD', 'bd', 2050), ('BRB', 'bb', 2052), ('BEL', 'be', 2056),
    ('BLZ', 'bz', 2084), ('BTN', 'bt', 2064), ('BOL', 'bo', 2068),
    ('BIH', 'ba', 2070), ('BRA', 'br', 2076), ('BRN', 'bn', 2096),
    ('BGR', 'bg', 2100), ('MMR', 'mm', 2104), ('KHM', 'kh', 2116),
    ('CAN', 'ca', 2124), ('CHL', 'cl', 2152), ('CHN', 'cn', 2156),
    ('COL', 'co', 2170), ('CRI', 'cr', 2188), ('HRV', 'hr', 2191),
    ('CYP', 'cy', 2196), ('CZE', 'cz', 2203), ('DNK', 'dk', 2208),
    ('DOM', 'do', 2214), ('ECU', 'ec', 2218), ('SLV', 'sv', 2222),
    ('EST', 'ee', 2233), ('FIN', 'fi', 2246), ('FRA', 'fr', 2250),
    ('GEO', 'ge', 2268), ('DEU', 'de', 2276), ('GRC', 'gr', 2300),
    ('GTM', 'gt', 2320), ('GUY', 'gy', 2328), ('HTI', 'ht', 2332),
    ('HND', 'hn', 2340), ('HUN', 'hu', 2348), ('ISL', 'is', 2352),
    ('IND', 'in', 2356), ('IDN', 'id', 2360), ('IRQ', 'iq', 2368),
    ('IRL', 'ie', 2372), ('ISR', 'il', 2376), ('ITA', 'it', 2380),
    ('JAM', 'jm', 2388), ('JPN', 'jp', 2392), ('JOR', 'jo', 2400),
    ('KAZ', 'kz', 2398), ('KOR', 'kr', 2410), ('KWT', 'kw', 2414),
    ('KGZ', 'kg', 2417), ('LAO', 'la', 2418), ('LVA', 'lv', 2428),
    ('LBN', 'lb', 2422), ('LIE', 'li', 2438), ('LTU', 'lt', 2440),
    ('LUX', 'lu', 2442), ('MYS', 'my', 2458), ('MDV', 'mv', 2462),
    ('MLT', 'mt', 2470), ('MEX', 'mx', 2484), ('MDA', 'md', 2498),
    ('MCO', 'mc', 2492), ('MNG', 'mn', 2496), ('MNE', 'me', 2499),
    ('NLD', 'nl', 2528), ('NZL', 'nz', 2554), ('NIC', 'ni', 2558),
    ('MKD', 'mk', 2807), ('NOR', 'no', 2578), ('OMN', 'om', 2512),
    ('PAK', 'pk', 2586), ('PAN', 'pa', 2591), ('PRY', 'py', 2600),
    ('PER', 'pe', 2604), ('PHL', 'ph', 2608), ('POL', 'pl', 2616),
    ('PRT', 'pt', 2620), ('QAT', 'qa', 2634), ('ROU', 'ro', 2642),
    ('SAU', 'sa', 2682), ('SRB', 'rs', 2688), ('SGP', 'sg', 2702),
    ('SVK', 'sk', 2703), ('SVN', 'si', 2705), ('ESP', 'es', 2724),
    ('LKA', 'lk', 2144), ('SUR', 'sr', 2740), ('SWE', 'se', 2752),
    ('CHE', 'ch', 2756), ('TJK', 'tj', 2762), ('THA', 'th', 2764),
    ('TLS', 'tl', 2626), ('TTO', 'tt', 2780), ('TUR', 'tr', 2792),
    ('TKM', 'tm', 2795), ('ARE', 'ae', 2784), ('UKR', 'ua', 2804),
    ('GBR', 'gb', 2826), ('USA', 'us', 2840), ('URY', 'uy', 2858),
    ('UZB', 'uz', 2860), ('VEN', 've', 2862), ('VNM', 'vn', 2704),
    ('YEM', 'ye', 2887), ('NPL', 'np', 2524)
) AS v(alpha3, alpha2, loc)
WHERE EXISTS (SELECT 1 FROM locations WHERE code = v.loc)
ON CONFLICT (alpha3) DO NOTHING;


-- ---------------------------------------------------------------------------
-- 4. GSC_AUTO_RULES
-- ---------------------------------------------------------------------------
CREATE TABLE gsc_auto_rules (
    id                      uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                 uuid    NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
    min_clicks_keyword      integer NOT NULL DEFAULT 23,
    min_clicks_page_daily   integer NOT NULL DEFAULT 5,
    auto_add_enabled        boolean DEFAULT true,
    created_at              timestamptz DEFAULT now()
);

ALTER TABLE gsc_auto_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own gsc_auto_rules"
    ON gsc_auto_rules FOR ALL TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);


-- ---------------------------------------------------------------------------
-- 5. Update api_usage_log to accept 'gsc' service
-- ---------------------------------------------------------------------------
ALTER TABLE api_usage_log DROP CONSTRAINT IF EXISTS api_usage_log_service_check;
ALTER TABLE api_usage_log ADD CONSTRAINT api_usage_log_service_check
    CHECK (service IN ('dataforseo', 'rapid_indexer', 'brave', 'gsc'));

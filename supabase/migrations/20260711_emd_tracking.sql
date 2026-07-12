-- =============================================================================
-- EMD Rankings & ROI tracking
-- =============================================================================
-- 1. sites: classification EMD vs shop vs autre + flag de tracking SERP payant
--    (DataForSEO ne doit JAMAIS être appelé pour les shops e-commerce)
-- 2. domain_finance: coût d'achat / renouvellement par domaine
-- 3. domain_revenue: revenus affiliation par domaine et par jour (Everflow)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. SITES — classification + tracking flag + métadonnées Cloudflare
-- ---------------------------------------------------------------------------
ALTER TABLE sites
    ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT 'other'
        CHECK (category IN ('emd', 'shop', 'other')),
    ADD COLUMN IF NOT EXISTS serp_tracking_enabled boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS cf_account text,
    ADD COLUMN IF NOT EXISTS registrar text;

COMMENT ON COLUMN sites.category IS 'Classification métier: emd (landing domaine exact, tracking SERP payant autorisé), shop (e-commerce, GSC uniquement), other (à classer).';
COMMENT ON COLUMN sites.serp_tracking_enabled IS 'Autorise les checks SERP DataForSEO (payants). Jamais activé automatiquement pour category != emd.';
COMMENT ON COLUMN sites.cf_account IS 'Label du compte Cloudflare source (principal | flokinet | leoblackseo).';

-- Backfill: les sites déjà typés emd deviennent category=emd,
-- les sites nutra (shops WooCommerce suivis via GSC) deviennent shop.
UPDATE sites SET category = 'emd'  WHERE site_type = 'emd'   AND category = 'other';
UPDATE sites SET category = 'shop' WHERE site_type = 'nutra' AND category = 'other';

-- ---------------------------------------------------------------------------
-- 2. DOMAIN_FINANCE — 1 ligne par site
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS domain_finance (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    site_id         uuid        NOT NULL UNIQUE REFERENCES sites ON DELETE CASCADE,
    purchase_price  numeric     NOT NULL DEFAULT 0,
    purchase_date   date,
    renewal_price   numeric     NOT NULL DEFAULT 0,
    renewal_date    date,
    currency        text        NOT NULL DEFAULT 'USD',
    notes           text,
    updated_at      timestamptz DEFAULT now()
);

COMMENT ON TABLE domain_finance IS 'Coûts d''acquisition et de renouvellement par domaine (saisie manuelle, import Dynadot plus tard).';

-- ---------------------------------------------------------------------------
-- 3. DOMAIN_REVENUE — revenus affiliation par domaine / jour / réseau
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS domain_revenue (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    site_id         uuid        NOT NULL REFERENCES sites ON DELETE CASCADE,
    date            date        NOT NULL,
    network         text        NOT NULL DEFAULT 'everflow',
    conversions     integer     NOT NULL DEFAULT 0,
    revenue_usd     numeric     NOT NULL DEFAULT 0,
    created_at      timestamptz DEFAULT now(),

    UNIQUE (site_id, date, network)
);

COMMENT ON TABLE domain_revenue IS 'Revenus affiliation journaliers par domaine (sync API Everflow par subid=domaine).';

CREATE INDEX IF NOT EXISTS idx_domain_revenue_site_date
    ON domain_revenue (site_id, date DESC);

-- ---------------------------------------------------------------------------
-- RLS (mêmes patterns que site_pages: propriété via sites.user_id)
-- ---------------------------------------------------------------------------
ALTER TABLE domain_finance ENABLE ROW LEVEL SECURITY;
ALTER TABLE domain_revenue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view finance of their sites"
    ON domain_finance FOR SELECT TO authenticated
    USING (EXISTS (SELECT 1 FROM sites WHERE sites.id = domain_finance.site_id AND sites.user_id = auth.uid()));

CREATE POLICY "Users can insert finance for their sites"
    ON domain_finance FOR INSERT TO authenticated
    WITH CHECK (EXISTS (SELECT 1 FROM sites WHERE sites.id = domain_finance.site_id AND sites.user_id = auth.uid()));

CREATE POLICY "Users can update finance of their sites"
    ON domain_finance FOR UPDATE TO authenticated
    USING (EXISTS (SELECT 1 FROM sites WHERE sites.id = domain_finance.site_id AND sites.user_id = auth.uid()))
    WITH CHECK (EXISTS (SELECT 1 FROM sites WHERE sites.id = domain_finance.site_id AND sites.user_id = auth.uid()));

CREATE POLICY "Users can delete finance of their sites"
    ON domain_finance FOR DELETE TO authenticated
    USING (EXISTS (SELECT 1 FROM sites WHERE sites.id = domain_finance.site_id AND sites.user_id = auth.uid()));

CREATE POLICY "Users can view revenue of their sites"
    ON domain_revenue FOR SELECT TO authenticated
    USING (EXISTS (SELECT 1 FROM sites WHERE sites.id = domain_revenue.site_id AND sites.user_id = auth.uid()));

CREATE POLICY "Users can insert revenue for their sites"
    ON domain_revenue FOR INSERT TO authenticated
    WITH CHECK (EXISTS (SELECT 1 FROM sites WHERE sites.id = domain_revenue.site_id AND sites.user_id = auth.uid()));

CREATE POLICY "Users can update revenue of their sites"
    ON domain_revenue FOR UPDATE TO authenticated
    USING (EXISTS (SELECT 1 FROM sites WHERE sites.id = domain_revenue.site_id AND sites.user_id = auth.uid()))
    WITH CHECK (EXISTS (SELECT 1 FROM sites WHERE sites.id = domain_revenue.site_id AND sites.user_id = auth.uid()));

CREATE POLICY "Users can delete revenue of their sites"
    ON domain_revenue FOR DELETE TO authenticated
    USING (EXISTS (SELECT 1 FROM sites WHERE sites.id = domain_revenue.site_id AND sites.user_id = auth.uid()));

-- ---------------------------------------------------------------------------
-- 4. KEYWORDS.IS_PRIMARY — seul le mot-clé principal est vérifié par le cron
--    SERP hebdo (évite de payer pour les keywords hérités du mode shop, ex.
--    orivelle-ongles.fr en avait 76).
-- ---------------------------------------------------------------------------
ALTER TABLE keywords ADD COLUMN IF NOT EXISTS is_primary boolean NOT NULL DEFAULT false;

-- Sites EMD avec un seul mot-clé -> il est principal
UPDATE keywords k SET is_primary = true
FROM sites s
WHERE k.site_id = s.id AND s.category = 'emd'
  AND (SELECT count(*) FROM keywords k2 WHERE k2.site_id = k.site_id) = 1;

-- Cas particulier : orivelle-ongles.fr (76 keywords hérités)
UPDATE keywords k SET is_primary = true
FROM sites s
WHERE k.site_id = s.id AND s.domain = 'orivelle-ongles.fr' AND k.keyword = 'orivelle ongles';

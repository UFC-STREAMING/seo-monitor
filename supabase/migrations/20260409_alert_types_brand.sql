-- =============================================================================
-- Étendre les types d'alertes pour les brands
-- =============================================================================

-- Ajouter les nouveaux types d'alerte pour le brand tracking
ALTER TYPE alert_type ADD VALUE IF NOT EXISTS 'brand_hot';
ALTER TYPE alert_type ADD VALUE IF NOT EXISTS 'brand_cooling';
ALTER TYPE alert_type ADD VALUE IF NOT EXISTS 'optimization_needed';

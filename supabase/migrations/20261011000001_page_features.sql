-- Éléments de la page d'accueil de chaque EMD (scan quotidien) : comparés aux taux de clic/vente.
alter table sites add column if not exists page_features jsonb;
alter table sites add column if not exists page_scanned_at timestamptz;

-- Suivi multi-pays des EMD en .com/.org/.net (Leo 09/10/2026) : le même mot-clé
-- est relevé dans chaque pays anglophone couvert par une offre approuvée de la
-- marque (ex. twistapure US + UK + AU). Le mot-clé principal reste is_primary ;
-- les pays en plus sont geo_extra (posés chaque matin par le contrôle affilié).
alter table keywords add column if not exists geo_extra boolean not null default false;
create index if not exists idx_keywords_geo_extra on keywords (site_id) where geo_extra;

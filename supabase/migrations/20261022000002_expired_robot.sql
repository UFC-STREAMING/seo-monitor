-- Robot d'achat des domaines expirés (Leo 22/10/2026) : ce que Leo coche sur /expires devient un ordre
-- exécuté par le robot du Mac Mini (navigateur connecté de Dana).
--   Catched  : poser le backorder.
--   Nicsell  : miser le prix max de Leo 5 minutes avant la fin de l'enchère (20h, heure de Paris).
alter table expired_listings add column if not exists robot_requested boolean not null default false;
alter table expired_listings add column if not exists max_bid numeric;               -- prix max en € (Nicsell)
alter table expired_listings add column if not exists robot_status text;             -- pending | done | failed | won | lost | cancelled
alter table expired_listings add column if not exists robot_note text;               -- détail lisible (« backorder posé », erreur…)
alter table expired_listings add column if not exists robot_at timestamptz;          -- dernière action du robot
alter table expired_listings add column if not exists ends_at_ts timestamptz;        -- fin normalisée (pour trier et déclencher)
create index if not exists idx_expired_listings_robot on expired_listings (robot_status) where robot_requested;

-- Domaines expirés du jour (Leo 22/10/2026) : liste poussée chaque matin par l'agent Dana (Hermes),
-- trafic Google estimé (DataForSEO Labs via treg) et plateformes où le backorder / l'enchère est dispo.

-- Un domaine = une ligne, trafic mis en cache (on ne repaie pas un domaine déjà relevé récemment).
create table if not exists expired_domains (
  domain text primary key,
  category text not null default 'medical',            -- medical | psy | sport
  label text,                                          -- type + ville en français (« clinique dentaire, Naples »)
  tld text,
  traffic_current numeric,                             -- dernier mois relevé
  traffic_6m numeric,                                  -- il y a 6 mois
  traffic_peak numeric,
  peak_month text,                                     -- AAAA-MM
  traffic_series jsonb,                                -- [{"m":"2026-10","v":123}, ...] du plus ancien au plus récent
  traffic_checked_at timestamptz,
  first_seen date not null default current_date,
  last_seen date not null default current_date
);

-- Une ligne par (jour, domaine, plateforme) : la liste change chaque jour.
create table if not exists expired_listings (
  id bigserial primary key,
  list_date date not null,
  domain text not null references expired_domains(domain) on delete cascade,
  platform text not null,                              -- catched | nicsell | webexpire | bloomup | dynadot | domainorder | realtime
  kind text not null default 'backorder',              -- backorder | auction
  price text,
  ends_at text,
  backorder_placed boolean not null default false,     -- case cochée par Leo : « backorder posé ici »
  placed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (list_date, domain, platform)
);
create index if not exists idx_expired_listings_date on expired_listings (list_date);

alter table expired_domains enable row level security;
alter table expired_listings enable row level security;

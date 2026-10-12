-- Réseaux affiliés derrière les boutons de chaque fiche des sites expirés (liens /out/<slug>/<cible base64>.<sig>/).
-- Sert à ne pas conclure « 0 vente » quand la fiche vend sur un réseau non branché (hors Everflow).
create table if not exists fiche_networks (
  host text not null,
  path text not null,
  targets text[] not null default '{}',
  everflow boolean not null default false,
  scanned_at timestamptz not null default now(),
  primary key (host, path)
);
alter table fiche_networks enable row level security;

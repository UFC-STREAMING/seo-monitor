-- Idées EMD (Leo 25/10/2026) : par produit et pays, vrais clics offres, ventes,
-- taux de conversion et Search Console des fiches nutra ; alimenté chaque jour
-- par nutra-factory (scripts/sync-idees-emd.ts sur Hetzner).
create table if not exists emd_idees (
  produit text not null,
  pays text not null,
  vrais_clics_7j int not null default 0,
  vrais_clics_30j int not null default 0,
  ventes_30j int not null default 0,
  revenu_30j numeric not null default 0,
  taux_conversion numeric,
  gsc_impressions_28j int not null default 0,
  gsc_clics_28j int not null default 0,
  gsc_position real,
  gsc_top_requete text,
  nb_fiches int not null default 0,
  sites text[] not null default '{}',
  emd_existant text,
  score numeric not null default 0,
  maj_le timestamptz not null default now(),
  primary key (produit, pays)
);
create table if not exists nutra_site_gsc (
  domaine text primary key,
  pays text,
  gsc_clics_28j int not null default 0,
  gsc_impressions_28j int not null default 0,
  vrais_clics_offres_30j int not null default 0,
  maj_le timestamptz not null default now()
);
alter table emd_idees enable row level security;
alter table nutra_site_gsc enable row level security;
create policy "lecture connectés" on emd_idees for select to authenticated using (true);
create policy "lecture connectés" on nutra_site_gsc for select to authenticated using (true);

-- Clics sur les boutons des EMD (Leo 11/10/2026) : envoyés par un mini-script posé
-- avec Clarity, au moment du clic (événement réel, pas les robots qui appellent /go/).
create table if not exists cta_clicks (
  id bigserial primary key,
  site_id uuid references sites(id) on delete cascade,
  domain text not null,
  page_path text,
  position text,          -- haut | milieu | bas | barre-fixe
  cta_index integer,      -- n° du bouton dans la page (1 = premier)
  cta_text text,
  y_pct integer,          -- hauteur du bouton dans la page, en %
  device text,            -- mobile | desktop
  country text,
  created_at timestamptz not null default now()
);
create index if not exists idx_cta_clicks_site_date on cta_clicks (site_id, created_at);
alter table cta_clicks enable row level security;

-- Template de chaque EMD (classé en lisant la page d'accueil)
alter table sites add column if not exists template text;

-- Section Tracking (Leo 10/10/2026) : entonnoir par EMD, sans Google Search Console.
-- Une ligne par site × jour × source :
--   bing     : impressions, clicks (Bing + Yahoo + DuckDuckGo, API Bing Webmaster)
--   clarity  : sessions, pageviews, scroll_depth, rage/dead clicks, quickbacks (tous visiteurs)
--   everflow : go_clicks (clics valides sur le bouton), go_invalid, conversions, revenue_usd
create table if not exists tracking_daily (
  id bigserial primary key,
  site_id uuid not null references sites(id) on delete cascade,
  date date not null,
  source text not null check (source in ('bing', 'clarity', 'everflow')),
  impressions integer,
  clicks integer,
  sessions integer,
  pageviews integer,
  scroll_depth numeric,
  engagement_seconds numeric,
  rage_clicks integer,
  dead_clicks integer,
  quickbacks integer,
  go_clicks integer,
  go_invalid integer,
  conversions integer,
  revenue_usd numeric,
  extra jsonb,
  updated_at timestamptz not null default now(),
  unique (site_id, date, source)
);
create index if not exists idx_tracking_daily_date on tracking_daily (date);
alter table tracking_daily enable row level security;

-- Projets Clarity (1 par EMD, même compte Microsoft) + jeton Data Export du projet.
create table if not exists clarity_projects (
  site_id uuid primary key references sites(id) on delete cascade,
  project_id text not null,
  api_token text,
  tag_installed_at timestamptz,
  created_at timestamptz not null default now()
);
alter table clarity_projects enable row level security;

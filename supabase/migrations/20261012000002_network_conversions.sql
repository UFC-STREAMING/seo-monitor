-- Ventes des réseaux hors Everflow reçues par postback (Leo 12/10/2026), d'abord Dr.Cash.
-- stream = code du stream (= sous-domaine du lien de la fiche : u3kwp.doctorluckysh.com → u3kwp).
create table if not exists network_conversions (
  id bigserial primary key,
  network text not null,
  stream text,
  offer text,
  status text,
  payout numeric,
  currency text,
  country text,
  click_id text,
  raw jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_network_conversions_stream on network_conversions (network, stream, created_at);
alter table network_conversions enable row level security;

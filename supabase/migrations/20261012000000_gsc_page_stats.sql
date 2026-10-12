-- Entonnoir des sites expirés (Leo 12/10/2026) : stats Search Console par page sur N jours.
create or replace function gsc_page_stats(p_days int default 28)
returns table (host text, path text, clicks bigint, impressions bigint, "position" real, top_query text, top_query_position real, top_query_impressions bigint)
language sql stable
as $$
  with d as (
    select split_part(regexp_replace(page, '^https?://(www\.)?', ''), '/', 1) as host,
           '/' || coalesce(nullif(substring(regexp_replace(page, '^https?://(www\.)?[^/]+/?', '') from '^(.*?)/?$'), ''), '') as path,
           query, clicks, impressions, position
    from gsc_search_data
    where date >= current_date - p_days
  ), q as (
    select host, path, query, sum(impressions) imp, sum(impressions * position) / nullif(sum(impressions), 0) pos
    from d group by 1, 2, 3
  ), best as (
    select distinct on (host, path) host, path, query, pos, imp from q order by host, path, imp desc
  )
  select d.host, d.path, sum(d.clicks)::bigint, sum(d.impressions)::bigint,
         (sum(d.impressions * d.position) / nullif(sum(d.impressions), 0))::real,
         b.query, b.pos::real, b.imp::bigint
  from d left join best b on b.host = d.host and b.path = d.path
  group by d.host, d.path, b.query, b.pos, b.imp
  having sum(d.impressions) >= 20
  order by 3 desc
  limit 2000
$$;
revoke all on function gsc_page_stats(int) from public, anon, authenticated;
grant execute on function gsc_page_stats(int) to service_role;

-- Requêtes « à gagner » : position 4-15 avec des impressions, sur N jours
create or replace function gsc_quick_wins(p_days int default 28)
returns table (host text, page text, query text, impressions bigint, clicks bigint, "position" real)
language sql stable
as $$
  select split_part(regexp_replace(page, '^https?://(www\.)?', ''), '/', 1), page, query,
         sum(impressions)::bigint, sum(clicks)::bigint,
         (sum(impressions * position) / nullif(sum(impressions), 0))::real
  from gsc_search_data
  where date >= current_date - p_days
  group by 1, 2, 3
  having sum(impressions) >= 100 and (sum(impressions * position) / nullif(sum(impressions), 0)) between 4 and 15
  order by 4 desc
  limit 300
$$;
revoke all on function gsc_quick_wins(int) from public, anon, authenticated;
grant execute on function gsc_quick_wins(int) to service_role;

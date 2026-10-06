-- Impressions Search Console des fiches produit des sites expirés, par marque
-- × pays (encart « EMD à lancer » de /rankings). Marque = slug de la page ;
-- seules les requêtes qui contiennent la marque comptent (« lulutox danger »
-- sur /lulutox/), ce qui écarte l'accueil, le blog et les requêtes locales.
create or replace function emd_brand_impressions(p_days int default 28)
returns table (host text, slug text, country text, impressions bigint, clicks bigint, top_query text)
language sql stable
as $$
  with s as (
    select split_part(regexp_replace(page, '^https?://(www\.)?', ''), '/', 1) as host,
           (regexp_match(rtrim(regexp_replace(page, '^https?://(www\.)?', ''), '/'), '/([^/]+)$'))[1] as slug,
           query, country, impressions, clicks
    from gsc_search_data
    where date >= current_date - p_days
  ), k as (
    select *, regexp_replace(lower(case when length(split_part(slug, '-', 1)) >= 5 then split_part(slug, '-', 1) else slug end), '[^a-z0-9]', '', 'g') as bkey
    from s where slug is not null
  )
  select host, slug, country, sum(impressions)::bigint, sum(clicks)::bigint,
         (array_agg(query order by impressions desc))[1]
  from k
  where length(bkey) >= 4
    and regexp_replace(lower(query), '[^a-z0-9]', '', 'g') like '%' || bkey || '%'
  group by 1, 2, 3
  having sum(impressions) >= 50
  order by 4 desc
  limit 1000
$$;

revoke all on function emd_brand_impressions(int) from public, anon, authenticated;
grant execute on function emd_brand_impressions(int) to service_role;

-- Le filtre « 28 derniers jours » parcourait tout l index (propriété, date) : 9 s.
create index if not exists idx_gsc_data_date on gsc_search_data (date);

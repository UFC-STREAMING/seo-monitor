-- Dernière position relevée de chaque mot-clé (page /tracking).
create or replace function latest_keyword_positions(p_keyword_ids uuid[])
returns table (keyword_id uuid, "position" integer, checked_at timestamptz)
language sql stable
as $$
  select distinct on (kp.keyword_id) kp.keyword_id, kp.position, kp.checked_at
  from keyword_positions kp
  where kp.keyword_id = any(p_keyword_ids)
  order by kp.keyword_id, kp.checked_at desc
$$;
revoke all on function latest_keyword_positions(uuid[]) from public, anon, authenticated;
grant execute on function latest_keyword_positions(uuid[]) to service_role;

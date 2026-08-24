create extension if not exists pgcrypto;

create table if not exists public.chess_rooms (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  game_state jsonb,
  history jsonb not null default '[]'::jsonb,
  revision integer not null default 0,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);

create table if not exists public.chess_room_members (
  room_id uuid not null references public.chess_rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  side text not null check (side in ('red', 'black')),
  display_name text not null default '棋友',
  joined_at timestamptz not null default now(),
  primary key (room_id, user_id),
  unique (room_id, side)
);

alter table public.chess_rooms enable row level security;
alter table public.chess_room_members enable row level security;

revoke all on public.chess_rooms from anon, authenticated;
revoke all on public.chess_room_members from anon, authenticated;
grant select on public.chess_rooms to authenticated;
grant select on public.chess_room_members to authenticated;

drop policy if exists "authenticated users can read rooms" on public.chess_rooms;
drop policy if exists "authenticated users can read room members" on public.chess_room_members;

create policy "authenticated users can read rooms"
on public.chess_rooms
for select
to authenticated
using (true);

create policy "authenticated users can read room members"
on public.chess_room_members
for select
to authenticated
using (true);

create or replace function public.clean_chess_room_slug(raw_slug text)
returns text
language sql
immutable
as $$
  select coalesce(
    nullif(substring(regexp_replace(trim(coalesce(raw_slug, 'home')), '[^a-zA-Z0-9_-]', '', 'g') from 1 for 32), ''),
    'home'
  );
$$;

create or replace function public.join_chess_room(requested_room_slug text, player_name text)
returns table (
  room_id uuid,
  room_slug text,
  side text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_slug text := public.clean_chess_room_slug(requested_room_slug);
  v_room_id uuid;
  v_side text;
  v_name text := coalesce(nullif(substring(trim(coalesce(player_name, '棋友')) from 1 for 16), ''), '棋友');
begin
  if v_user_id is null then
    raise exception 'not_authenticated';
  end if;

  insert into public.chess_rooms (slug)
  values (v_slug)
  on conflict (slug) do nothing;

  select r.id
  into v_room_id
  from public.chess_rooms r
  where r.slug = v_slug
  for update;

  select m.side
  into v_side
  from public.chess_room_members m
  where m.room_id = v_room_id
    and m.user_id = v_user_id;

  if v_side is null then
    if not exists (
      select 1 from public.chess_room_members m
      where m.room_id = v_room_id
        and m.side = 'red'
    ) then
      v_side := 'red';
    elsif not exists (
      select 1 from public.chess_room_members m
      where m.room_id = v_room_id
        and m.side = 'black'
    ) then
      v_side := 'black';
    else
      raise exception 'room_full';
    end if;

    insert into public.chess_room_members (room_id, user_id, side, display_name)
    values (v_room_id, v_user_id, v_side, v_name);
  else
    update public.chess_room_members m
    set display_name = v_name
    where m.room_id = v_room_id
      and m.user_id = v_user_id;
  end if;

  return query select v_room_id, v_slug, v_side;
end;
$$;

create or replace function public.update_chess_room_state(
  target_room_id uuid,
  expected_revision integer,
  new_game_state jsonb,
  new_history jsonb
)
returns table (
  id uuid,
  slug text,
  game_state jsonb,
  history jsonb,
  revision integer,
  updated_at timestamptz,
  updated_by uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_current_revision integer;
begin
  if v_user_id is null then
    raise exception 'not_authenticated';
  end if;

  if not exists (
    select 1 from public.chess_room_members m
    where m.room_id = target_room_id
      and m.user_id = v_user_id
  ) then
    raise exception 'not_room_member';
  end if;

  select r.revision
  into v_current_revision
  from public.chess_rooms r
  where r.id = target_room_id
  for update;

  if v_current_revision is null then
    raise exception 'room_not_found';
  end if;

  if v_current_revision <> expected_revision then
    raise exception 'revision_conflict';
  end if;

  return query
    update public.chess_rooms r
    set
      game_state = new_game_state,
      history = coalesce(new_history, '[]'::jsonb),
      revision = r.revision + 1,
      updated_at = now(),
      updated_by = v_user_id
    where r.id = target_room_id
    returning r.id, r.slug, r.game_state, r.history, r.revision, r.updated_at, r.updated_by;
end;
$$;

create or replace function public.leave_chess_room(target_room_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'not_authenticated';
  end if;

  delete from public.chess_room_members m
  where m.room_id = target_room_id
    and m.user_id = v_user_id;
end;
$$;

grant execute on function public.join_chess_room(text, text) to authenticated;
grant execute on function public.update_chess_room_state(uuid, integer, jsonb, jsonb) to authenticated;
grant execute on function public.leave_chess_room(uuid) to authenticated;

do $$
begin
  begin
    alter publication supabase_realtime add table public.chess_rooms;
  exception
    when duplicate_object then null;
    when undefined_object then null;
  end;

  begin
    alter publication supabase_realtime add table public.chess_room_members;
  exception
    when duplicate_object then null;
    when undefined_object then null;
  end;
end $$;

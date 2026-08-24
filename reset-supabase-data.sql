-- 在 Supabase SQL Editor 里运行这段 SQL，可清空所有房间、棋局记录和已注册用户。
-- 运行后，所有人都需要用新的“登录名 + 密码”重新注册。

begin;

delete from public.chess_room_members;
delete from public.chess_rooms;

do $$
begin
  if to_regclass('auth.refresh_tokens') is not null then
    execute 'delete from auth.refresh_tokens';
  end if;

  if to_regclass('auth.sessions') is not null then
    execute 'delete from auth.sessions';
  end if;

  if to_regclass('auth.mfa_factors') is not null then
    execute 'delete from auth.mfa_factors';
  end if;

  if to_regclass('auth.identities') is not null then
    execute 'delete from auth.identities';
  end if;
end $$;

delete from auth.users;

commit;

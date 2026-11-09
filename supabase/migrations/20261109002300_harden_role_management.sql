-- Role management hardening for the admin "Staff & roles" page.
--  * Only a super administrator can grant or revoke admin / super_admin.
--  * passenger and driver are not managed here (they come from sign-up and driver onboarding).
--  * The last super administrator can never be removed.
--  * The target account must exist; staff roles cannot be granted to a suspended account.

create or replace function public.admin_set_role(p_user_id uuid, p_role public.app_role, p_grant boolean)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_target public.profiles;
begin
  perform public.require_permission('roles.manage');
  if p_role in ('passenger', 'driver') then
    raise exception 'passenger and driver roles come from sign-up and driver onboarding' using errcode = '22023';
  end if;
  if p_role in ('admin', 'super_admin') and not public.has_role('super_admin') then
    raise exception 'only a super administrator can change administrator roles' using errcode = '42501';
  end if;

  select * into v_target from public.profiles where id = p_user_id;
  if not found then raise exception 'user not found' using errcode = 'P0002'; end if;

  if p_grant then
    if v_target.is_suspended then
      raise exception 'reinstate the account before granting a role' using errcode = '22023';
    end if;
    insert into public.user_roles(user_id, role, granted_by) values (p_user_id, p_role, (select auth.uid()))
    on conflict do nothing;
  else
    if p_user_id = (select auth.uid()) and p_role in ('admin', 'super_admin') then
      raise exception 'cannot remove your own administrator role' using errcode = '22023';
    end if;
    if p_role = 'super_admin' then
      -- Serialise concurrent revocations so two super admins cannot remove each other at once.
      perform 1 from public.user_roles where role = 'super_admin' for update;
      if (select count(*) from public.user_roles where role = 'super_admin' and user_id <> p_user_id) = 0 then
        raise exception 'cannot remove the last super administrator' using errcode = '22023';
      end if;
    end if;
    delete from public.user_roles where user_id = p_user_id and role = p_role;
  end if;
  perform public.write_audit(case when p_grant then 'role.grant' else 'role.revoke' end, 'user_roles', p_user_id::text,
    null, jsonb_build_object('role', p_role));
end;
$$;

revoke execute on function public.admin_set_role(uuid, public.app_role, boolean) from public, anon;
grant execute on function public.admin_set_role(uuid, public.app_role, boolean) to authenticated;

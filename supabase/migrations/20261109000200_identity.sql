-- =====================================================================
-- LiberiaRide · 0002 · Identity, roles, drivers, vehicles, fleets
-- =====================================================================

-- ---------------------------------------------------------------------
-- RBAC
-- ---------------------------------------------------------------------
create table public.roles (
  code        public.app_role primary key,
  name        text not null,
  description text,
  created_at  timestamptz not null default now()
);

create table public.permissions (
  code        text primary key check (code ~ '^[a-z_]+\.[a-z_]+$'),
  description text not null,
  created_at  timestamptz not null default now()
);

create table public.role_permissions (
  role       public.app_role not null references public.roles(code) on delete cascade,
  permission text not null references public.permissions(code) on delete cascade,
  primary key (role, permission)
);

create table public.user_roles (
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       public.app_role not null references public.roles(code),
  granted_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (user_id, role)
);
create index user_roles_role_idx on public.user_roles(role);

-- ---------------------------------------------------------------------
-- Profiles (1:1 with auth.users)
-- ---------------------------------------------------------------------
create table public.profiles (
  id                uuid primary key references auth.users(id) on delete cascade,
  full_name         text check (char_length(full_name) between 1 and 120),
  phone             text unique check (phone ~ '^\+[1-9][0-9]{6,14}$'),
  email             text check (email is null or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  avatar_path       text,
  locale            text not null default 'en-LR',
  preferred_currency public.currency_code not null default 'USD',
  is_suspended      boolean not null default false,
  suspended_reason  text,
  suspended_at      timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

create table public.passengers (
  id                     uuid primary key references public.profiles(id) on delete cascade,
  default_payment_method public.payment_method not null default 'cash',
  rating_avg             numeric(3,2) check (rating_avg between 1 and 5),
  rating_count           integer not null default 0 check (rating_count >= 0),
  completed_trips        integer not null default 0 check (completed_trips >= 0),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create trigger passengers_updated_at before update on public.passengers
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- Fleets
-- ---------------------------------------------------------------------
create table public.fleets (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 2 and 120),
  owner_id    uuid not null references public.profiles(id) on delete restrict,
  phone       text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index fleets_owner_idx on public.fleets(owner_id);
create trigger fleets_updated_at before update on public.fleets
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- Vehicle categories
-- ---------------------------------------------------------------------
create table public.vehicle_categories (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique check (code ~ '^[a-z_]+$'),
  name        text not null,
  description text,
  seats       smallint not null check (seats between 1 and 20),
  icon        text,
  sort_order  smallint not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger vehicle_categories_updated_at before update on public.vehicle_categories
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- Drivers
-- ---------------------------------------------------------------------
create table public.drivers (
  id                 uuid primary key references public.profiles(id) on delete cascade,
  status             public.driver_status not null default 'pending',
  licence_number     text not null check (char_length(licence_number) between 3 and 40),
  licence_expiry     date,
  date_of_birth      date,
  address_text       text,
  fleet_id           uuid references public.fleets(id) on delete set null,
  current_vehicle_id uuid,                       -- FK added after vehicles exists
  is_online          boolean not null default false,
  went_online_at     timestamptz,
  rating_avg         numeric(3,2) check (rating_avg between 1 and 5),
  rating_count       integer not null default 0 check (rating_count >= 0),
  completed_trips    integer not null default 0 check (completed_trips >= 0),
  acceptance_offers  integer not null default 0,
  acceptance_accepts integer not null default 0,
  reviewed_by        uuid references public.profiles(id) on delete set null,
  reviewed_at        timestamptz,
  review_note        text,
  suspended_reason   text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint drivers_online_requires_approval check (not is_online or status = 'approved')
);
create unique index drivers_licence_number_uq on public.drivers(upper(licence_number));
create index drivers_status_idx on public.drivers(status);
create index drivers_online_idx on public.drivers(is_online) where is_online;
create index drivers_fleet_idx on public.drivers(fleet_id);
create trigger drivers_updated_at before update on public.drivers
  for each row execute function public.set_updated_at();

create table public.fleet_drivers (
  fleet_id   uuid not null references public.fleets(id) on delete cascade,
  driver_id  uuid not null references public.drivers(id) on delete cascade,
  joined_at  timestamptz not null default now(),
  left_at    timestamptz,
  primary key (fleet_id, driver_id)
);
create index fleet_drivers_driver_idx on public.fleet_drivers(driver_id);

-- ---------------------------------------------------------------------
-- Vehicles
-- ---------------------------------------------------------------------
create table public.vehicles (
  id                  uuid primary key default gen_random_uuid(),
  driver_id           uuid references public.drivers(id) on delete set null,
  fleet_id            uuid references public.fleets(id) on delete set null,
  category_id         uuid not null references public.vehicle_categories(id),
  make                text not null check (char_length(make) between 1 and 60),
  model               text not null check (char_length(model) between 1 and 60),
  year                smallint check (year between 1980 and 2100),
  color               text not null check (char_length(color) between 2 and 30),
  plate_number        text not null check (char_length(plate_number) between 2 and 20),
  registration_number text,
  status              public.review_status not null default 'pending',
  reviewed_by         uuid references public.profiles(id) on delete set null,
  reviewed_at         timestamptz,
  review_note         text,
  is_active           boolean not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint vehicles_owner_present check (driver_id is not null or fleet_id is not null)
);
create unique index vehicles_plate_uq on public.vehicles(upper(regexp_replace(plate_number, '\s', '', 'g')));
create index vehicles_driver_idx on public.vehicles(driver_id);
create index vehicles_fleet_idx on public.vehicles(fleet_id);
create index vehicles_category_idx on public.vehicles(category_id);
create trigger vehicles_updated_at before update on public.vehicles
  for each row execute function public.set_updated_at();

alter table public.drivers
  add constraint drivers_current_vehicle_fk
  foreign key (current_vehicle_id) references public.vehicles(id) on delete set null;

-- ---------------------------------------------------------------------
-- Driver documents (files live in the private `driver-documents` bucket)
-- ---------------------------------------------------------------------
create table public.driver_documents (
  id           uuid primary key default gen_random_uuid(),
  driver_id    uuid not null references public.drivers(id) on delete cascade,
  vehicle_id   uuid references public.vehicles(id) on delete cascade,
  doc_type     public.document_type not null,
  storage_path text not null unique,
  mime_type    text check (mime_type in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
  document_number text,
  expires_at   date,
  status       public.review_status not null default 'pending',
  reviewed_by  uuid references public.profiles(id) on delete set null,
  reviewed_at  timestamptz,
  review_note  text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  -- storage paths are always namespaced by the owning driver: "<driver_id>/..."
  constraint driver_documents_path_owner check (storage_path like driver_id::text || '/%')
);
create index driver_documents_driver_idx on public.driver_documents(driver_id);
create index driver_documents_pending_idx on public.driver_documents(status) where status = 'pending';
create trigger driver_documents_updated_at before update on public.driver_documents
  for each row execute function public.set_updated_at();

-- =====================================================================
-- Authorization helper functions (used by RLS policies & RPCs)
-- STABLE + SECURITY DEFINER so policies can read user_roles without
-- recursive RLS evaluation. `(select auth.uid())` keeps them initPlan-cached.
-- =====================================================================
create or replace function public.has_role(p_role public.app_role)
returns boolean
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
  select exists (
    select 1 from public.user_roles ur
    where ur.user_id = (select auth.uid()) and ur.role = p_role
  );
$$;

create or replace function public.has_any_role(p_roles public.app_role[])
returns boolean
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
  select exists (
    select 1 from public.user_roles ur
    where ur.user_id = (select auth.uid()) and ur.role = any (p_roles)
  );
$$;

create or replace function public.has_permission(p_permission text)
returns boolean
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
  select exists (
    select 1
    from public.user_roles ur
    join public.role_permissions rp on rp.role = ur.role
    join public.profiles p on p.id = ur.user_id
    where ur.user_id = (select auth.uid())
      and rp.permission = p_permission
      and not p.is_suspended
  );
$$;

-- Staff = anyone who can see operational data (support and above).
create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
  select public.has_any_role(array['support_agent','admin','super_admin']::public.app_role[]);
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
  select public.has_any_role(array['admin','super_admin']::public.app_role[]);
$$;

-- Raise unless the caller holds the permission. Used at the top of admin RPCs.
create or replace function public.require_permission(p_permission text)
returns void
language plpgsql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  if not public.has_permission(p_permission) then
    raise exception 'permission denied: %', p_permission using errcode = '42501';
  end if;
end;
$$;

-- Raise unless the caller is an authenticated, non-suspended user. Returns uid.
create or replace function public.require_active_user()
returns uuid
language plpgsql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  if exists (select 1 from public.profiles where id = v_uid and is_suspended) then
    raise exception 'account suspended' using errcode = '42501';
  end if;
  return v_uid;
end;
$$;

-- Fleet operator owns the fleet the driver belongs to.
create or replace function public.is_fleet_operator_of_driver(p_driver_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
  select exists (
    select 1 from public.drivers d
    join public.fleets f on f.id = d.fleet_id
    where d.id = p_driver_id and f.owner_id = (select auth.uid())
  );
$$;

-- ---------------------------------------------------------------------
-- New auth user -> profile + passenger + passenger role.
-- Phone comes from Supabase phone auth (E.164 without '+', normalised here).
-- ---------------------------------------------------------------------
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_phone text := nullif(new.phone, '');
begin
  if v_phone is not null and left(v_phone, 1) <> '+' then
    v_phone := '+' || v_phone;
  end if;

  insert into public.profiles (id, phone, email, full_name)
  values (
    new.id,
    v_phone,
    nullif(new.email, ''),
    nullif(left(coalesce(new.raw_user_meta_data ->> 'full_name', ''), 120), '')
  )
  on conflict (id) do nothing;

  insert into public.passengers (id) values (new.id) on conflict do nothing;
  insert into public.user_roles (user_id, role) values (new.id, 'passenger') on conflict do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- Keep profile phone in sync when the user verifies a new number.
create or replace function public.handle_auth_user_phone_change()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
begin
  if new.phone is distinct from old.phone then
    update public.profiles
       set phone = case when nullif(new.phone, '') is null then null
                        when left(new.phone, 1) = '+' then new.phone
                        else '+' || new.phone end
     where id = new.id;
  end if;
  return new;
end;
$$;

create trigger on_auth_user_phone_changed
  after update of phone on auth.users
  for each row execute function public.handle_auth_user_phone_change();

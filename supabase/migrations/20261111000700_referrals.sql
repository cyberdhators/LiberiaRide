-- =====================================================================
-- LiberiaRide · 0035 · Referrals
--
-- Every passenger has a referral code. A new passenger (no completed trip yet)
-- can enter a friend's code once. When they complete their FIRST trip, both
-- get a one-ride coupon (referral.reward_bps off, from the "Referral reward"
-- promotion), delivered as a notification with the code. The referrer earns at
-- most referral.max_rewards_per_month rewards (the new rider always gets theirs).
-- The reward trigger can never block a trip completion: errors become warnings.
-- =====================================================================

insert into public.configuration_settings(key, value, description, is_public) values
  ('referral.reward_bps',              '2000', 'Referral reward: discount on one ride, in basis points (2000 = 20%)', true),
  ('referral.max_rewards_per_month',     '20',   'Most referral rewards one passenger can earn in 30 days', false)
on conflict (key) do nothing;

-- The promotion behind every referral coupon (percent off one ride, no cap).
do $$
declare
  v_id uuid;
begin
  select id into v_id from public.promotions where name = 'Referral reward';
  if v_id is null then
    insert into public.promotions(name, description, discount_type, discount_value, per_user_limit, is_active)
    values ('Referral reward', 'One ride discount for referrer and referred passenger', 'percent',
            public.config_int('referral.reward_bps'), 1, true)
    returning id into v_id;
  end if;
  insert into public.configuration_settings(key, value, description, is_public)
  values ('referral.promotion_id', to_jsonb(v_id::text), 'Promotion used for referral coupons', false)
  on conflict (key) do nothing;
end $$;

-- Codes: 6 characters without look-alikes (no 0/O, 1/I/L).
create or replace function public._new_short_code(p_len integer default 6)
returns text
language sql
volatile
set search_path = public, extensions, pg_temp
as $$
  select string_agg(substr('ABCDEFGHJKMNPQRSTUVWXYZ23456789', (get_byte(b.bytes, i) % 31) + 1, 1), '' order by i)
    from (select extensions.gen_random_bytes(p_len) as bytes) b, generate_series(0, p_len - 1) i;
$$;

alter table public.passengers add column referral_code text unique check (referral_code ~ '^[A-Z2-9]{6}$');
alter table public.passengers add column referred_by uuid references public.passengers(id) on delete set null
  check (referred_by is distinct from id);
alter table public.passengers add column referred_at timestamptz;

create or replace function public.tg_passenger_referral_code()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v text;
begin
  if new.referral_code is null then
    loop
      v := public._new_short_code(6);
      exit when not exists (select 1 from public.passengers where referral_code = v);
    end loop;
    new.referral_code := v;
  end if;
  return new;
end;
$$;
create trigger passengers_referral_code before insert on public.passengers
  for each row execute function public.tg_passenger_referral_code();

-- Backfill existing passengers.
do $$
declare
  r record;
  v text;
begin
  for r in select id from public.passengers where referral_code is null loop
    loop
      v := public._new_short_code(6);
      exit when not exists (select 1 from public.passengers where referral_code = v);
    end loop;
    update public.passengers set referral_code = v where id = r.id;
  end loop;
end $$;
alter table public.passengers alter column referral_code set not null;

create table public.referral_rewards (
  referred_id         uuid primary key references public.passengers(id) on delete cascade,
  referrer_id         uuid not null references public.passengers(id) on delete cascade,
  referred_coupon_id  uuid references public.coupons(id) on delete set null,
  referrer_coupon_id  uuid references public.coupons(id) on delete set null,
  booking_id          uuid references public.bookings(id) on delete set null,
  created_at          timestamptz not null default now()
);
create index referral_rewards_referrer_idx on public.referral_rewards(referrer_id, created_at desc);
alter table public.referral_rewards enable row level security;
grant select on public.referral_rewards to authenticated;
create policy referral_rewards_read on public.referral_rewards for select to authenticated
  using (referred_id = (select auth.uid()) or referrer_id = (select auth.uid()) or public.is_staff());

-- A new passenger enters a friend's code (once, before their first completed trip).
create or replace function public.apply_referral_code(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_uid uuid := public.require_active_user();
  v_me  public.passengers;
  v_ref public.passengers;
begin
  select * into v_me from public.passengers where id = v_uid for update;
  if not found then raise exception 'not a passenger account' using errcode = '42501'; end if;
  if v_me.referred_by is not null then raise exception 'you have already used a referral code' using errcode = '55000'; end if;
  if v_me.completed_trips > 0 or exists (select 1 from public.bookings where passenger_id = v_uid and status = 'COMPLETED') then
    raise exception 'referral codes are for new riders before their first trip' using errcode = '55000';
  end if;
  select * into v_ref from public.passengers where referral_code = upper(btrim(coalesce(p_code, '')));
  if not found then raise exception 'that referral code is not valid' using errcode = '22023'; end if;
  if v_ref.id = v_uid then raise exception 'you cannot use your own code' using errcode = '22023'; end if;
  if exists (select 1 from public.profiles where id = v_ref.id and is_suspended) then
    raise exception 'that referral code is not valid' using errcode = '22023';
  end if;
  update public.passengers set referred_by = v_ref.id, referred_at = now() where id = v_uid;
  return jsonb_build_object('referrer', (select split_part(coalesce(full_name, 'a friend'), ' ', 1) from public.profiles where id = v_ref.id),
                            'reward_bps', public.config_int('referral.reward_bps'));
end;
$$;

-- Passenger's own referral card.
create or replace function public.my_referral()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_uid uuid := public.require_active_user();
  v_me  public.passengers;
begin
  select * into v_me from public.passengers where id = v_uid;
  if not found then return null; end if;
  return jsonb_build_object(
    'code', v_me.referral_code,
    'reward_bps', public.config_int('referral.reward_bps'),
    'referred_by', (select split_part(coalesce(full_name, 'a friend'), ' ', 1) from public.profiles where id = v_me.referred_by),
    'can_apply', v_me.referred_by is null and v_me.completed_trips = 0,
    'friends_rewarded', (select count(*) from public.referral_rewards where referrer_id = v_uid),
    'coupons', (select coalesce(jsonb_agg(jsonb_build_object('code', c.code, 'used', exists (
                    select 1 from public.coupon_redemptions cr where cr.coupon_id = c.id and cr.user_id = v_uid))
                  order by c.created_at desc), '[]'::jsonb)
                  from public.coupons c
                 where c.assigned_user_id = v_uid and c.is_active
                   and c.promotion_id = (public.config_text('referral.promotion_id'))::uuid));
end;
$$;

-- Reward on the referred passenger's first completed trip. Never blocks completion.
create or replace function public.tg_referral_reward()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_p       public.passengers;
  v_promo   uuid;
  v_c1      uuid;
  v_c2      uuid;
  v_recent  integer;
  v_pct     text;
begin
  if new.status <> 'COMPLETED' or old.status = 'COMPLETED' then return null; end if;
  begin
    select * into v_p from public.passengers where id = new.passenger_id;
    if v_p.referred_by is null or v_p.completed_trips <> 1
       or exists (select 1 from public.referral_rewards where referred_id = v_p.id) then
      return null;
    end if;
    v_promo := (public.config_text('referral.promotion_id'))::uuid;
    v_pct := (public.config_int('referral.reward_bps') / 100)::text || '%';

    insert into public.coupons(promotion_id, code, assigned_user_id)
    values (v_promo, 'REF-' || public._new_short_code(6), v_p.id) returning id into v_c1;
    insert into public.notifications(user_id, kind, title, body, data)
    values (v_p.id, 'referral.reward', 'You earned a ride discount',
            'Thanks for riding! Use code ' || (select code from public.coupons where id = v_c1) || ' for ' || v_pct || ' off your next ride.',
            jsonb_build_object('coupon_id', v_c1));

    select count(*) into v_recent from public.referral_rewards
     where referrer_id = v_p.referred_by and referrer_coupon_id is not null and created_at > now() - interval '30 days';
    if v_recent < coalesce(public.config_int('referral.max_rewards_per_month'), 20) then
      insert into public.coupons(promotion_id, code, assigned_user_id)
      values (v_promo, 'REF-' || public._new_short_code(6), v_p.referred_by) returning id into v_c2;
      insert into public.notifications(user_id, kind, title, body, data)
      values (v_p.referred_by, 'referral.reward', 'Your friend took their first ride',
              'Use code ' || (select code from public.coupons where id = v_c2) || ' for ' || v_pct || ' off your next ride.',
              jsonb_build_object('coupon_id', v_c2));
    end if;

    insert into public.referral_rewards(referred_id, referrer_id, referred_coupon_id, referrer_coupon_id, booking_id)
    values (v_p.id, v_p.referred_by, v_c1, v_c2, new.id);
  exception when others then
    raise warning 'referral reward failed for booking %: %', new.id, sqlerrm;
  end;
  return null;
end;
$$;
create trigger bookings_referral_reward after update of status on public.bookings
  for each row execute function public.tg_referral_reward();

revoke execute on function
  public._new_short_code(integer),
  public.tg_passenger_referral_code(),
  public.tg_referral_reward(),
  public.apply_referral_code(text),
  public.my_referral()
  from public, anon, authenticated;
grant execute on function public.apply_referral_code(text), public.my_referral() to authenticated;

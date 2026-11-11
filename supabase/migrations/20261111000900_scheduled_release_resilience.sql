-- =====================================================================
-- LiberiaRide · 0037 · Scheduled release: one failing booking can't block the rest
-- release_scheduled_bookings handled only unique_violation; any other error
-- aborted the whole cron tick, and the same booking (due again 30 s later)
-- would hold up every scheduled ride behind it. Now it is skipped with a warning.
-- =====================================================================

create or replace function public.release_scheduled_bookings()
returns integer
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  r       record;
  v_count integer := 0;
begin
  for r in select id, passenger_id, scheduled_for from public.bookings
            where status = 'SCHEDULED'
              and scheduled_for <= now() + make_interval(secs => public.config_int('scheduling.lead_seconds'))
            order by scheduled_for
            for update skip locked loop
    begin
      update public.bookings
         set confirmed_at = now(),
             search_expires_at = greatest(scheduled_for, now()) + interval '10 minutes'
       where id = r.id;
      perform public._transition_booking(r.id, 'SEARCHING_DRIVER', 'system', '{"reason":"scheduled_release"}');
      insert into public.notifications(user_id, kind, title, body, data)
      values (r.passenger_id, 'booking.scheduled_released', 'Finding your driver',
              'Your scheduled ride at ' || to_char(r.scheduled_for at time zone 'Africa/Monrovia', 'HH24:MI') || ' is now looking for a driver.',
              jsonb_build_object('booking_id', r.id));
      perform public.dispatch_booking(r.id);
      v_count := v_count + 1;
    exception when unique_violation then
      -- The passenger is on another ride (one active ride per passenger). Retry next tick; give up 10 min after pickup time.
      if r.scheduled_for < now() - interval '10 minutes' then
        perform public._transition_booking(r.id, 'EXPIRED', 'system', '{"reason":"passenger_on_another_ride"}');
        insert into public.notifications(user_id, kind, title, body, data)
        values (r.passenger_id, 'booking.expired', 'Scheduled ride not started',
                'Your scheduled ride could not start because you were on another ride.', jsonb_build_object('booking_id', r.id));
      end if;
    when others then
      -- Never let one bad booking block every other scheduled ride behind it.
      raise warning 'scheduled release failed for %: %', r.id, sqlerrm;
    end;
  end loop;
  return v_count;
end;
$$;

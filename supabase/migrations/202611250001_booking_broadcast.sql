begin;

create or replace function private.broadcast_booking_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- The staff screen has no login. Publish only a refresh signal.
  perform realtime.send('{}'::jsonb, 'bookings-changed', 'booking-updates', false);
  return null;
end;
$$;

revoke all on function private.broadcast_booking_change() from public;

drop trigger if exists broadcast_booking_change on public.bookings;
create trigger broadcast_booking_change
after insert or update or delete on public.bookings
for each statement execute function private.broadcast_booking_change();

commit;

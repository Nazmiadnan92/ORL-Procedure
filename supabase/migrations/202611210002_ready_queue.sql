alter table public.bookings
  add column if not exists ready_at timestamptz;

update public.bookings
set ready_at = coalesce(updated_at, booked_at)
where status = 'READY' and ready_at is null;

create or replace function public.update_booking(
  p_booking_id uuid, p_expected_revision integer,
  p_procedure_ids uuid[] default null, p_notes text default null, p_status text default null
) returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_booking public.bookings%rowtype;
  v_procedures uuid[];
begin
  if not public.is_admin() then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  select * into v_booking from public.bookings where id = p_booking_id and deleted_at is null for update;
  if not found then raise exception 'Booking not found' using errcode = 'P0002'; end if;
  if p_expected_revision is distinct from v_booking.revision then
    raise exception 'Booking changed. Refresh and try again' using errcode = '40001';
  end if;
  if p_procedure_ids is not null then
    if cardinality(p_procedure_ids) not between 1 and 100 or array_position(p_procedure_ids,null) is not null then
      raise exception 'Select at least one procedure' using errcode = '22023';
    end if;
    select array_agg(distinct x order by x) into v_procedures from unnest(p_procedure_ids) x;
    perform 1 from public.procedures where id = any(v_procedures) for share;
    if exists (
      select 1 from unnest(v_procedures) x
      left join public.procedures p on p.id = x
      where p.id is null or (not p.active and not exists (
        select 1 from public.booking_procedures bp where bp.booking_id = p_booking_id and bp.procedure_id = x
      ))
    ) then raise exception 'Procedure selection is invalid' using errcode = '22023'; end if;
    delete from public.booking_procedures where booking_id = p_booking_id and not (procedure_id = any(v_procedures));
    insert into public.booking_procedures(booking_id, procedure_id)
    select p_booking_id, unnest(v_procedures) on conflict do nothing;
  end if;
  update public.bookings
  set notes = coalesce(p_notes, notes),
      status = coalesce(p_status, status),
      ready_at = case
        when coalesce(p_status, status) = 'READY' and status <> 'READY' then clock_timestamp()
        when coalesce(p_status, status) <> 'READY' then null
        else ready_at
      end,
      updated_at = clock_timestamp(),
      revision = revision + 1
  where id = p_booking_id returning revision into p_expected_revision;
  return p_expected_revision;
end;
$$;

grant select (ready_at) on public.bookings to anon, authenticated;

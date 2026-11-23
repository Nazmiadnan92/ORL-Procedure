-- Default Admin Booking Management to a selected Malaysia calendar date.
begin;

drop function if exists public.admin_booking_page(integer,integer,text,text,text);
drop function if exists public.admin_booking_page(integer,integer,text,text,text,date);

create function public.admin_booking_page(
  p_page integer default 1,
  p_page_size integer default 100,
  p_query text default '',
  p_source text default 'All',
  p_status text default 'All',
  p_date date default null
) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_page integer := greatest(coalesce(p_page, 1), 1);
  v_page_size integer := least(greatest(coalesce(p_page_size, 100), 1), 100);
  v_query text := lower(btrim(coalesce(p_query, '')));
  v_start timestamptz;
  v_end timestamptz;
  v_result jsonb;
begin
  if not public.is_admin() then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  if coalesce(p_source, 'All') not in ('All', 'Clinic', 'Ward')
    or coalesce(p_status, 'All') not in ('All', 'NEW', 'READY', 'DONE', 'CANCEL') then
    raise exception 'Invalid Admin filter' using errcode = '22023';
  end if;

  if p_date is not null then
    v_start := p_date::timestamp at time zone 'Asia/Kuala_Lumpur';
    v_end := v_start + interval '1 day';
  end if;

  with filtered as materialized (
    select b.*
    from public.bookings b
    where b.deleted_at is null
      and (p_date is null or (b.booked_at >= v_start and b.booked_at < v_end))
      and (coalesce(p_source, 'All') = 'All' or b.patient_source = p_source)
      and (coalesce(p_status, 'All') = 'All' or b.status = p_status)
      and (
        v_query = ''
        or position(v_query in lower(b.doctor)) > 0
        or position(v_query in lower(b.patient_name)) > 0
        or position(v_query in lower(b.subspecialty)) > 0
        or position(v_query in lower(b.patient_source)) > 0
        or position(v_query in lower(b.notes)) > 0
        or position(v_query in lower(coalesce(b.legacy_remark, ''))) > 0
        or position(v_query in lower(b.status)) > 0
        or exists (
          select 1 from unnest(b.affected_regions) region
          where position(v_query in lower(region)) > 0
        )
        or exists (
          select 1
          from public.booking_procedures bp
          join public.procedures procedure on procedure.id = bp.procedure_id
          where bp.booking_id = b.id and position(v_query in lower(procedure.name)) > 0
        )
      )
  ),
  page_rows as (
    select * from filtered
    order by booked_at desc, id desc
    offset (v_page - 1) * v_page_size
    limit v_page_size
  ),
  summary as (
    select
      count(*)::bigint as total,
      count(*) filter (where status = 'NEW')::bigint as new_count,
      count(*) filter (where status = 'READY')::bigint as ready_count,
      count(*) filter (where status = 'DONE')::bigint as done_count,
      count(*) filter (where status = 'CANCEL')::bigint as cancel_count
    from public.bookings
    where deleted_at is null
      and (p_date is null or (booked_at >= v_start and booked_at < v_end))
  )
  select jsonb_build_object(
    'records', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', booking.id,
          'booked_at', booking.booked_at,
          'doctor', booking.doctor,
          'patient_name', booking.patient_name,
          'subspecialty', booking.subspecialty,
          'affected_regions', booking.affected_regions,
          'patient_source', booking.patient_source,
          'notes', booking.notes,
          'remark', coalesce(booking.legacy_remark, ''),
          'status', booking.status,
          'updated_at', booking.updated_at,
          'revision', booking.revision,
          'booking_procedures', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'procedure_id', procedure.id,
                'procedures', jsonb_build_object(
                  'name', procedure.name,
                  'uses_bed', procedure.uses_bed,
                  'active', procedure.active
                )
              ) order by procedure.name
            )
            from public.booking_procedures bp
            join public.procedures procedure on procedure.id = bp.procedure_id
            where bp.booking_id = booking.id
          ), '[]'::jsonb)
        ) order by booking.booked_at desc, booking.id desc
      ) from page_rows booking
    ), '[]'::jsonb),
    'filtered_count', (select count(*) from filtered),
    'summary', (select to_jsonb(summary) from summary)
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.admin_booking_page(integer,integer,text,text,text,date)
from public, anon, authenticated;
grant execute on function public.admin_booking_page(integer,integer,text,text,text,date)
to authenticated;

notify pgrst, 'reload schema';
commit;

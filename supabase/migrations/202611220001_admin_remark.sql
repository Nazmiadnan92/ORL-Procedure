-- Restore the historical Remark field as an Admin-only editable field.
begin;

create or replace function public.admin_booking_page(
  p_page integer default 1,
  p_page_size integer default 100,
  p_query text default '',
  p_source text default 'All',
  p_status text default 'All'
) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_page integer := greatest(coalesce(p_page, 1), 1);
  v_page_size integer := least(greatest(coalesce(p_page_size, 100), 1), 100);
  v_query text := lower(btrim(coalesce(p_query, '')));
  v_result jsonb;
begin
  if not public.is_admin() then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  if coalesce(p_source, 'All') not in ('All', 'Clinic', 'Ward')
    or coalesce(p_status, 'All') not in ('All', 'NEW', 'READY', 'DONE', 'CANCEL') then
    raise exception 'Invalid Admin filter' using errcode = '22023';
  end if;

  with filtered as materialized (
    select b.*
    from public.bookings b
    where b.deleted_at is null
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
    select *
    from filtered
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
      )
      from page_rows booking
    ), '[]'::jsonb),
    'filtered_count', (select count(*) from filtered),
    'summary', (select to_jsonb(summary) from summary)
  ) into v_result;

  return v_result;
end;
$$;

drop function if exists public.update_booking(uuid,integer,uuid[],text,text);
drop function if exists public.update_booking(uuid,integer,uuid[],text,text,text);

create function public.update_booking(
  p_booking_id uuid,
  p_expected_revision integer,
  p_procedure_ids uuid[] default null,
  p_notes text default null,
  p_remark text default null,
  p_status text default null
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
  if (p_notes is not null and length(p_notes) > 4000)
    or (p_remark is not null and length(p_remark) > 4000) then
    raise exception 'Notes and Remark must not exceed 4000 characters' using errcode = '22023';
  end if;

  select * into v_booking
  from public.bookings
  where id = p_booking_id and deleted_at is null
  for update;
  if not found then raise exception 'Booking not found' using errcode = 'P0002'; end if;
  if p_expected_revision is distinct from v_booking.revision then
    raise exception 'Booking changed. Refresh and try again' using errcode = '40001';
  end if;

  if p_procedure_ids is not null then
    if cardinality(p_procedure_ids) not between 1 and 100
      or array_position(p_procedure_ids, null) is not null then
      raise exception 'Select at least one procedure' using errcode = '22023';
    end if;
    select array_agg(distinct x order by x) into v_procedures
    from unnest(p_procedure_ids) x;
    perform 1 from public.procedures where id = any(v_procedures) for share;
    if exists (
      select 1
      from unnest(v_procedures) x
      left join public.procedures p on p.id = x
      where p.id is null or (not p.active and not exists (
        select 1 from public.booking_procedures bp
        where bp.booking_id = p_booking_id and bp.procedure_id = x
      ))
    ) then
      raise exception 'Procedure selection is invalid' using errcode = '22023';
    end if;
    delete from public.booking_procedures
    where booking_id = p_booking_id and not (procedure_id = any(v_procedures));
    insert into public.booking_procedures(booking_id, procedure_id)
    select p_booking_id, unnest(v_procedures)
    on conflict do nothing;
  end if;

  update public.bookings
  set notes = coalesce(p_notes, notes),
      legacy_remark = coalesce(p_remark, legacy_remark),
      status = coalesce(p_status, status),
      ready_at = case
        when coalesce(p_status, status) = 'READY' and status <> 'READY' then clock_timestamp()
        when coalesce(p_status, status) <> 'READY' then null
        else ready_at
      end,
      updated_at = clock_timestamp(),
      revision = revision + 1
  where id = p_booking_id
  returning revision into p_expected_revision;

  return p_expected_revision;
end;
$$;

revoke all on function public.update_booking(uuid,integer,uuid[],text,text,text)
from public, anon, authenticated;
grant execute on function public.update_booking(uuid,integer,uuid[],text,text,text)
to authenticated;

notify pgrst, 'reload schema';
commit;

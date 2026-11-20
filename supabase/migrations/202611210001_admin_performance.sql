-- Phase 7: paginated Admin list and server-side monthly statistics.
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

create or replace function public.admin_monthly_statistics(
  p_year integer,
  p_month integer
) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_start timestamptz;
  v_end timestamptz;
  v_result jsonb;
begin
  if not public.is_admin() then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  if p_year not between 2000 and 2100 or p_month not between 1 and 12 then
    raise exception 'Invalid statistics period' using errcode = '22023';
  end if;

  v_start := make_timestamptz(p_year, p_month, 1, 0, 0, 0, 'Asia/Kuala_Lumpur');
  v_end := v_start + interval '1 month';

  with base as materialized (
    select b.id, b.subspecialty, b.patient_source
    from public.bookings b
    where b.deleted_at is null and b.booked_at >= v_start and b.booked_at < v_end
  ),
  subspecialty_names(name, sort_order) as (
    values
      ('Gen ORL'::text, 1),
      ('Otology'::text, 2),
      ('Rhinology'::text, 3),
      ('Head & Neck'::text, 4),
      ('Paeds ORL'::text, 5)
  ),
  subspecialties as (
    select
      names.name,
      count(base.id) filter (where base.patient_source = 'Clinic')::bigint as clinic,
      count(base.id) filter (where base.patient_source = 'Ward')::bigint as ward,
      count(base.id)::bigint as total,
      names.sort_order
    from subspecialty_names names
    left join base on base.subspecialty = names.name
    group by names.name, names.sort_order
  ),
  procedures as (
    select
      procedure.name,
      count(distinct base.id) filter (where base.patient_source = 'Clinic')::bigint as clinic,
      count(distinct base.id) filter (where base.patient_source = 'Ward')::bigint as ward,
      count(distinct base.id)::bigint as total
    from base
    join public.booking_procedures bp on bp.booking_id = base.id
    join public.procedures procedure on procedure.id = bp.procedure_id
    group by procedure.id, procedure.name
  )
  select jsonb_build_object(
    'total', (select count(*) from base),
    'clinic', (select count(*) from base where patient_source = 'Clinic'),
    'ward', (select count(*) from base where patient_source = 'Ward'),
    'subspecialties', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', name, 'clinic', clinic, 'ward', ward, 'total', total
      ) order by sort_order) from subspecialties
    ), '[]'::jsonb),
    'procedures', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', name, 'clinic', clinic, 'ward', ward, 'total', total
      ) order by total desc, name) from procedures
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

create or replace function public.admin_statistics_years()
returns integer[]
language plpgsql stable security definer set search_path = ''
as $$
declare v_years integer[];
begin
  if not public.is_admin() then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  select array_agg(year order by year desc) into v_years
  from (
    select distinct extract(year from booked_at at time zone 'Asia/Kuala_Lumpur')::integer as year
    from public.bookings where deleted_at is null
    union
    select extract(year from now() at time zone 'Asia/Kuala_Lumpur')::integer
  ) available_years;
  return v_years;
end;
$$;

revoke all on function public.admin_booking_page(integer,integer,text,text,text),
  public.admin_monthly_statistics(integer,integer), public.admin_statistics_years()
from public, anon, authenticated;
grant execute on function public.admin_booking_page(integer,integer,text,text,text),
  public.admin_monthly_statistics(integer,integer), public.admin_statistics_years()
to authenticated;

notify pgrst, 'reload schema';
commit;

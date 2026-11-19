-- Target project: wpssewipanzmsygmhior (ORL Booking Procedure).
-- Phase 1. Run once, as postgres, on this new project.
begin;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table public.admins (
  email text primary key check (email = lower(email)),
  user_id uuid unique references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.procedures (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (length(btrim(name)) between 1 and 120),
  active boolean not null default true,
  uses_bed boolean not null default false,
  display_order integer not null default 0
);

create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  booked_at timestamptz not null default now(),
  doctor text not null check (length(btrim(doctor)) between 1 and 120),
  patient_name text not null check (length(btrim(patient_name)) between 1 and 160),
  subspecialty text not null check (subspecialty in ('Gen ORL','Otology','Rhinology','Head & Neck','Paeds ORL')),
  affected_regions text[] not null check (
    cardinality(affected_regions) between 1 and 4
    and array_position(affected_regions, null) is null
    and affected_regions <@ array['Ear','Nose','Neck','Throat']::text[]
  ),
  patient_source text not null check (patient_source in ('Clinic','Ward')),
  notes text not null default '' check (length(notes) <= 4000),
  status text not null default 'NEW' check (status in ('NEW','READY','DONE','CANCEL')),
  updated_at timestamptz not null default now(),
  revision integer not null default 1 check (revision > 0),
  deleted_at timestamptz,
  legacy_remark text,
  legacy_source_key text unique,
  submission_hash text
);

create table public.booking_procedures (
  booking_id uuid not null references public.bookings(id),
  procedure_id uuid not null references public.procedures(id),
  primary key (booking_id, procedure_id)
);

create index bookings_live_date on public.bookings(booked_at desc) where deleted_at is null;
create index booking_procedures_procedure on public.booking_procedures(procedure_id, booking_id);

alter table public.admins enable row level security;
alter table public.procedures enable row level security;
alter table public.bookings enable row level security;
alter table public.booking_procedures enable row level security;

create function public.is_admin() returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.admins a join auth.users u on u.id = a.user_id
    where a.user_id = auth.uid() and lower(u.email) = a.email
      and u.email_confirmed_at is not null and u.deleted_at is null
  );
$$;

create function public.malaysia_today_start() returns timestamptz
language sql stable set search_path = ''
as $$ select date_trunc('day', now() at time zone 'Asia/Kuala_Lumpur') at time zone 'Asia/Kuala_Lumpur'; $$;

-- Only a confirmed Auth identity with the pre-approved email is bound to Admin.
create function private.bind_admin_identity() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.email_confirmed_at is not null and new.deleted_at is null then
    update public.admins set user_id = new.id
    where email = lower(new.email) and (user_id is null or user_id = new.id);
  end if;
  return new;
end;
$$;

create trigger bind_orl_admin after insert or update of email, email_confirmed_at
on auth.users for each row execute function private.bind_admin_identity();

insert into public.admins(email) values ('orlprosedur@gmail.com');

create policy admins_self_read on public.admins for select to authenticated using (user_id = auth.uid());
create policy procedures_read on public.procedures for select to anon, authenticated
using (active or (select public.is_admin()));
create policy bookings_read on public.bookings for select to anon, authenticated
using (deleted_at is null and (
  (select public.is_admin()) or (
    booked_at >= (select public.malaysia_today_start())
    and booked_at < (select public.malaysia_today_start()) + interval '1 day'
  )
));
create policy booking_procedures_read on public.booking_procedures for select to anon, authenticated
using (exists (select 1 from public.bookings b where b.id = booking_id));

-- All changes go through narrow transactional functions. Direct writes are denied.
revoke all on public.admins, public.procedures, public.bookings, public.booking_procedures from anon, authenticated;
grant select on public.admins to authenticated;
grant select on public.procedures, public.booking_procedures to anon, authenticated;
grant select (id, booked_at, doctor, patient_name, subspecialty, affected_regions,
  patient_source, notes, status, updated_at, revision) on public.bookings to anon, authenticated;

create function public.procedure_catalog()
returns table(id uuid, name text, uses_bed boolean, usage_count bigint, display_order integer)
language sql stable security definer set search_path = ''
as $$
  select p.id, p.name, p.uses_bed, count(b.id), p.display_order
  from public.procedures p
  left join public.booking_procedures bp on bp.procedure_id = p.id
  left join public.bookings b on b.id = bp.booking_id and b.deleted_at is null
  where p.active
  group by p.id
  order by count(b.id) desc, p.name;
$$;

create function public.create_booking(
  p_request_id uuid, p_doctor text, p_patient_name text, p_subspecialty text,
  p_procedure_ids uuid[], p_affected_regions text[], p_patient_source text,
  p_notes text default ''
) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_procedures uuid[];
  v_regions text[];
  v_hash text;
  v_existing public.bookings%rowtype;
begin
  if p_request_id is null or p_procedure_ids is null or p_affected_regions is null
    or p_doctor is null or p_patient_name is null or p_subspecialty is null or p_patient_source is null
    or cardinality(p_procedure_ids) not between 1 and 100
    or cardinality(p_affected_regions) not between 1 and 4
    or array_position(p_procedure_ids, null) is not null
    or array_position(p_affected_regions, null) is not null then
    raise exception 'Complete all required booking fields' using errcode = '22023';
  end if;
  select array_agg(distinct x order by x) into v_procedures from unnest(p_procedure_ids) x;
  select array_agg(distinct x order by x) into v_regions from unnest(p_affected_regions) x;
  v_hash := md5(jsonb_build_array(btrim(p_doctor), btrim(p_patient_name), p_subspecialty,
    v_procedures, v_regions, p_patient_source, coalesce(p_notes,''))::text);

  -- Reusing the same request ID makes a double-click/network retry idempotent.
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text, 0));
  select * into v_existing from public.bookings where id = p_request_id;
  if found then
    if v_existing.submission_hash is distinct from v_hash or v_existing.deleted_at is not null then
      raise exception 'Request ID already used' using errcode = '23505';
    end if;
    return v_existing.id;
  end if;
  perform 1 from public.procedures where id = any(v_procedures) and active for share;
  if (select count(*) from public.procedures where id = any(v_procedures) and active)
    <> cardinality(v_procedures) then
    raise exception 'Select active procedures from the list' using errcode = '22023';
  end if;
  insert into public.bookings(id, doctor, patient_name, subspecialty, affected_regions,
    patient_source, notes, submission_hash)
  values (p_request_id, btrim(p_doctor), btrim(p_patient_name), p_subspecialty,
    v_regions, p_patient_source, coalesce(p_notes,''), v_hash);
  insert into public.booking_procedures(booking_id, procedure_id)
  select p_request_id, unnest(v_procedures);
  return p_request_id;
end;
$$;

create function public.update_booking(
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
    -- An inactive historical option may be retained, but not newly assigned.
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
  update public.bookings set notes = coalesce(p_notes,notes), status = coalesce(p_status,status),
    updated_at = clock_timestamp(), revision = revision + 1
  where id = p_booking_id returning revision into p_expected_revision;
  return p_expected_revision;
end;
$$;

-- Deletion is recoverable. Deleted bookings disappear from lists and statistics.
create function public.delete_booking(p_booking_id uuid, p_expected_revision integer) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_revision integer;
begin
  if not public.is_admin() then raise exception 'Admin access required' using errcode = '42501'; end if;
  select revision into v_revision from public.bookings where id = p_booking_id and deleted_at is null for update;
  if not found then raise exception 'Booking not found' using errcode = 'P0002'; end if;
  if p_expected_revision is distinct from v_revision then
    raise exception 'Booking changed. Refresh and try again' using errcode = '40001';
  end if;
  update public.bookings set deleted_at = clock_timestamp(), updated_at = clock_timestamp(), revision = revision + 1
  where id = p_booking_id;
end;
$$;

-- Revoke the PostgreSQL default EXECUTE grant explicitly, including from API roles.
revoke all on function private.bind_admin_identity() from public, anon, authenticated;
revoke all on function public.is_admin(), public.malaysia_today_start(), public.procedure_catalog(),
  public.create_booking(uuid,text,text,text,uuid[],text[],text,text),
  public.update_booking(uuid,integer,uuid[],text,text), public.delete_booking(uuid,integer)
from public, anon, authenticated;
grant execute on function public.is_admin(), public.malaysia_today_start(), public.procedure_catalog(),
  public.create_booking(uuid,text,text,text,uuid[],text[],text,text) to anon, authenticated;
grant execute on function public.update_booking(uuid,integer,uuid[],text,text), public.delete_booking(uuid,integer) to authenticated;

insert into public.procedures(name,uses_bed,display_order)
select name, name in ('EUM','Dix Hall Pike + BPLS'), ordinality::integer
from unnest(array[
  'GSH/GXM','0°','0° Paeds','Flex','Flex Paeds','30°','70°','90°','Dix Hall Pike + BPLS','EUM','Rigid OTO',
  'Dressing Ear','Dressing Nose','Dressing Neck','I & D Ear','I & D Nose','I & D Neck','STO',
  'IT Dexa Preparation','Change Tracheostomy','TCA Apply','Biopsy','Myringotomy','Myringoplasty','FNAC',
  'Excision','Inj. Kenacort','RT Insertion','Inj. Laryngoplasty','Ear Toiletting','Aural Packing','Ear Syringing',
  'Grommet Insertion/Removal','Button Stitching','Nasal Packing','Nasal Douching','Nasolacrimal Duct Syringing',
  'AWO','FEES','Triacutaneous Laryngeal Injection','Tongue Tie Release','Blood Taking','IV Line','T&S',
  'FB Ear','FB Nose','FB Throat','Aspirate/Suction','I & D Throat'
]::text[]) with ordinality as catalog(name,ordinality);

-- Postgres Changes uses the same SELECT privileges and RLS as the application.
alter publication supabase_realtime add table public.bookings, public.booking_procedures;
notify pgrst, 'reload schema';
commit;

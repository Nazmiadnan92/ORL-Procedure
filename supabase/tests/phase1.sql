-- Integration checks for the new ORL Procedure database.
-- All fictional bookings and identities are rolled back.
begin;
select set_config('orl.test.procedures', (select array_agg(id)::text from public.procedures where name in ('EUM','Blood Taking')), true);

do $$
begin
  assert (select count(*) from public.procedures) = 49, 'Expected 49 procedures';
  assert (select count(*) from public.procedures where uses_bed) = 2, 'Bed flags';
  assert (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind='r' and c.relrowsecurity) = 4, 'RLS on all four tables';
  assert (public.malaysia_today_start() at time zone 'Asia/Kuala_Lumpur')::time = '00:00'::time, 'Malaysia midnight';
end $$;

set local role anon;
do $$
declare v_id uuid; v_ids uuid[] := current_setting('orl.test.procedures')::uuid[];
begin
  assert not public.is_admin(), 'Anonymous is not admin';
  assert (select count(*) from public.procedure_catalog())=49, 'Public catalog';
  v_id := public.create_booking('00000000-0000-4000-a000-000000000101', 'Dr. TEST', 'REKAAN PHASE1',
    'Gen ORL', v_ids, array['Ear','Throat'], 'Ward', 'Temporary integration test');
  assert v_id='00000000-0000-4000-a000-000000000101'::uuid, 'Create booking';
  perform public.create_booking(v_id, 'Dr. TEST', 'REKAAN PHASE1', 'Gen ORL',
    v_ids, array['Throat','Ear'], 'Ward', 'Temporary integration test');
  assert (select count(*) from public.bookings where id=v_id)=1, 'Retry creates only one row';
  assert (select status from public.bookings where id=v_id)='NEW', 'Default status';
  assert (select count(*) from public.booking_procedures where booking_id=v_id)=2, 'Two procedure selections';
  begin
    perform public.create_booking(v_id,'Dr. OTHER','REKAAN PHASE1','Gen ORL',v_ids,array['Ear'],'Ward','');
    raise exception 'Changed request replay accepted';
  exception when unique_violation then null; end;
  begin
    perform public.create_booking('00000000-0000-4000-a000-000000000102','Dr. TEST','REKAAN INVALID',
      'Gen ORL',v_ids,array['NIL'],'Clinic','');
    raise exception 'Invalid affected region accepted';
  exception when check_violation then null; end;
  begin
    perform public.create_booking('00000000-0000-4000-a000-000000000102','Dr. TEST','REKAAN INVALID',
      'Gen ORL',array[]::uuid[],array['Ear'],'Clinic','');
    raise exception 'Empty procedure accepted';
  exception when invalid_parameter_value then null; end;
  begin
    update public.bookings set status='DONE' where id=v_id;
    raise exception 'Anonymous direct update accepted';
  exception when insufficient_privilege then null; end;
  begin
    perform public.update_booking(v_id,1,null,null,'DONE');
    raise exception 'Anonymous admin RPC accepted';
  exception when insufficient_privilege then null; end;
  begin
    perform public.delete_booking(v_id,1);
    raise exception 'Anonymous delete accepted';
  exception when insufficient_privilege then null; end;
  begin
    perform legacy_remark from public.bookings where id=v_id;
    raise exception 'Anonymous archive column exposed';
  exception when insufficient_privilege then null; end;
  assert not exists (select 1 from public.bookings where id='00000000-0000-4000-a000-000000000102'), 'Invalid submit fully rolled back';
end $$;
reset role;

insert into public.bookings(id,booked_at,doctor,patient_name,subspecialty,affected_regions,patient_source)
values
 ('00000000-0000-4000-a000-000000000103', public.malaysia_today_start()-interval '1 second','Dr. TEST','REKAAN YESTERDAY','Otology',array['Ear'],'Clinic'),
 ('00000000-0000-4000-a000-000000000104', public.malaysia_today_start(),'Dr. TEST','REKAAN MIDNIGHT','Otology',array['Ear'],'Clinic'),
 ('00000000-0000-4000-a000-000000000105', public.malaysia_today_start()+interval '1 day','Dr. TEST','REKAAN TOMORROW','Otology',array['Ear'],'Clinic');

set local role anon;
do $$ begin
  assert not exists(select 1 from public.bookings where id in ('00000000-0000-4000-a000-000000000103','00000000-0000-4000-a000-000000000105')), 'Guest cannot read outside today';
  assert exists(select 1 from public.bookings where id='00000000-0000-4000-a000-000000000104'), 'Midnight booking visible';
end $$;
reset role;

-- Confirming the whitelisted identity binds only that user as Admin.
insert into auth.users(id,email,aud,role,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)
values ('00000000-0000-4000-a000-000000000201','orlprosedur@gmail.com','authenticated','authenticated',now(),'{}','{}');
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-a000-000000000202","role":"authenticated"}',true);
set local role authenticated;
do $$ begin
  assert not public.is_admin(), 'Other signed-in identities are not Admin';
  begin
    perform public.update_booking('00000000-0000-4000-a000-000000000101',1,null,null,'DONE');
    raise exception 'Non-admin edit accepted';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-a000-000000000201","role":"authenticated"}',true);
set local role authenticated;
do $$
declare v_id uuid := '00000000-0000-4000-a000-000000000101'; v_revision integer;
begin
  assert public.is_admin(), 'Whitelisted Admin recognized';
  assert exists(select 1 from public.bookings where id='00000000-0000-4000-a000-000000000103'), 'Admin can read historical records';
  v_revision := public.update_booking(v_id,1,array[(select id from public.procedures where name='EUM')],'Admin test note','READY');
  assert v_revision=2, 'Revision increments';
  assert (select notes='Admin test note' and status='READY' and doctor='Dr. TEST' and patient_name='REKAAN PHASE1' from public.bookings where id=v_id), 'Only editable fields changed';
  assert (select count(*) from public.booking_procedures where booking_id=v_id)=1, 'Procedure edit';
  begin
    perform public.update_booking(v_id,1,null,null,'DONE');
    raise exception 'Stale edit accepted';
  exception when serialization_failure then null; end;
  begin
    perform public.update_booking(v_id,2,array[(select id from public.procedures where name='Blood Taking')],null,'INVALID');
    raise exception 'Invalid status accepted';
  exception when check_violation then null; end;
  assert exists(select 1 from public.booking_procedures where booking_id=v_id and procedure_id=(select id from public.procedures where name='EUM')), 'Failed multi-field edit rolls back procedures';
  begin
    update public.bookings set doctor='ALTERED' where id=v_id;
    raise exception 'Direct original-field edit accepted';
  exception when insufficient_privilege then null; end;
  perform public.delete_booking(v_id,2);
  assert not exists(select 1 from public.bookings where id=v_id), 'Deleted booking hidden';
end $$;
reset role;

do $$ begin
  assert exists(select 1 from public.bookings where id='00000000-0000-4000-a000-000000000101' and deleted_at is not null), 'Deleted record remains recoverable';
  assert (select count(*) from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename in ('bookings','booking_procedures'))=2, 'Realtime enabled';
end $$;
rollback;
select 'PASS: catalog, atomic submit, retry, validation, guest/admin access, Malaysia date, restricted edit, revision conflict, recoverable delete and Realtime' as phase1_checks;

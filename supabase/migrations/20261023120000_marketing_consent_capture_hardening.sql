-- Signup consent capture must never block account creation, and a new
-- disclosure version is a row in a lookup table instead of a constraint edit.

create table public.marketing_disclosure_versions (
 version text primary key,
 published_at timestamptz not null default clock_timestamp()
);
alter table public.marketing_disclosure_versions enable row level security;
revoke all on public.marketing_disclosure_versions from anon,authenticated;
grant select on public.marketing_disclosure_versions to anon,authenticated;
create policy disclosure_versions_read on public.marketing_disclosure_versions for select to anon,authenticated using(true);
insert into public.marketing_disclosure_versions(version) values('2026-10-01');

alter table public.marketing_consent_events
 drop constraint marketing_consent_events_disclosure_version_check,
 add constraint marketing_consent_events_disclosure_version_fkey
  foreign key(disclosure_version) references public.marketing_disclosure_versions(version);

-- Consents the signup trigger could not record as submitted, kept for follow-up
-- instead of being dropped silently. Deleted with the user.
create table private.marketing_consent_capture_failures (
 id bigint generated always as identity primary key,
 user_id uuid references auth.users(id) on delete cascade,
 app text not null,
 reason text not null,
 consent jsonb,
 recorded_at timestamptz not null default clock_timestamp()
);
revoke all on private.marketing_consent_capture_failures from public,anon,authenticated;

create or replace function private.capture_signup_marketing_consent() returns trigger language plpgsql security definer set search_path='' as $$
declare
 c jsonb:=new.raw_user_meta_data->'marketing_consent';
 sms boolean;
 phone text;
 reason text;
begin
 if c->>'app' is distinct from 'pulse' or c->>'source' is distinct from 'signup' then
  return new;
 end if;
 begin
  if not exists(select 1 from public.marketing_disclosure_versions v where v.version=c->>'disclosure_version') then
   reason:='unknown_disclosure_version';
  else
   sms:=c->'sms_opt_in'='true'::jsonb;
   -- Same normalization as normalizeMarketingPhone() in the NEXUS client.
   phone:=regexp_replace(coalesce(c->>'phone',''),'[\s().-]','','g');
   if phone ~ '^\d{10}$' then phone:='+1'||phone;
   elsif phone ~ '^1\d{10}$' then phone:='+'||phone;
   end if;
   if sms and phone !~ '^\+[1-9][0-9]{7,14}$' then
    -- Keep the email choice; never record SMS consent for a number that cannot be texted.
    reason:='invalid_sms_phone';
    sms:=false;
   end if;
   insert into public.marketing_consent_events(user_id,app,email,email_opt_in,sms_opt_in,phone,source,disclosure_version)
   values(new.id,'pulse',new.email,c->'email_opt_in'='true'::jsonb,sms,case when sms then phone end,'signup',c->>'disclosure_version');
  end if;
 exception when others then
  reason:='insert_failed: '||sqlerrm;
 end;
 if reason is not null then
  begin
   insert into private.marketing_consent_capture_failures(user_id,app,reason,consent) values(new.id,'pulse',reason,c);
  exception when others then
   raise warning 'marketing consent capture for user % could not be logged: %',new.id,sqlerrm;
  end;
 end if;
 return new;
end $$;
revoke all on function private.capture_signup_marketing_consent() from public,anon,authenticated;

-- Customers update their own profile row directly (src/services/auth.ts edits
-- first_name, last_name, phone, email and updated_at). Owner-only RLS decides
-- which row; this trigger decides which columns. Membership, account status,
-- customer number and identity links change only through server code (service
-- role or database roles) or a CORE owner/admin session.
create or replace function private.guard_profile_protected_columns() returns trigger language plpgsql set search_path='' as $$
begin
 if current_user not in ('authenticated','anon') then return new; end if;
 if lower(coalesce(auth.jwt()->'app_metadata'->>'role','')) in ('owner','admin') then return new; end if;
 if new.id is distinct from old.id
  or new.auth_user_id is distinct from old.auth_user_id
  or new.customer_number is distinct from old.customer_number
  or new.membership_id is distinct from old.membership_id
  or new.account_status is distinct from old.account_status then
  raise exception 'Membership, account status, customer number and account links cannot be changed from the app'
   using errcode='42501';
 end if;
 return new;
end $$;
revoke all on function private.guard_profile_protected_columns() from public,anon,authenticated;
create trigger guard_profile_protected_columns
 before update of id,auth_user_id,customer_number,membership_id,account_status on public.profiles
 for each row execute function private.guard_profile_protected_columns();

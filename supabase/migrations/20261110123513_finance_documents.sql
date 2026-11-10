-- A versioned private document keeps imports, restores and budget changes atomic.
-- Clients never write this table directly: the RPC owns revision increments.
create table public.finance_documents (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null,
  revision integer not null check (revision > 0),
  updated_at timestamptz not null default now()
);
alter table public.finance_documents enable row level security;
create policy "Read own finance document" on public.finance_documents
  for select to authenticated using ((select auth.uid()) = user_id);
revoke all on public.finance_documents from anon, authenticated;
grant select on public.finance_documents to authenticated;

create table public.finance_mutation_receipts (
  user_id uuid not null references auth.users(id) on delete cascade,
  mutation_id uuid not null,
  revision integer not null,
  payload_hash text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, mutation_id)
);
alter table public.finance_mutation_receipts enable row level security;
-- Receipts are private RPC implementation data, with no direct client grants.
revoke all on public.finance_mutation_receipts from anon, authenticated;

create or replace function public.validate_finance_document(document jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare
  month jsonb;
  entity jsonb;
  category jsonb;
  item jsonb;
  txn jsonb;
  ids text[] := '{}';
  months text[] := '{}';
  account_ids text[];
  source_keys text[] := '{}';
  category_months jsonb := '{}';
  month_key text;
begin
  if document is null or octet_length(document::text) > 10485760 then return false; end if;
  if not extensions.jsonb_matches_schema(public.finance_document_schema(), document) then return false; end if;
  if not exists (select 1 from jsonb_array_elements(document->'budgetMonths') m
    where m->>'id' = document#>>'{settings,activeBudgetMonthId}') then return false; end if;
  for month in select * from jsonb_array_elements(document->'budgetMonths') loop
    month_key := (month->>'year') || '-' || lpad(month->>'month', 2, '0');
    if month_key = any(months) then return false; end if;
    months := array_append(months, month_key);
    if month->>'id' = any(ids) then return false; end if;
    ids := array_append(ids, month->>'id');
    account_ids := '{}';
    for entity in select * from jsonb_array_elements((month->'incomes') || (month->'accounts')) loop
      if entity->>'id' = any(ids) or btrim(entity->>'name') = '' then return false; end if;
      ids := array_append(ids, entity->>'id');
    end loop;
    select coalesce(array_agg(a->>'id'), '{}') into account_ids
      from jsonb_array_elements(month->'accounts') a;
    for category in select * from jsonb_array_elements(month->'expenseCategories') loop
      if category->>'id' = any(ids) or btrim(category->>'name') = '' then return false; end if;
      ids := array_append(ids, category->>'id');
      category_months := category_months || jsonb_build_object(category->>'id', month_key);
      if category->>'accountId' is not null and not (category->>'accountId' = any(account_ids)) then return false; end if;
      for item in select * from jsonb_array_elements(category->'items') loop
        if item->>'id' = any(ids) or btrim(item->>'name') = '' then return false; end if;
        ids := array_append(ids, item->>'id');
      end loop;
    end loop;
    if btrim(month->>'name') = '' then return false; end if;
  end loop;
  for txn in select * from jsonb_array_elements(document->'importedTransactions') loop
    if txn->>'id' = any(ids) or txn->>'sourceKey' = any(source_keys)
      or (txn->>'amountCents')::numeric = 0 or btrim(txn->>'description') = '' then return false; end if;
    ids := array_append(ids, txn->>'id');
    source_keys := array_append(source_keys, txn->>'sourceKey');
    if txn->>'categoryId' is not null and
      (category_months->>(txn->>'categoryId')) is distinct from left(txn->>'bookingDate', 7) then return false; end if;
  end loop;
  return true;
exception when others then return false;
end;
$$;
revoke all on function public.validate_finance_document(jsonb) from public, anon, authenticated;

create or replace function public.save_finance_document(
  document jsonb, expected_revision integer, mutation_id uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  owner uuid := auth.uid();
  current_revision integer;
  receipt public.finance_mutation_receipts%rowtype;
  digest text := encode(extensions.digest(document::text, 'sha256'), 'hex');
begin
  if owner is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if expected_revision is null or expected_revision < 0 or mutation_id is null then
    raise exception 'Invalid save request' using errcode = '22023';
  end if;
  -- Serialises competing first imports as well as updates for this user only.
  perform pg_advisory_xact_lock(hashtextextended(owner::text, 0));
  select * into receipt from public.finance_mutation_receipts r
    where r.user_id = owner and r.mutation_id = save_finance_document.mutation_id;
  if found then
    if receipt.payload_hash is distinct from digest then
      raise exception 'Mutation ID already used for different data' using errcode = '22023';
    end if;
    return jsonb_build_object('status', 'saved', 'revision', receipt.revision);
  end if;
  select revision into current_revision from public.finance_documents where user_id = owner for update;
  current_revision := coalesce(current_revision, 0);
  if current_revision <> expected_revision then
    return jsonb_build_object('status', 'conflict', 'revision', current_revision);
  end if;
  if not public.validate_finance_document(document) then
    raise exception 'Invalid Finance document' using errcode = '22023';
  end if;
  current_revision := current_revision + 1;
  insert into public.finance_documents(user_id, data, revision) values(owner, document, current_revision)
    on conflict (user_id) do update set data = excluded.data, revision = excluded.revision, updated_at = now();
  insert into public.finance_mutation_receipts(user_id, mutation_id, revision, payload_hash)
    values(owner, mutation_id, current_revision, digest);
  return jsonb_build_object('status', 'saved', 'revision', current_revision);
end;
$$;
revoke all on function public.save_finance_document(jsonb, integer, uuid) from public, anon;
grant execute on function public.save_finance_document(jsonb, integer, uuid) to authenticated;
comment on function public.save_finance_document(jsonb, integer, uuid) is
  'Authenticated, owner-scoped compare-and-swap with durable idempotency receipts. No caller-supplied owner is accepted.';

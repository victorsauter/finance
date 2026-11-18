-- Integration tests for the normalized entity tables.
-- All synthetic users and rows are rolled back at the end.
--
-- Users:  A = aaaaaaaa-0000-4000-8000-0000000000a1, B = bbbbbbbb-0000-4000-8000-0000000000b1.
-- Rows of A use ids starting with a0000000, rows of B use ids starting with b0000000.
begin;
insert into auth.users(id, email) values
 ('aaaaaaaa-0000-4000-8000-0000000000a1', 'finance-entities-a@example.invalid'),
 ('bbbbbbbb-0000-4000-8000-0000000000b1', 'finance-entities-b@example.invalid');

-- Test helpers, created as the superuser and dropped by the rollback. They run with the
-- privileges of the caller, so they see the same grants and policies as a client.

-- Runs a statement and fails unless it raises the given SQLSTATE (and constraint or index
-- name, when one is given).
create function public.test_expect_error(
  statement text, expected_state text, expected_constraint text default null
) returns void language plpgsql as $$
declare
  actual_state text;
  actual_constraint text;
  actual_message text;
begin
  begin
    execute statement;
  exception when others then
    get stacked diagnostics
      actual_state = returned_sqlstate,
      actual_constraint = constraint_name,
      actual_message = message_text;
  end;
  if actual_state is null then
    raise exception 'Expected SQLSTATE % but the statement succeeded: %', expected_state, statement;
  end if;
  if actual_state <> expected_state then
    raise exception 'Expected SQLSTATE % but got % (%) for: %',
      expected_state, actual_state, actual_message, statement;
  end if;
  if expected_constraint is not null and actual_constraint is distinct from expected_constraint then
    raise exception 'Expected constraint % but got % for: %',
      expected_constraint, actual_constraint, statement;
  end if;
end;
$$;

-- Returns a complete imported_transactions row built from valid defaults and overridden
-- by the given jsonb keys (column names).
create function public.test_transaction(overrides jsonb default '{}')
returns public.imported_transactions language sql as $$
  select * from jsonb_populate_record(
    null::public.imported_transactions,
    jsonb_build_object(
      'id', gen_random_uuid(),
      'owner_id', auth.uid(),
      'created_at', now(),
      'updated_at', now(),
      'provider', 'revolut-csv',
      'source_key', gen_random_uuid()::text,
      'import_batch_id', 'a0000000-0000-4000-8000-0000000000f1',
      'source_file_name', 'statement.csv',
      'booking_date', '2026-11-05',
      'description', 'Synthetic payment',
      'amount_cents', -1250,
      'fee_cents', 0,
      'currency', 'EUR',
      'kind', 'expense',
      'imported_at', now()
    ) || overrides
  );
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-4000-8000-0000000000a1', true);

-- ---------------------------------------------------------------------------
-- Owner A: insert, default owner, select, update on every table
-- ---------------------------------------------------------------------------
do $test$
declare
  expected uuid := 'aaaaaaaa-0000-4000-8000-0000000000a1';
  wrong_owner integer;
begin
  -- No owner_id given anywhere: the default must be auth.uid().
  insert into public.budget_months(id, year, month, name, edited_at)
    values ('a0000000-0000-4000-8000-000000000001', 2026, 11, 'November 2026', '2026-11-10T00:00:00Z'),
           ('a0000000-0000-4000-8000-000000000002', 2026, 12, 'December 2026', '2026-12-10T00:00:00Z');
  insert into public.budget_incomes(id, month_id, name, amount_cents, sort_order)
    values ('a0000000-0000-4000-8000-000000000011', 'a0000000-0000-4000-8000-000000000001', 'Salary', 250000, 0);
  insert into public.budget_accounts(id, month_id, name, planned_transfer_cents, sort_order)
    values ('a0000000-0000-4000-8000-000000000021', 'a0000000-0000-4000-8000-000000000001', 'Joint account', 90000, 0),
           ('a0000000-0000-4000-8000-000000000022', 'a0000000-0000-4000-8000-000000000002', 'Joint account', 90000, 0);
  insert into public.budget_expense_categories(id, month_id, account_id, name, sort_order)
    values ('a0000000-0000-4000-8000-000000000031', 'a0000000-0000-4000-8000-000000000001',
            'a0000000-0000-4000-8000-000000000021', 'Housing', 0),
           ('a0000000-0000-4000-8000-000000000032', 'a0000000-0000-4000-8000-000000000002', null, 'Food', 0);
  insert into public.budget_expense_items(id, category_id, name, amount_cents, sort_order)
    values ('a0000000-0000-4000-8000-000000000041', 'a0000000-0000-4000-8000-000000000031', 'Rent', 80000, 0);
  insert into public.imported_transactions
    select * from public.test_transaction(jsonb_build_object(
      'id', 'a0000000-0000-4000-8000-000000000051',
      'source_key', 'a-source-key-1',
      'category_id', 'a0000000-0000-4000-8000-000000000031'));
  insert into public.user_settings(id, active_budget_month_id)
    values (expected, 'a0000000-0000-4000-8000-000000000001');

  select count(*) into wrong_owner from (
    select owner_id from public.budget_months
    union all select owner_id from public.budget_incomes
    union all select owner_id from public.budget_accounts
    union all select owner_id from public.budget_expense_categories
    union all select owner_id from public.budget_expense_items
    union all select owner_id from public.imported_transactions
    union all select owner_id from public.user_settings
  ) all_rows where owner_id is distinct from expected;
  if wrong_owner <> 0 then raise exception 'owner_id did not default to auth.uid()'; end if;

  if (select count(*) from public.budget_months) <> 2 then raise exception 'Owner cannot read months'; end if;
  if (select count(*) from public.budget_incomes) <> 1 then raise exception 'Owner cannot read incomes'; end if;
  if (select count(*) from public.budget_accounts) <> 2 then raise exception 'Owner cannot read accounts'; end if;
  if (select count(*) from public.budget_expense_categories) <> 2 then raise exception 'Owner cannot read categories'; end if;
  if (select count(*) from public.budget_expense_items) <> 1 then raise exception 'Owner cannot read items'; end if;
  if (select count(*) from public.imported_transactions) <> 1 then raise exception 'Owner cannot read transactions'; end if;
  if (select count(*) from public.user_settings) <> 1 then raise exception 'Owner cannot read settings'; end if;

  update public.budget_months set name = 'Nov 2026', edited_at = '2026-11-11T00:00:00Z'
    where id = 'a0000000-0000-4000-8000-000000000001';
  update public.budget_incomes set name = 'Net salary', amount_cents = 260000, sort_order = 1
    where id = 'a0000000-0000-4000-8000-000000000011';
  update public.budget_accounts set name = 'Shared account', planned_transfer_cents = 95000
    where id = 'a0000000-0000-4000-8000-000000000021';
  update public.budget_expense_categories set name = 'Home', account_id = null
    where id = 'a0000000-0000-4000-8000-000000000031';
  update public.budget_expense_items set name = 'Monthly rent', amount_cents = 81000
    where id = 'a0000000-0000-4000-8000-000000000041';
  update public.imported_transactions set description = 'Edited payment', amount_cents = -1300
    where id = 'a0000000-0000-4000-8000-000000000051';
  update public.user_settings set active_budget_month_id = 'a0000000-0000-4000-8000-000000000002'
    where id = expected;

  if (select name from public.budget_months where id = 'a0000000-0000-4000-8000-000000000001') <> 'Nov 2026'
    then raise exception 'Month update lost'; end if;
  if (select amount_cents from public.budget_incomes) <> 260000 then raise exception 'Income update lost'; end if;
  if (select planned_transfer_cents from public.budget_accounts where id = 'a0000000-0000-4000-8000-000000000021') <> 95000
    then raise exception 'Account update lost'; end if;
  if (select name from public.budget_expense_categories where id = 'a0000000-0000-4000-8000-000000000031') <> 'Home'
    then raise exception 'Category update lost'; end if;
  if (select amount_cents from public.budget_expense_items) <> 81000 then raise exception 'Item update lost'; end if;
  if (select amount_cents from public.imported_transactions) <> -1300 then raise exception 'Transaction update lost'; end if;
  if (select active_budget_month_id from public.user_settings) <> 'a0000000-0000-4000-8000-000000000002'
    then raise exception 'Settings update lost'; end if;
  -- Put the category back on its account for the later tests.
  update public.budget_expense_categories set account_id = 'a0000000-0000-4000-8000-000000000021'
    where id = 'a0000000-0000-4000-8000-000000000031';
end $test$;

-- ---------------------------------------------------------------------------
-- Timestamps: updated_at is server-owned, created_at is kept on insert
-- ---------------------------------------------------------------------------
do $test$
declare
  moved timestamptz;
begin
  -- A client-supplied updated_at on insert is overwritten; created_at is kept.
  insert into public.budget_months(id, year, month, name, edited_at, created_at, updated_at)
    values ('a0000000-0000-4000-8000-000000000003', 2027, 1, 'January 2027', '2027-01-10T00:00:00Z',
            '2020-05-05T10:00:00Z', '2000-01-01T00:00:00Z');
  if (select updated_at from public.budget_months where id = 'a0000000-0000-4000-8000-000000000003') <> now()
    then raise exception 'Client-supplied updated_at survived the insert'; end if;
  if (select created_at from public.budget_months where id = 'a0000000-0000-4000-8000-000000000003')
       <> '2020-05-05T10:00:00Z'
    then raise exception 'Client-supplied created_at was not kept'; end if;

  insert into public.imported_transactions
    select * from public.test_transaction(jsonb_build_object(
      'id', 'a0000000-0000-4000-8000-000000000052',
      'source_key', 'a-source-key-2',
      'created_at', '2020-05-05T10:00:00Z',
      'updated_at', '2000-01-01T00:00:00Z'));
  if (select updated_at from public.imported_transactions where id = 'a0000000-0000-4000-8000-000000000052') <> now()
    then raise exception 'Client-supplied updated_at survived the transaction insert'; end if;
  if (select created_at from public.imported_transactions where id = 'a0000000-0000-4000-8000-000000000052')
       <> '2020-05-05T10:00:00Z'
    then raise exception 'Client-supplied created_at was not kept on the transaction'; end if;
end $test$;

-- Age a row as the superuser (trigger off), then check that a client update moves it.
reset role;
alter table public.budget_incomes disable trigger set_updated_at;
update public.budget_incomes set updated_at = '2000-01-01T00:00:00Z'
  where id = 'a0000000-0000-4000-8000-000000000011';
alter table public.budget_incomes enable trigger set_updated_at;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-4000-8000-0000000000a1', true);
do $test$
begin
  if (select updated_at from public.budget_incomes where id = 'a0000000-0000-4000-8000-000000000011')
       <> '2000-01-01T00:00:00Z'
    then raise exception 'Test setup failed to age the row'; end if;
  update public.budget_incomes set amount_cents = 270000 where id = 'a0000000-0000-4000-8000-000000000011';
  if (select updated_at from public.budget_incomes where id = 'a0000000-0000-4000-8000-000000000011') <> now()
    then raise exception 'An update did not move updated_at'; end if;
end $test$;

-- ---------------------------------------------------------------------------
-- Column privileges and deletes
-- ---------------------------------------------------------------------------
do $test$
declare
  protected text;
  table_name text;
  tables text[] := array['budget_months', 'budget_incomes', 'budget_accounts',
    'budget_expense_categories', 'budget_expense_items', 'imported_transactions', 'user_settings'];
begin
  -- id, owner_id, created_at and updated_at cannot be updated on any table.
  foreach table_name in array tables loop
    foreach protected in array array['id', 'owner_id', 'created_at', 'updated_at'] loop
      if has_column_privilege('authenticated', 'public.' || table_name, protected, 'update') then
        raise exception '% is updatable on %', protected, table_name;
      end if;
    end loop;
    -- Hard delete is not granted, even with a predicate that matches nothing.
    perform public.test_expect_error(format('delete from public.%I where false', table_name), '42501');
  end loop;

  perform public.test_expect_error(
    $q$update public.budget_months set id = 'a0000000-0000-4000-8000-0000000000ff'
       where id = 'a0000000-0000-4000-8000-000000000001'$q$, '42501');
  perform public.test_expect_error(
    $q$update public.budget_months set owner_id = 'bbbbbbbb-0000-4000-8000-0000000000b1'
       where id = 'a0000000-0000-4000-8000-000000000001'$q$, '42501');
  perform public.test_expect_error(
    $q$update public.budget_months set created_at = now()
       where id = 'a0000000-0000-4000-8000-000000000001'$q$, '42501');
  perform public.test_expect_error(
    $q$update public.budget_months set updated_at = '2000-01-01'
       where id = 'a0000000-0000-4000-8000-000000000001'$q$, '42501');
  perform public.test_expect_error(
    $q$update public.imported_transactions set owner_id = 'bbbbbbbb-0000-4000-8000-0000000000b1'
       where id = 'a0000000-0000-4000-8000-000000000051'$q$, '42501');
  perform public.test_expect_error(
    $q$update public.user_settings set owner_id = 'bbbbbbbb-0000-4000-8000-0000000000b1'$q$, '42501');
  perform public.test_expect_error(
    $q$update public.user_settings set id = 'a0000000-0000-4000-8000-0000000000ff'$q$, '42501');
  perform public.test_expect_error(
    $q$update public.user_settings set updated_at = '2000-01-01'$q$, '42501');

  -- Inserting on behalf of another owner is rejected by the policy.
  perform public.test_expect_error(
    $q$insert into public.budget_months(id, owner_id, year, month, name, edited_at)
       values ('a0000000-0000-4000-8000-0000000000fe', 'bbbbbbbb-0000-4000-8000-0000000000b1',
               2026, 3, 'Forged', now())$q$, '42501');
  perform public.test_expect_error(
    $q$insert into public.user_settings(id, owner_id)
       values ('bbbbbbbb-0000-4000-8000-0000000000b1', 'bbbbbbbb-0000-4000-8000-0000000000b1')$q$, '42501');
  perform public.test_expect_error(
    $q$insert into public.imported_transactions
       select * from public.test_transaction('{"owner_id": "bbbbbbbb-0000-4000-8000-0000000000b1"}')$q$, '42501');
end $test$;

-- Soft delete works and keeps the row readable (the sync needs to pull tombstones).
do $test$
begin
  update public.budget_expense_items set deleted_at = now() where id = 'a0000000-0000-4000-8000-000000000041';
  if (select deleted_at from public.budget_expense_items where id = 'a0000000-0000-4000-8000-000000000041') is null
    then raise exception 'Soft delete did not set deleted_at'; end if;
  update public.budget_expense_items set deleted_at = null where id = 'a0000000-0000-4000-8000-000000000041';
  if (select deleted_at from public.budget_expense_items where id = 'a0000000-0000-4000-8000-000000000041') is not null
    then raise exception 'Restore did not clear deleted_at'; end if;
end $test$;

-- ---------------------------------------------------------------------------
-- Check constraints
-- ---------------------------------------------------------------------------
do $test$
begin
  -- Months: blank name, bad year, bad month.
  perform public.test_expect_error(
    $q$insert into public.budget_months(id, year, month, name, edited_at)
       values ('a0000000-0000-4000-8000-0000000000e1', 2030, 1, '   ', now())$q$,
    '23514', 'budget_months_name_not_blank');
  perform public.test_expect_error(
    $q$insert into public.budget_months(id, year, month, name, edited_at)
       values ('a0000000-0000-4000-8000-0000000000e1', 1999, 1, 'Too old', now())$q$,
    '23514', 'budget_months_year_range');
  perform public.test_expect_error(
    $q$insert into public.budget_months(id, year, month, name, edited_at)
       values ('a0000000-0000-4000-8000-0000000000e1', 2201, 1, 'Too far', now())$q$,
    '23514', 'budget_months_year_range');
  perform public.test_expect_error(
    $q$insert into public.budget_months(id, year, month, name, edited_at)
       values ('a0000000-0000-4000-8000-0000000000e1', 2030, 0, 'Month zero', now())$q$,
    '23514', 'budget_months_month_range');
  perform public.test_expect_error(
    $q$insert into public.budget_months(id, year, month, name, edited_at)
       values ('a0000000-0000-4000-8000-0000000000e1', 2030, 13, 'Month thirteen', now())$q$,
    '23514', 'budget_months_month_range');
  perform public.test_expect_error(
    $q$update public.budget_months set name = ' ' where id = 'a0000000-0000-4000-8000-000000000001'$q$,
    '23514', 'budget_months_name_not_blank');

  -- Incomes: blank name, negative amount, amount above the cap, bad sort order.
  perform public.test_expect_error(
    $q$insert into public.budget_incomes(id, month_id, name, amount_cents, sort_order)
       values ('a0000000-0000-4000-8000-0000000000e2', 'a0000000-0000-4000-8000-000000000001', '', 1, 0)$q$,
    '23514', 'budget_incomes_name_not_blank');
  perform public.test_expect_error(
    $q$insert into public.budget_incomes(id, month_id, name, amount_cents, sort_order)
       values ('a0000000-0000-4000-8000-0000000000e2', 'a0000000-0000-4000-8000-000000000001', 'Bonus', -1, 0)$q$,
    '23514', 'budget_incomes_amount_range');
  perform public.test_expect_error(
    $q$insert into public.budget_incomes(id, month_id, name, amount_cents, sort_order)
       values ('a0000000-0000-4000-8000-0000000000e2', 'a0000000-0000-4000-8000-000000000001', 'Bonus',
               100000000001, 0)$q$,
    '23514', 'budget_incomes_amount_range');
  perform public.test_expect_error(
    $q$insert into public.budget_incomes(id, month_id, name, amount_cents, sort_order)
       values ('a0000000-0000-4000-8000-0000000000e2', 'a0000000-0000-4000-8000-000000000001', 'Bonus', 1, -1)$q$,
    '23514', 'budget_incomes_sort_order_range');
  -- The cap itself is allowed.
  insert into public.budget_incomes(id, month_id, name, amount_cents, sort_order)
    values ('a0000000-0000-4000-8000-0000000000e3', 'a0000000-0000-4000-8000-000000000001', 'Cap', 100000000000, 2);

  -- Accounts, categories and items.
  perform public.test_expect_error(
    $q$insert into public.budget_accounts(id, month_id, name, planned_transfer_cents, sort_order)
       values ('a0000000-0000-4000-8000-0000000000e4', 'a0000000-0000-4000-8000-000000000001', 'Savings', -5, 1)$q$,
    '23514', 'budget_accounts_planned_transfer_range');
  perform public.test_expect_error(
    $q$insert into public.budget_accounts(id, month_id, name, planned_transfer_cents, sort_order)
       values ('a0000000-0000-4000-8000-0000000000e4', 'a0000000-0000-4000-8000-000000000001', ' ', 5, 1)$q$,
    '23514', 'budget_accounts_name_not_blank');
  perform public.test_expect_error(
    $q$insert into public.budget_expense_categories(id, month_id, name, sort_order)
       values ('a0000000-0000-4000-8000-0000000000e5', 'a0000000-0000-4000-8000-000000000001', '   ', 1)$q$,
    '23514', 'budget_expense_categories_name_not_blank');
  perform public.test_expect_error(
    $q$insert into public.budget_expense_items(id, category_id, name, amount_cents, sort_order)
       values ('a0000000-0000-4000-8000-0000000000e6', 'a0000000-0000-4000-8000-000000000031', 'Water',
               100000000001, 1)$q$,
    '23514', 'budget_expense_items_amount_range');
  perform public.test_expect_error(
    $q$insert into public.budget_expense_items(id, category_id, name, amount_cents, sort_order)
       values ('a0000000-0000-4000-8000-0000000000e6', 'a0000000-0000-4000-8000-000000000031', '', 1, 1)$q$,
    '23514', 'budget_expense_items_name_not_blank');

  -- Imported transactions: zero and out-of-range amounts, currency, kind, provider, text lengths.
  perform public.test_expect_error(
    $q$insert into public.imported_transactions select * from public.test_transaction('{"amount_cents": 0}')$q$,
    '23514', 'imported_transactions_amount_range');
  perform public.test_expect_error(
    $q$insert into public.imported_transactions
       select * from public.test_transaction('{"amount_cents": 9007199254740992}')$q$,
    '23514', 'imported_transactions_amount_range');
  perform public.test_expect_error(
    $q$insert into public.imported_transactions
       select * from public.test_transaction('{"amount_cents": -9007199254740992}')$q$,
    '23514', 'imported_transactions_amount_range');
  perform public.test_expect_error(
    $q$insert into public.imported_transactions select * from public.test_transaction('{"fee_cents": -1}')$q$,
    '23514', 'imported_transactions_fee_range');
  perform public.test_expect_error(
    $q$insert into public.imported_transactions
       select * from public.test_transaction('{"fee_cents": 100000000001}')$q$,
    '23514', 'imported_transactions_fee_range');
  perform public.test_expect_error(
    $q$insert into public.imported_transactions
       select * from public.test_transaction('{"balance_cents": 9007199254740992}')$q$,
    '23514', 'imported_transactions_balance_range');
  perform public.test_expect_error(
    $q$insert into public.imported_transactions select * from public.test_transaction('{"currency": "eur"}')$q$,
    '23514', 'imported_transactions_currency_format');
  perform public.test_expect_error(
    $q$insert into public.imported_transactions select * from public.test_transaction('{"currency": "EURO"}')$q$,
    '23514', 'imported_transactions_currency_format');
  perform public.test_expect_error(
    $q$insert into public.imported_transactions select * from public.test_transaction('{"currency": "E1R"}')$q$,
    '23514', 'imported_transactions_currency_format');
  perform public.test_expect_error(
    $q$insert into public.imported_transactions select * from public.test_transaction('{"kind": "refund"}')$q$,
    '23514', 'imported_transactions_kind_check');
  perform public.test_expect_error(
    $q$insert into public.imported_transactions select * from public.test_transaction('{"provider": "other-bank"}')$q$,
    '23514', 'imported_transactions_provider_check');
  perform public.test_expect_error(
    $q$insert into public.imported_transactions select * from public.test_transaction('{"description": "  "}')$q$,
    '23514', 'imported_transactions_description_length');
  perform public.test_expect_error(
    format($q$insert into public.imported_transactions select * from public.test_transaction(%L)$q$,
           jsonb_build_object('description', repeat('x', 501))),
    '23514', 'imported_transactions_description_length');
  perform public.test_expect_error(
    format($q$insert into public.imported_transactions select * from public.test_transaction(%L)$q$,
           jsonb_build_object('source_key', repeat('k', 201))),
    '23514', 'imported_transactions_source_key_length');
  perform public.test_expect_error(
    $q$insert into public.imported_transactions
       select * from public.test_transaction('{"source_reference": ""}')$q$,
    '23514', 'imported_transactions_source_reference_length');
  perform public.test_expect_error(
    format($q$insert into public.imported_transactions select * from public.test_transaction(%L)$q$,
           jsonb_build_object('source_file_name', repeat('f', 256))),
    '23514', 'imported_transactions_source_file_name_length');
  perform public.test_expect_error(
    format($q$insert into public.imported_transactions select * from public.test_transaction(%L)$q$,
           jsonb_build_object('transaction_type', repeat('t', 101))),
    '23514', 'imported_transactions_transaction_type_length');
  perform public.test_expect_error(
    $q$insert into public.imported_transactions select * from public.test_transaction('{"product": " "}')$q$,
    '23514', 'imported_transactions_product_length');
  perform public.test_expect_error(
    $q$insert into public.imported_transactions select * from public.test_transaction('{"started_at": ""}')$q$,
    '23514', 'imported_transactions_started_at_length');
  perform public.test_expect_error(
    $q$insert into public.imported_transactions select * from public.test_transaction('{"completed_at": ""}')$q$,
    '23514', 'imported_transactions_completed_at_length');
  -- A fully filled valid row passes.
  insert into public.imported_transactions
    select * from public.test_transaction(jsonb_build_object(
      'source_reference', 'ref-1', 'started_at', '2026-11-05 08:00:00', 'completed_at', '2026-11-06 08:00:00',
      'balance_cents', -500, 'transaction_type', 'CARD_PAYMENT', 'product', 'Current',
      'fee_cents', 100000000000, 'currency', 'USD', 'kind', 'transfer'));
end $test$;

-- ---------------------------------------------------------------------------
-- Uniqueness of live rows
-- ---------------------------------------------------------------------------
do $test$
begin
  -- Two live months for the same (owner, year, month) are rejected...
  perform public.test_expect_error(
    $q$insert into public.budget_months(id, year, month, name, edited_at)
       values ('a0000000-0000-4000-8000-0000000000d1', 2026, 11, 'Duplicate November', now())$q$,
    '23505', 'budget_months_owner_year_month_live_key');
  -- ...until the first one is soft-deleted.
  update public.budget_months set deleted_at = now() where id = 'a0000000-0000-4000-8000-000000000003';
  insert into public.budget_months(id, year, month, name, edited_at)
    values ('a0000000-0000-4000-8000-0000000000d2', 2027, 1, 'January 2027 again', now());
  -- Restoring the old one while the new one is live conflicts.
  perform public.test_expect_error(
    $q$update public.budget_months set deleted_at = null where id = 'a0000000-0000-4000-8000-000000000003'$q$,
    '23505', 'budget_months_owner_year_month_live_key');

  -- Same for the transaction source key.
  perform public.test_expect_error(
    $q$insert into public.imported_transactions
       select * from public.test_transaction('{"source_key": "a-source-key-1"}')$q$,
    '23505', 'imported_transactions_owner_source_key_live_key');
  update public.imported_transactions set deleted_at = now() where id = 'a0000000-0000-4000-8000-000000000052';
  insert into public.imported_transactions
    select * from public.test_transaction('{"source_key": "a-source-key-2"}');
  perform public.test_expect_error(
    $q$update public.imported_transactions set deleted_at = null where id = 'a0000000-0000-4000-8000-000000000052'$q$,
    '23505', 'imported_transactions_owner_source_key_live_key');
end $test$;

-- ---------------------------------------------------------------------------
-- Same-owner and same-month references
-- ---------------------------------------------------------------------------
do $test$
begin
  -- A category account must be an account of the category's own month.
  perform public.test_expect_error(
    $q$insert into public.budget_expense_categories(id, month_id, account_id, name, sort_order)
       values ('a0000000-0000-4000-8000-0000000000c1', 'a0000000-0000-4000-8000-000000000001',
               'a0000000-0000-4000-8000-000000000022', 'Wrong month account', 5)$q$,
    '23503', 'budget_expense_categories_account_fkey');
  perform public.test_expect_error(
    $q$update public.budget_expense_categories set month_id = 'a0000000-0000-4000-8000-000000000002'
       where id = 'a0000000-0000-4000-8000-000000000031'$q$,
    '23503', 'budget_expense_categories_account_fkey');
  -- A missing month, account, category or active month is rejected.
  perform public.test_expect_error(
    $q$insert into public.budget_incomes(id, month_id, name, amount_cents, sort_order)
       values ('a0000000-0000-4000-8000-0000000000c2', 'a0000000-0000-4000-8000-0000000000aa', 'Orphan', 1, 5)$q$,
    '23503', 'budget_incomes_month_fkey');
  perform public.test_expect_error(
    $q$insert into public.budget_expense_items(id, category_id, name, amount_cents, sort_order)
       values ('a0000000-0000-4000-8000-0000000000c3', 'a0000000-0000-4000-8000-0000000000aa', 'Orphan', 1, 5)$q$,
    '23503', 'budget_expense_items_category_fkey');
  perform public.test_expect_error(
    $q$update public.user_settings set active_budget_month_id = 'a0000000-0000-4000-8000-0000000000aa'$q$,
    '23503', 'user_settings_active_month_fkey');
  perform public.test_expect_error(
    $q$insert into public.imported_transactions
       select * from public.test_transaction('{"category_id": "a0000000-0000-4000-8000-0000000000aa"}')$q$,
    '23503', 'imported_transactions_category_fkey');
end $test$;

-- ---------------------------------------------------------------------------
-- Transaction category must belong to the month of the booking date
-- ---------------------------------------------------------------------------
do $test$
begin
  -- c1 is a November 2026 category: another month or another year is rejected (check_violation).
  perform public.test_expect_error(
    $q$insert into public.imported_transactions
       select * from public.test_transaction('{"category_id": "a0000000-0000-4000-8000-000000000031",
                                              "booking_date": "2026-12-01"}')$q$, '23514');
  perform public.test_expect_error(
    $q$insert into public.imported_transactions
       select * from public.test_transaction('{"category_id": "a0000000-0000-4000-8000-000000000031",
                                              "booking_date": "2025-11-30"}')$q$, '23514');
  perform public.test_expect_error(
    $q$update public.imported_transactions set booking_date = '2026-10-31'
       where id = 'a0000000-0000-4000-8000-000000000051'$q$, '23514');
  perform public.test_expect_error(
    $q$update public.imported_transactions set category_id = 'a0000000-0000-4000-8000-000000000032'
       where id = 'a0000000-0000-4000-8000-000000000051'$q$, '23514');
  -- The month boundaries and uncategorised rows are accepted.
  insert into public.imported_transactions
    select * from public.test_transaction('{"category_id": "a0000000-0000-4000-8000-000000000031",
                                           "booking_date": "2026-11-30"}');
  insert into public.imported_transactions
    select * from public.test_transaction('{"category_id": "a0000000-0000-4000-8000-000000000032",
                                           "booking_date": "2026-12-01"}');
  insert into public.imported_transactions
    select * from public.test_transaction('{"booking_date": "2031-02-03"}');
end $test$;

-- ---------------------------------------------------------------------------
-- user_settings: id = owner_id and one row per user
-- ---------------------------------------------------------------------------
do $test$
begin
  perform public.test_expect_error(
    $q$insert into public.user_settings(id) values ('a0000000-0000-4000-8000-0000000000b9')$q$,
    '23514', 'user_settings_id_is_owner');
  perform public.test_expect_error(
    $q$insert into public.user_settings(id) values ('aaaaaaaa-0000-4000-8000-0000000000a1')$q$,
    '23505', 'user_settings_pkey');
end $test$;

-- ---------------------------------------------------------------------------
-- User B: isolation from A
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', 'bbbbbbbb-0000-4000-8000-0000000000b1', true);
do $test$
declare
  touched integer;
begin
  if exists (select 1 from public.budget_months) then raise exception 'B reads A months'; end if;
  if exists (select 1 from public.budget_incomes) then raise exception 'B reads A incomes'; end if;
  if exists (select 1 from public.budget_accounts) then raise exception 'B reads A accounts'; end if;
  if exists (select 1 from public.budget_expense_categories) then raise exception 'B reads A categories'; end if;
  if exists (select 1 from public.budget_expense_items) then raise exception 'B reads A items'; end if;
  if exists (select 1 from public.imported_transactions) then raise exception 'B reads A transactions'; end if;
  if exists (select 1 from public.user_settings) then raise exception 'B reads A settings'; end if;

  -- B updates match nothing: the rows are invisible, so no error and no change.
  update public.budget_months set name = 'Hijacked' where id = 'a0000000-0000-4000-8000-000000000001';
  get diagnostics touched = row_count;
  if touched <> 0 then raise exception 'B updated A month'; end if;
  update public.budget_incomes set name = 'Hijacked' where id = 'a0000000-0000-4000-8000-000000000011';
  get diagnostics touched = row_count;
  if touched <> 0 then raise exception 'B updated A income'; end if;
  update public.imported_transactions set deleted_at = now() where id = 'a0000000-0000-4000-8000-000000000051';
  get diagnostics touched = row_count;
  if touched <> 0 then raise exception 'B soft-deleted A transaction'; end if;
  update public.user_settings set active_budget_month_id = null;
  get diagnostics touched = row_count;
  if touched <> 0 then raise exception 'B updated A settings'; end if;

  -- B cannot write rows owned by A.
  perform public.test_expect_error(
    $q$insert into public.budget_months(id, owner_id, year, month, name, edited_at)
       values ('b0000000-0000-4000-8000-0000000000f1', 'aaaaaaaa-0000-4000-8000-0000000000a1',
               2030, 1, 'Forged', now())$q$, '42501');

  -- B cannot reference A rows, even though the foreign key target is hidden by RLS.
  perform public.test_expect_error(
    $q$insert into public.budget_incomes(id, month_id, name, amount_cents, sort_order)
       values ('b0000000-0000-4000-8000-0000000000f2', 'a0000000-0000-4000-8000-000000000001', 'Leak', 1, 0)$q$,
    '23503', 'budget_incomes_month_fkey');
  perform public.test_expect_error(
    $q$insert into public.budget_accounts(id, month_id, name, planned_transfer_cents, sort_order)
       values ('b0000000-0000-4000-8000-0000000000f3', 'a0000000-0000-4000-8000-000000000001', 'Leak', 1, 0)$q$,
    '23503', 'budget_accounts_month_fkey');
  perform public.test_expect_error(
    $q$insert into public.budget_expense_categories(id, month_id, name, sort_order)
       values ('b0000000-0000-4000-8000-0000000000f4', 'a0000000-0000-4000-8000-000000000001', 'Leak', 0)$q$,
    '23503', 'budget_expense_categories_month_fkey');
  perform public.test_expect_error(
    $q$insert into public.budget_expense_items(id, category_id, name, amount_cents, sort_order)
       values ('b0000000-0000-4000-8000-0000000000f5', 'a0000000-0000-4000-8000-000000000031', 'Leak', 1, 0)$q$,
    '23503', 'budget_expense_items_category_fkey');
  perform public.test_expect_error(
    $q$insert into public.imported_transactions
       select * from public.test_transaction('{"category_id": "a0000000-0000-4000-8000-000000000031"}')$q$,
    '23503', 'imported_transactions_category_fkey');
  perform public.test_expect_error(
    $q$insert into public.user_settings(id, active_budget_month_id)
       values ('bbbbbbbb-0000-4000-8000-0000000000b1', 'a0000000-0000-4000-8000-000000000001')$q$,
    '23503', 'user_settings_active_month_fkey');

  -- B has its own namespace: the same ids, month slot and source key as A do not collide
  -- on uniqueness, only on the global primary key.
  insert into public.budget_months(id, year, month, name, edited_at)
    values ('b0000000-0000-4000-8000-000000000001', 2026, 11, 'November 2026', now());
  insert into public.budget_expense_categories(id, month_id, name, sort_order)
    values ('b0000000-0000-4000-8000-000000000031', 'b0000000-0000-4000-8000-000000000001', 'Housing', 0);
  insert into public.imported_transactions
    select * from public.test_transaction('{"source_key": "a-source-key-1",
                                           "category_id": "b0000000-0000-4000-8000-000000000031"}');
  insert into public.user_settings(id, active_budget_month_id)
    values ('bbbbbbbb-0000-4000-8000-0000000000b1', 'b0000000-0000-4000-8000-000000000001');

  if (select count(*) from public.budget_months) <> 1 then raise exception 'B sees the wrong months'; end if;
  if (select count(*) from public.imported_transactions) <> 1 then raise exception 'B sees the wrong transactions'; end if;
  if (select count(*) from public.user_settings) <> 1 then raise exception 'B sees the wrong settings'; end if;
end $test$;

-- A still sees only its own rows, unchanged by B.
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-4000-8000-0000000000a1', true);
do $test$
begin
  if exists (select 1 from public.budget_months where owner_id <> auth.uid()) then
    raise exception 'A reads B months'; end if;
  if exists (select 1 from public.imported_transactions where owner_id <> auth.uid()) then
    raise exception 'A reads B transactions'; end if;
  if (select name from public.budget_months where id = 'a0000000-0000-4000-8000-000000000001') <> 'Nov 2026'
    then raise exception 'A month was changed by B'; end if;
end $test$;

-- ---------------------------------------------------------------------------
-- Structure: RLS is on everywhere and the anonymous role has no access
-- ---------------------------------------------------------------------------
reset role;
do $test$
declare
  table_name text;
  tables text[] := array['budget_months', 'budget_incomes', 'budget_accounts',
    'budget_expense_categories', 'budget_expense_items', 'imported_transactions', 'user_settings'];
begin
  foreach table_name in array tables loop
    if not (select relrowsecurity from pg_class where oid = ('public.' || table_name)::regclass) then
      raise exception 'Row level security is off on %', table_name;
    end if;
  end loop;
end $test$;

set local role anon;
select set_config('request.jwt.claim.sub', '', true);
do $test$
declare
  table_name text;
  tables text[] := array['budget_months', 'budget_incomes', 'budget_accounts',
    'budget_expense_categories', 'budget_expense_items', 'imported_transactions', 'user_settings'];
begin
  foreach table_name in array tables loop
    perform public.test_expect_error(format('select * from public.%I', table_name), '42501');
    perform public.test_expect_error(format('update public.%I set owner_id = owner_id', table_name), '42501');
    perform public.test_expect_error(format('delete from public.%I', table_name), '42501');
  end loop;
  perform public.test_expect_error(
    $q$insert into public.budget_months(id, owner_id, year, month, name, edited_at)
       values ('c0000000-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-0000000000a1',
               2030, 1, 'Anonymous', now())$q$, '42501');
  perform public.test_expect_error(
    $q$insert into public.imported_transactions
       select * from public.test_transaction('{"owner_id": "aaaaaaaa-0000-4000-8000-0000000000a1"}')$q$, '42501');
  perform public.test_expect_error(
    $q$insert into public.user_settings(id, owner_id)
       values ('aaaaaaaa-0000-4000-8000-0000000000a1', 'aaaaaaaa-0000-4000-8000-0000000000a1')$q$, '42501');
end $test$;
reset role;

select 'PASS: entity tables, owner isolation, anonymous denial, column grants, soft deletes, server-owned timestamps, constraints, uniqueness and same-month references' as result;
rollback;

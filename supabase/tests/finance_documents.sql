-- Integration tests: all synthetic users and documents are rolled back.
begin;
insert into auth.users(id, email) values
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'finance-rls-a@example.invalid'),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'finance-rls-b@example.invalid');
set local role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', true);
do $test$
declare result jsonb;
begin
 result := public.save_finance_document('{"schemaVersion":2,"settings":{"activeBudgetMonthId":"11111111-1111-4111-8111-111111111111"},"budgetMonths":[{"id":"11111111-1111-4111-8111-111111111111","year":2026,"month":11,"name":"November 2026","incomes":[],"accounts":[],"expenseCategories":[],"createdAt":"2026-11-10T00:00:00.000Z","updatedAt":"2026-11-10T00:00:00.000Z"}],"importedTransactions":[]}'::jsonb, 0, 'cccccccc-cccc-4ccc-8ccc-cccccccccccc');
 if result <> '{"status":"saved","revision":1}'::jsonb then raise exception 'Initial save failed: %', result; end if;
 result := public.save_finance_document('{"schemaVersion":2,"settings":{"activeBudgetMonthId":"11111111-1111-4111-8111-111111111111"},"budgetMonths":[{"id":"11111111-1111-4111-8111-111111111111","year":2026,"month":11,"name":"November 2026","incomes":[],"accounts":[],"expenseCategories":[],"createdAt":"2026-11-10T00:00:00.000Z","updatedAt":"2026-11-10T00:00:00.000Z"}],"importedTransactions":[]}'::jsonb, 0, 'cccccccc-cccc-4ccc-8ccc-cccccccccccc');
 if result <> '{"status":"saved","revision":1}'::jsonb then raise exception 'Idempotent retry failed'; end if;
 result := public.save_finance_document('{"schemaVersion":2,"settings":{"activeBudgetMonthId":"11111111-1111-4111-8111-111111111111"},"budgetMonths":[{"id":"11111111-1111-4111-8111-111111111111","year":2026,"month":11,"name":"November 2026","incomes":[],"accounts":[],"expenseCategories":[],"createdAt":"2026-11-10T00:00:00.000Z","updatedAt":"2026-11-10T00:00:00.000Z"}],"importedTransactions":[]}'::jsonb, 0, 'dddddddd-dddd-4ddd-8ddd-dddddddddddd');
 if result <> '{"status":"conflict","revision":1}'::jsonb then raise exception 'Stale write not rejected'; end if;
 begin
  perform public.save_finance_document('{}'::jsonb, 1, 'dddddddd-dddd-4ddd-8ddd-dddddddddddd');
  raise exception 'Invalid payload was accepted';
 exception when invalid_parameter_value then null; end;
 begin
  perform public.save_finance_document('{}'::jsonb, 0, 'cccccccc-cccc-4ccc-8ccc-cccccccccccc');
  raise exception 'Mutation ID reuse accepted different payload';
 exception when invalid_parameter_value then null; end;
 if (select count(*) from public.finance_documents) <> 1 then raise exception 'Owner cannot read document'; end if;
 begin
  update public.finance_documents set revision=999;
  raise exception 'Direct update was allowed';
 exception when insufficient_privilege then null; end;
end $test$;
do $test$
declare snapshot jsonb; invalid jsonb;
begin
 select data into snapshot from public.finance_documents;
 invalid := jsonb_set(snapshot, '{budgetMonths,0,incomes}',
   '[{"id":"11111111-1111-4111-8111-111111111111","name":"Duplicate ID","sortOrder":0,"amountCents":100}]');
 begin
  perform public.save_finance_document(invalid, 1, 'dddddddd-dddd-4ddd-8ddd-dddddddddddd');
  raise exception 'Duplicate entity ID was accepted';
 exception when invalid_parameter_value then null; end;
 invalid := jsonb_set(snapshot, '{budgetMonths,0,expenseCategories}',
   '[{"id":"22222222-2222-4222-8222-222222222222","name":"Housing","sortOrder":0,"accountId":"33333333-3333-4333-8333-333333333333","items":[]}]');
 begin
  perform public.save_finance_document(invalid, 1, 'dddddddd-dddd-4ddd-8ddd-dddddddddddd');
  raise exception 'Dangling account reference was accepted';
 exception when invalid_parameter_value then null; end;
 invalid := jsonb_set(snapshot, '{budgetMonths,0,incomes}',
   '[{"id":"22222222-2222-4222-8222-222222222222","name":"Salary","sortOrder":0,"amountCents":-100}]');
 begin
  perform public.save_finance_document(invalid, 1, 'dddddddd-dddd-4ddd-8ddd-dddddddddddd');
  raise exception 'Negative planned amount was accepted';
 exception when invalid_parameter_value then null; end;
 if (select revision from public.finance_documents) <> 1 then raise exception 'Invalid saves changed revision'; end if;
end $test$;
select set_config('request.jwt.claim.sub', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', true);
do $test$
declare result jsonb;
begin
 if exists(select 1 from public.finance_documents) then raise exception 'Cross-account read allowed'; end if;
 result := public.save_finance_document('{"schemaVersion":2,"settings":{"activeBudgetMonthId":"11111111-1111-4111-8111-111111111111"},"budgetMonths":[{"id":"11111111-1111-4111-8111-111111111111","year":2026,"month":11,"name":"November 2026","incomes":[],"accounts":[],"expenseCategories":[],"createdAt":"2026-11-10T00:00:00.000Z","updatedAt":"2026-11-10T00:00:00.000Z"}],"importedTransactions":[]}'::jsonb, 0, 'cccccccc-cccc-4ccc-8ccc-cccccccccccc');
 if result <> '{"status":"saved","revision":1}'::jsonb then raise exception 'Accounts share revisions or mutation IDs'; end if;
 if exists(select 1 from public.finance_documents where user_id <> auth.uid()) then raise exception 'Cross-account isolation failed'; end if;
 begin
  delete from public.finance_documents;
  raise exception 'Direct delete was allowed';
 exception when insufficient_privilege then null; end;
 begin
  perform * from public.finance_mutation_receipts;
  raise exception 'Private receipts were readable';
 exception when insufficient_privilege then null; end;
end $test$;
set local role anon;
select set_config('request.jwt.claim.sub', '', true);
do $test$ begin
 begin
  perform public.save_finance_document('{"schemaVersion":2,"settings":{"activeBudgetMonthId":"11111111-1111-4111-8111-111111111111"},"budgetMonths":[{"id":"11111111-1111-4111-8111-111111111111","year":2026,"month":11,"name":"November 2026","incomes":[],"accounts":[],"expenseCategories":[],"createdAt":"2026-11-10T00:00:00.000Z","updatedAt":"2026-11-10T00:00:00.000Z"}],"importedTransactions":[]}'::jsonb,0,'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee');
  raise exception 'Anonymous write was allowed';
 exception when insufficient_privilege then null; end;
 begin
  perform * from public.finance_documents;
  raise exception 'Anonymous read was allowed';
 exception when insufficient_privilege then null; end;
end $test$;
reset role;
select 'PASS: owner isolation, anonymous denial, revision conflicts, idempotency, payload validation and direct-write denial' as result;
rollback;

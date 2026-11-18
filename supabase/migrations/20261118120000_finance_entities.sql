-- Normalized entity tables for the Finance budget (schema v2 document, one row per entity).
--
-- This migration only adds tables. The versioned document in public.finance_documents
-- and its RPC stay untouched; the two models live side by side until the app switches.
--
-- Conventions shared by every table
--
--   * Client-generated ids. `id` is a uuid created by the client (offline-first: a row
--     can be created and referenced before it ever reaches the server). The server never
--     generates it.
--   * Server-owned `updated_at`. A BEFORE INSERT OR UPDATE trigger always overwrites it
--     with now(), so a client can neither choose it nor move it backwards. It is the pull
--     cursor for any sync engine: `(owner_id, updated_at)` is indexed on every table.
--     `created_at` may be supplied on insert (it keeps the document's `createdAt`) and can
--     never be updated.
--   * Soft deletes. Rows are never removed by clients: they set `deleted_at`. There is no
--     delete grant and no delete policy. Entity tables have no ON DELETE CASCADE between
--     them; the only cascade is from auth.users, so deleting an account removes its data.
--   * Owner-keyed row level security. `owner_id` defaults to auth.uid() and every policy
--     compares it with the caller. Foreign keys are composite and include `owner_id`, so a
--     row can only ever reference rows of the same owner (a cross-owner reference fails
--     the foreign key even though RLS hides the target).
--   * Column grants. Clients get select and insert on each table, but update only on the
--     domain columns and `deleted_at`: `id`, `owner_id`, `created_at` and `updated_at`
--     can never be updated by a client.
--   * Nothing engine-specific: no publication, no replication role. Any sync engine or
--     a hand-written pull/push can sit on top of these tables.
--
-- Household path (not built here)
--
--   `owner_id` is the owning principal: a user today, a household later (issue #9).
--   To share a budget between several users, `owner_id` becomes a household id:
--     1. create a `households` table and a `household_members` table;
--     2. seed one household per user with `id` = the user id, so no row of the tables
--        below is rewritten;
--     3. replace the foreign key from `owner_id` to auth.users by one to `households`
--        (and keep the default or drop it, depending on how the client picks a household);
--     4. switch the three policies of each table from `owner_id = auth.uid()` to a
--        membership check on `household_members`;
--     5. switch any sync rules the same way.
--
-- Reserved names for the wealth domain (ADR 0002 section 1)
--
--   `wealth_accounts`, `wealth_valuations`, `wealth_loans` and `wealth_goals` are reserved
--   for the future wealth domain and are NOT created here. They will follow the same
--   column conventions (`id`, `owner_id`, `created_at`, `updated_at`, `deleted_at`), the
--   same trigger, the same composite owner-keyed foreign keys and the same policies and
--   grants. The `budget_` prefix on the tables below keeps both domains apart.

-- ---------------------------------------------------------------------------
-- Shared trigger function
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
comment on function public.set_updated_at() is
  'Row trigger: the server owns updated_at, whatever value the client sent.';

-- ---------------------------------------------------------------------------
-- budget_months
-- ---------------------------------------------------------------------------

create table public.budget_months (
  id uuid primary key,
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  year integer not null,
  month integer not null,
  name text not null,
  -- The document's month `updatedAt`, set by the client. Distinct from the
  -- server-owned `updated_at`.
  edited_at timestamptz not null,
  constraint budget_months_year_range check (year between 2000 and 2200),
  constraint budget_months_month_range check (month between 1 and 12),
  constraint budget_months_name_not_blank check (btrim(name) <> ''),
  -- Target of the composite foreign keys of the child tables.
  constraint budget_months_owner_id_key unique (owner_id, id)
);

-- One live budget per (owner, year, month); a soft-deleted month frees its slot.
create unique index budget_months_owner_year_month_live_key
  on public.budget_months (owner_id, year, month) where deleted_at is null;
create index budget_months_owner_updated_idx
  on public.budget_months (owner_id, updated_at);

create trigger set_updated_at before insert or update on public.budget_months
  for each row execute function public.set_updated_at();

alter table public.budget_months enable row level security;
create policy "Read own budget months" on public.budget_months
  for select to authenticated using (owner_id = (select auth.uid()));
create policy "Insert own budget months" on public.budget_months
  for insert to authenticated with check (owner_id = (select auth.uid()));
create policy "Update own budget months" on public.budget_months
  for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

revoke all on public.budget_months from anon, authenticated;
grant select, insert on public.budget_months to authenticated;
grant update (year, month, name, edited_at, deleted_at) on public.budget_months to authenticated;

-- ---------------------------------------------------------------------------
-- budget_incomes
-- ---------------------------------------------------------------------------

create table public.budget_incomes (
  id uuid primary key,
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  month_id uuid not null,
  name text not null,
  amount_cents bigint not null,
  sort_order integer not null,
  constraint budget_incomes_name_not_blank check (btrim(name) <> ''),
  -- 100000000000 cents is MAX_AMOUNT_CENTS, one billion euros.
  constraint budget_incomes_amount_range check (amount_cents between 0 and 100000000000),
  constraint budget_incomes_sort_order_range check (sort_order >= 0),
  constraint budget_incomes_month_fkey foreign key (owner_id, month_id)
    references public.budget_months (owner_id, id)
);

create index budget_incomes_month_idx on public.budget_incomes (owner_id, month_id);
create index budget_incomes_owner_updated_idx on public.budget_incomes (owner_id, updated_at);

create trigger set_updated_at before insert or update on public.budget_incomes
  for each row execute function public.set_updated_at();

alter table public.budget_incomes enable row level security;
create policy "Read own budget incomes" on public.budget_incomes
  for select to authenticated using (owner_id = (select auth.uid()));
create policy "Insert own budget incomes" on public.budget_incomes
  for insert to authenticated with check (owner_id = (select auth.uid()));
create policy "Update own budget incomes" on public.budget_incomes
  for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

revoke all on public.budget_incomes from anon, authenticated;
grant select, insert on public.budget_incomes to authenticated;
grant update (month_id, name, amount_cents, sort_order, deleted_at)
  on public.budget_incomes to authenticated;

-- ---------------------------------------------------------------------------
-- budget_accounts
-- ---------------------------------------------------------------------------

create table public.budget_accounts (
  id uuid primary key,
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  month_id uuid not null,
  name text not null,
  planned_transfer_cents bigint not null,
  sort_order integer not null,
  constraint budget_accounts_name_not_blank check (btrim(name) <> ''),
  constraint budget_accounts_planned_transfer_range
    check (planned_transfer_cents between 0 and 100000000000),
  constraint budget_accounts_sort_order_range check (sort_order >= 0),
  constraint budget_accounts_month_fkey foreign key (owner_id, month_id)
    references public.budget_months (owner_id, id),
  -- Target of the (owner, month, account) foreign key of the categories.
  constraint budget_accounts_owner_month_id_key unique (owner_id, month_id, id)
);

create index budget_accounts_month_idx on public.budget_accounts (owner_id, month_id);
create index budget_accounts_owner_updated_idx on public.budget_accounts (owner_id, updated_at);

create trigger set_updated_at before insert or update on public.budget_accounts
  for each row execute function public.set_updated_at();

alter table public.budget_accounts enable row level security;
create policy "Read own budget accounts" on public.budget_accounts
  for select to authenticated using (owner_id = (select auth.uid()));
create policy "Insert own budget accounts" on public.budget_accounts
  for insert to authenticated with check (owner_id = (select auth.uid()));
create policy "Update own budget accounts" on public.budget_accounts
  for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

revoke all on public.budget_accounts from anon, authenticated;
grant select, insert on public.budget_accounts to authenticated;
grant update (month_id, name, planned_transfer_cents, sort_order, deleted_at)
  on public.budget_accounts to authenticated;

-- ---------------------------------------------------------------------------
-- budget_expense_categories
-- ---------------------------------------------------------------------------

create table public.budget_expense_categories (
  id uuid primary key,
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  month_id uuid not null,
  account_id uuid,
  name text not null,
  sort_order integer not null,
  constraint budget_expense_categories_name_not_blank check (btrim(name) <> ''),
  constraint budget_expense_categories_sort_order_range check (sort_order >= 0),
  constraint budget_expense_categories_month_fkey foreign key (owner_id, month_id)
    references public.budget_months (owner_id, id),
  -- MATCH SIMPLE: a null account_id skips the check. When it is set, the account must
  -- exist for the same owner and belong to the same month as the category.
  constraint budget_expense_categories_account_fkey foreign key (owner_id, month_id, account_id)
    references public.budget_accounts (owner_id, month_id, id),
  constraint budget_expense_categories_owner_id_key unique (owner_id, id),
  constraint budget_expense_categories_owner_month_id_key unique (owner_id, month_id, id)
);

-- The (owner_id, month_id) prefix of this index also serves the month foreign key.
create index budget_expense_categories_account_idx
  on public.budget_expense_categories (owner_id, month_id, account_id);
create index budget_expense_categories_owner_updated_idx
  on public.budget_expense_categories (owner_id, updated_at);

create trigger set_updated_at before insert or update on public.budget_expense_categories
  for each row execute function public.set_updated_at();

alter table public.budget_expense_categories enable row level security;
create policy "Read own budget expense categories" on public.budget_expense_categories
  for select to authenticated using (owner_id = (select auth.uid()));
create policy "Insert own budget expense categories" on public.budget_expense_categories
  for insert to authenticated with check (owner_id = (select auth.uid()));
create policy "Update own budget expense categories" on public.budget_expense_categories
  for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

revoke all on public.budget_expense_categories from anon, authenticated;
grant select, insert on public.budget_expense_categories to authenticated;
grant update (month_id, account_id, name, sort_order, deleted_at)
  on public.budget_expense_categories to authenticated;

-- ---------------------------------------------------------------------------
-- budget_expense_items
-- ---------------------------------------------------------------------------

create table public.budget_expense_items (
  id uuid primary key,
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  category_id uuid not null,
  name text not null,
  amount_cents bigint not null,
  sort_order integer not null,
  constraint budget_expense_items_name_not_blank check (btrim(name) <> ''),
  constraint budget_expense_items_amount_range check (amount_cents between 0 and 100000000000),
  constraint budget_expense_items_sort_order_range check (sort_order >= 0),
  constraint budget_expense_items_category_fkey foreign key (owner_id, category_id)
    references public.budget_expense_categories (owner_id, id)
);

create index budget_expense_items_category_idx
  on public.budget_expense_items (owner_id, category_id);
create index budget_expense_items_owner_updated_idx
  on public.budget_expense_items (owner_id, updated_at);

create trigger set_updated_at before insert or update on public.budget_expense_items
  for each row execute function public.set_updated_at();

alter table public.budget_expense_items enable row level security;
create policy "Read own budget expense items" on public.budget_expense_items
  for select to authenticated using (owner_id = (select auth.uid()));
create policy "Insert own budget expense items" on public.budget_expense_items
  for insert to authenticated with check (owner_id = (select auth.uid()));
create policy "Update own budget expense items" on public.budget_expense_items
  for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

revoke all on public.budget_expense_items from anon, authenticated;
grant select, insert on public.budget_expense_items to authenticated;
grant update (category_id, name, amount_cents, sort_order, deleted_at)
  on public.budget_expense_items to authenticated;

-- ---------------------------------------------------------------------------
-- imported_transactions
-- ---------------------------------------------------------------------------

create table public.imported_transactions (
  id uuid primary key,
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  provider text not null,
  source_key text not null,
  source_reference text,
  import_batch_id uuid not null,
  source_file_name text not null,
  booking_date date not null,
  -- Free-form strings from the bank file, kept as text on purpose.
  started_at text,
  completed_at text,
  description text not null,
  amount_cents bigint not null,
  fee_cents bigint not null,
  balance_cents bigint,
  currency text not null,
  transaction_type text,
  product text,
  kind text not null,
  category_id uuid,
  imported_at timestamptz not null,
  -- A later provider only needs this list widened.
  constraint imported_transactions_provider_check check (provider in ('revolut-csv')),
  constraint imported_transactions_source_key_length
    check (btrim(source_key) <> '' and char_length(source_key) <= 200),
  constraint imported_transactions_source_reference_length
    check (source_reference is null or (btrim(source_reference) <> '' and char_length(source_reference) <= 200)),
  constraint imported_transactions_source_file_name_length
    check (btrim(source_file_name) <> '' and char_length(source_file_name) <= 255),
  constraint imported_transactions_started_at_length
    check (started_at is null or (btrim(started_at) <> '' and char_length(started_at) <= 100)),
  constraint imported_transactions_completed_at_length
    check (completed_at is null or (btrim(completed_at) <> '' and char_length(completed_at) <= 100)),
  constraint imported_transactions_description_length
    check (btrim(description) <> '' and char_length(description) <= 500),
  -- Signed cents stay inside the JavaScript safe integer range (2^53 - 1).
  constraint imported_transactions_amount_range
    check (amount_cents <> 0 and amount_cents between -9007199254740991 and 9007199254740991),
  constraint imported_transactions_fee_range check (fee_cents between 0 and 100000000000),
  constraint imported_transactions_balance_range
    check (balance_cents is null or balance_cents between -9007199254740991 and 9007199254740991),
  constraint imported_transactions_currency_format check (currency ~ '^[A-Z]{3}$'),
  constraint imported_transactions_transaction_type_length
    check (transaction_type is null or (btrim(transaction_type) <> '' and char_length(transaction_type) <= 100)),
  constraint imported_transactions_product_length
    check (product is null or (btrim(product) <> '' and char_length(product) <= 100)),
  constraint imported_transactions_kind_check check (kind in ('expense', 'income', 'transfer')),
  constraint imported_transactions_category_fkey foreign key (owner_id, category_id)
    references public.budget_expense_categories (owner_id, id)
);

-- One live row per bank transaction; a soft-deleted row frees its source key.
create unique index imported_transactions_owner_source_key_live_key
  on public.imported_transactions (owner_id, source_key) where deleted_at is null;
create index imported_transactions_category_idx
  on public.imported_transactions (owner_id, category_id);
create index imported_transactions_owner_updated_idx
  on public.imported_transactions (owner_id, updated_at);

create trigger set_updated_at before insert or update on public.imported_transactions
  for each row execute function public.set_updated_at();

-- A categorised transaction must be booked in the month of its category. The composite
-- foreign key only proves the category exists for the owner; this trigger adds the month
-- rule that the document validation had. When the category does not exist, the foreign
-- key reports it, so this function just steps aside.
create or replace function public.check_imported_transaction_month()
returns trigger language plpgsql set search_path = '' as $$
declare
  category_year integer;
  category_month integer;
begin
  if new.category_id is null then
    return new;
  end if;
  select m.year, m.month into category_year, category_month
    from public.budget_expense_categories c
    join public.budget_months m on m.owner_id = c.owner_id and m.id = c.month_id
    where c.owner_id = new.owner_id and c.id = new.category_id;
  if found
    and (category_year, category_month) is distinct from
      (extract(year from new.booking_date)::integer, extract(month from new.booking_date)::integer)
  then
    raise exception 'The category belongs to another month than the booking date'
      using errcode = '23514', table = 'imported_transactions';
  end if;
  return new;
end;
$$;
comment on function public.check_imported_transaction_month() is
  'Row trigger: the category of an imported transaction must belong to the month of its booking date.';

create trigger check_month before insert or update on public.imported_transactions
  for each row execute function public.check_imported_transaction_month();

alter table public.imported_transactions enable row level security;
create policy "Read own imported transactions" on public.imported_transactions
  for select to authenticated using (owner_id = (select auth.uid()));
create policy "Insert own imported transactions" on public.imported_transactions
  for insert to authenticated with check (owner_id = (select auth.uid()));
create policy "Update own imported transactions" on public.imported_transactions
  for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

revoke all on public.imported_transactions from anon, authenticated;
grant select, insert on public.imported_transactions to authenticated;
grant update (
  provider, source_key, source_reference, import_batch_id, source_file_name, booking_date,
  started_at, completed_at, description, amount_cents, fee_cents, balance_cents, currency,
  transaction_type, product, kind, category_id, imported_at, deleted_at
) on public.imported_transactions to authenticated;

-- ---------------------------------------------------------------------------
-- user_settings
-- ---------------------------------------------------------------------------

-- One row per user. The id is the user id, so the row is addressable without a lookup
-- and a second row for the same user is impossible. It is never deleted, so there is no
-- deleted_at column.
create table public.user_settings (
  id uuid primary key,
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  active_budget_month_id uuid,
  constraint user_settings_id_is_owner check (id = owner_id),
  -- MATCH SIMPLE: a null active month skips the check.
  constraint user_settings_active_month_fkey foreign key (owner_id, active_budget_month_id)
    references public.budget_months (owner_id, id)
);

create index user_settings_active_month_idx
  on public.user_settings (owner_id, active_budget_month_id);
create index user_settings_owner_updated_idx on public.user_settings (owner_id, updated_at);

create trigger set_updated_at before insert or update on public.user_settings
  for each row execute function public.set_updated_at();

alter table public.user_settings enable row level security;
create policy "Read own user settings" on public.user_settings
  for select to authenticated using (owner_id = (select auth.uid()));
create policy "Insert own user settings" on public.user_settings
  for insert to authenticated with check (owner_id = (select auth.uid()));
create policy "Update own user settings" on public.user_settings
  for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

revoke all on public.user_settings from anon, authenticated;
grant select, insert on public.user_settings to authenticated;
grant update (active_budget_month_id) on public.user_settings to authenticated;

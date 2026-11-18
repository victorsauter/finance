// Client-side PowerSync schema for the seven entity tables of
// supabase/migrations/20261118120000_finance_entities.sql.
// PowerSync adds the `id` column (text) itself. uuid, date and timestamptz are
// text in SQLite; integer and bigint are SQLite integers (64-bit).
import { Schema, Table, column } from '@powersync/node'

const meta = {
  owner_id: column.text,
  created_at: column.text,
  updated_at: column.text,
  deleted_at: column.text,
}

// trackPrevious: PATCH entries carry the previous values of the changed
// columns, which lets the connector detect concurrent edits (scenario 3f).
const tracked = { trackPrevious: true, ignoreEmptyUpdates: true }

export const budget_months = new Table(
  { ...meta, year: column.integer, month: column.integer, name: column.text, edited_at: column.text },
  tracked,
)

export const budget_incomes = new Table(
  {
    ...meta,
    month_id: column.text,
    name: column.text,
    amount_cents: column.integer,
    sort_order: column.integer,
  },
  { ...tracked, indexes: { month: ['month_id'] } },
)

export const budget_accounts = new Table(
  {
    ...meta,
    month_id: column.text,
    name: column.text,
    planned_transfer_cents: column.integer,
    sort_order: column.integer,
  },
  { ...tracked, indexes: { month: ['month_id'] } },
)

export const budget_expense_categories = new Table(
  {
    ...meta,
    month_id: column.text,
    account_id: column.text,
    name: column.text,
    sort_order: column.integer,
  },
  { ...tracked, indexes: { month: ['month_id'] } },
)

export const budget_expense_items = new Table(
  {
    ...meta,
    category_id: column.text,
    name: column.text,
    amount_cents: column.integer,
    sort_order: column.integer,
  },
  { ...tracked, indexes: { category: ['category_id'] } },
)

export const imported_transactions = new Table(
  {
    ...meta,
    provider: column.text,
    source_key: column.text,
    source_reference: column.text,
    import_batch_id: column.text,
    source_file_name: column.text,
    booking_date: column.text,
    started_at: column.text,
    completed_at: column.text,
    description: column.text,
    amount_cents: column.integer,
    fee_cents: column.integer,
    balance_cents: column.integer,
    currency: column.text,
    transaction_type: column.text,
    product: column.text,
    kind: column.text,
    category_id: column.text,
    imported_at: column.text,
  },
  { ...tracked, indexes: { booking: ['booking_date'], category: ['category_id'] } },
)

export const user_settings = new Table(
  {
    owner_id: column.text,
    created_at: column.text,
    updated_at: column.text,
    active_budget_month_id: column.text,
  },
  tracked,
)

/** Local-only: uploads the server rejected for good, for the app to show. */
export const upload_rejections = new Table(
  {
    table_name: column.text,
    row_id: column.text,
    op: column.text,
    op_data: column.text,
    code: column.text,
    message: column.text,
    rejected_at: column.text,
  },
  { localOnly: true },
)

export const AppSchema = new Schema({
  budget_months,
  budget_incomes,
  budget_accounts,
  budget_expense_categories,
  budget_expense_items,
  imported_transactions,
  user_settings,
  upload_rejections,
})

export const SYNCED_TABLES = [
  'budget_months',
  'budget_incomes',
  'budget_accounts',
  'budget_expense_categories',
  'budget_expense_items',
  'imported_transactions',
  'user_settings',
] as const
export type SyncedTable = (typeof SYNCED_TABLES)[number]

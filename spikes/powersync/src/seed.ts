// Synthetic rows from the app's own generator (src/data/entities), written
// straight into Postgres for one owner. Seeding is setup, not under test, so it
// uses the direct connection; every write under test goes through the connector.
import { createSyntheticAppData } from '@/data/entities/synthetic'
import { documentToEntities } from '@/data/entities/convert'
import type { EntitySnapshot } from '@/data/entities/rows'
import type pg from 'pg'

export function syntheticSnapshot(seed: number, monthCount: number, transactionsPerMonth: number): EntitySnapshot {
  return documentToEntities(createSyntheticAppData(seed, { monthCount, transactionsPerMonth }))
}

type Row = Record<string, unknown>

async function insertRows(client: pg.PoolClient, table: string, rows: Row[]): Promise<void> {
  if (rows.length === 0) return
  const columns = Object.keys(rows[0])
  const chunk = Math.max(1, Math.floor(30_000 / columns.length))
  for (let start = 0; start < rows.length; start += chunk) {
    const slice = rows.slice(start, start + chunk)
    const params: unknown[] = []
    const tuples = slice.map((row) => {
      const placeholders = columns.map((column) => {
        params.push(row[column])
        return `$${params.length}`
      })
      return `(${placeholders.join(', ')})`
    })
    await client.query(`insert into public.${table} (${columns.join(', ')}) values ${tuples.join(', ')}`, params)
  }
}

export interface SeedCounts {
  [table: string]: number
}

export async function seedOwner(pool: pg.Pool, ownerId: string, snapshot: EntitySnapshot): Promise<SeedCounts> {
  const owner = { owner_id: ownerId }
  const tables: [string, Row[]][] = [
    [
      'budget_months',
      snapshot.months.map((m) => ({
        id: m.id, ...owner, year: m.year, month: m.month, name: m.name,
        created_at: m.createdAt, edited_at: m.editedAt, deleted_at: m.deletedAt,
      })),
    ],
    [
      'budget_incomes',
      snapshot.incomes.map((r) => ({
        id: r.id, ...owner, month_id: r.monthId, name: r.name, amount_cents: r.amountCents,
        sort_order: r.sortOrder, deleted_at: r.deletedAt,
      })),
    ],
    [
      'budget_accounts',
      snapshot.accounts.map((r) => ({
        id: r.id, ...owner, month_id: r.monthId, name: r.name,
        planned_transfer_cents: r.plannedTransferCents, sort_order: r.sortOrder, deleted_at: r.deletedAt,
      })),
    ],
    [
      'budget_expense_categories',
      snapshot.expenseCategories.map((r) => ({
        id: r.id, ...owner, month_id: r.monthId, account_id: r.accountId, name: r.name,
        sort_order: r.sortOrder, deleted_at: r.deletedAt,
      })),
    ],
    [
      'budget_expense_items',
      snapshot.expenseItems.map((r) => ({
        id: r.id, ...owner, category_id: r.categoryId, name: r.name, amount_cents: r.amountCents,
        sort_order: r.sortOrder, deleted_at: r.deletedAt,
      })),
    ],
    [
      'imported_transactions',
      snapshot.importedTransactions.map((t) => ({
        id: t.id, ...owner, provider: t.provider, source_key: t.sourceKey, source_reference: t.sourceReference,
        import_batch_id: t.importBatchId, source_file_name: t.sourceFileName, booking_date: t.bookingDate,
        started_at: t.startedAt, completed_at: t.completedAt, description: t.description,
        amount_cents: t.amountCents, fee_cents: t.feeCents, balance_cents: t.balanceCents, currency: t.currency,
        transaction_type: t.transactionType, product: t.product, kind: t.kind, category_id: t.categoryId,
        imported_at: t.importedAt, deleted_at: t.deletedAt,
      })),
    ],
    [
      'user_settings',
      [{ id: ownerId, ...owner, active_budget_month_id: snapshot.settings.activeBudgetMonthId }],
    ],
  ]
  const counts: SeedCounts = {}
  const client = await pool.connect()
  try {
    await client.query('begin')
    for (const [table, rows] of tables) {
      await insertRows(client, table, rows)
      counts[table] = rows.length
    }
    await client.query('commit')
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    client.release()
  }
  return counts
}

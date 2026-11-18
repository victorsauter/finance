// Scenario 8 (extra): large local transactions, a 3000-row CSV import and a
// full restore, and whether a local transaction is applied atomically upstream.
import { openDevice, serverRows, settle, uuid, type Device, type TestUser } from '../harness.ts'
import { Scenario, kib, ms } from '../report.ts'
import { syntheticSnapshot } from '../seed.ts'

export async function largeTransactions(a1: Device, userD: TestUser, seed: number): Promise<Scenario> {
  const s = new Scenario('8', 'Large local transactions (CSV import, full restore)')

  // CSV import: 3000 rows in one local transaction, row 1500 invalid (amount 0).
  const batch = uuid()
  const rows = Array.from({ length: 3000 }, (_, index) => ({
    id: uuid(),
    amount: index === 1500 ? 0 : -(index + 1) * 7,
  }))
  const writeStarted = performance.now()
  await a1.db.writeTransaction(async (tx) => {
    for (const [index, row] of rows.entries()) {
      await tx.execute(
        `insert into imported_transactions (id, provider, source_key, import_batch_id, source_file_name, booking_date,
           description, amount_cents, fee_cents, currency, kind, imported_at)
         values (?, 'revolut-csv', ?, ?, 'import.csv', '2032-03-15', ?, ?, 0, 'EUR', 'expense', ?)`,
        [row.id, `csv-${batch}-${index}`, batch, `CSV row ${index}`, row.amount, new Date().toISOString()],
      )
    }
  })
  const localMs = performance.now() - writeStarted
  const queue = await a1.db.getUploadQueueStats(true)
  s.fact(`3000-row import written locally in one transaction: ${ms(localMs)}; upload queue ${queue.count} entries, ${kib(queue.size ?? 0)}`)
  const uploadStarted = performance.now()
  await settle(a1, 120_000)
  const entry = a1.connector.log.find((e) => e.ops === 3000)
  s.fact(
    `uploaded as ONE CrudTransaction of ${entry?.ops} ops in ${entry?.requests} HTTP requests ` +
      `(bulk insert of 1000-row chunks, the chunk with the bad row replayed row by row): ${ms(entry?.ms ?? 0)}; settled ${ms(performance.now() - uploadStarted)}`,
  )
  const [{ n }] = await serverRows<{ n: string }>('select count(*) as n from imported_transactions where import_batch_id = $1', [batch])
  s.expect(Number(n) === 2999, `not atomic: ${n} of 3000 rows of the single local transaction are on the server, the invalid one was rejected alone`)
  const local = await a1.db.get<{ n: number }>('select count(*) as n from imported_transactions where import_batch_id = ?', [batch])
  s.expect(local.n === 2999, 'locally the rejected row was reverted, the 2999 others stay')

  // Full restore: a whole 36-month document for a new user, one local transaction.
  const snapshot = syntheticSnapshot(seed + 1, 36, 90)
  const device = await openDevice('s8-restore', userD)
  await device.connect()
  await device.db.waitForFirstSync(AbortSignal.timeout(60_000))
  const restoreStarted = performance.now()
  let count = 0
  await device.db.writeTransaction(async (tx) => {
    for (const m of snapshot.months) {
      await tx.execute('insert into budget_months (id, year, month, name, created_at, edited_at) values (?, ?, ?, ?, ?, ?)', [m.id, m.year, m.month, m.name, m.createdAt, m.editedAt])
      count += 1
    }
    for (const r of snapshot.incomes) {
      await tx.execute('insert into budget_incomes (id, month_id, name, amount_cents, sort_order) values (?, ?, ?, ?, ?)', [r.id, r.monthId, r.name, r.amountCents, r.sortOrder])
      count += 1
    }
    for (const r of snapshot.accounts) {
      await tx.execute('insert into budget_accounts (id, month_id, name, planned_transfer_cents, sort_order) values (?, ?, ?, ?, ?)', [r.id, r.monthId, r.name, r.plannedTransferCents, r.sortOrder])
      count += 1
    }
    for (const r of snapshot.expenseCategories) {
      await tx.execute('insert into budget_expense_categories (id, month_id, account_id, name, sort_order) values (?, ?, ?, ?, ?)', [r.id, r.monthId, r.accountId, r.name, r.sortOrder])
      count += 1
    }
    for (const r of snapshot.expenseItems) {
      await tx.execute('insert into budget_expense_items (id, category_id, name, amount_cents, sort_order) values (?, ?, ?, ?, ?)', [r.id, r.categoryId, r.name, r.amountCents, r.sortOrder])
      count += 1
    }
    for (const t of snapshot.importedTransactions) {
      await tx.execute(
        `insert into imported_transactions (id, provider, source_key, source_reference, import_batch_id, source_file_name, booking_date,
           started_at, completed_at, description, amount_cents, fee_cents, balance_cents, currency, transaction_type, product, kind, category_id, imported_at)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [t.id, t.provider, t.sourceKey, t.sourceReference, t.importBatchId, t.sourceFileName, t.bookingDate, t.startedAt, t.completedAt,
          t.description, t.amountCents, t.feeCents, t.balanceCents, t.currency, t.transactionType, t.product, t.kind, t.categoryId, t.importedAt],
      )
      count += 1
    }
    await tx.execute('insert into user_settings (id, active_budget_month_id) values (?, ?)', [userD.id, snapshot.settings.activeBudgetMonthId])
    count += 1
  })
  const restoreLocalMs = performance.now() - restoreStarted
  const uploadRestoreStarted = performance.now()
  await settle(device, 180_000)
  const restoreEntry = device.connector.log.find((e) => e.ops === count)
  const [{ total }] = await serverRows<{ total: string }>(
    `select (select count(*) from budget_months where owner_id = $1) + (select count(*) from budget_incomes where owner_id = $1)
          + (select count(*) from budget_accounts where owner_id = $1) + (select count(*) from budget_expense_categories where owner_id = $1)
          + (select count(*) from budget_expense_items where owner_id = $1) + (select count(*) from imported_transactions where owner_id = $1)
          + (select count(*) from user_settings where owner_id = $1) as total`,
    [userD.id],
  )
  s.fact(
    `full restore of ${count} rows: local transaction ${ms(restoreLocalMs)}; upload ${restoreEntry?.requests} requests in ${ms(restoreEntry?.ms ?? 0)}; ` +
      `queue empty and checkpoint applied ${ms(performance.now() - uploadRestoreStarted)} after the write; ${total} rows on the server`,
  )
  s.expect(Number(total) === count && restoreEntry?.rejections.length === 0, 'the full restore reached Postgres complete, with no rejection')
  await device.close()
  return s
}

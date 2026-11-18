// Scenario 6: how Postgres types arrive in the client SQLite and go back up.
import { PowerSyncDatabase } from '@powersync/node'
import { DATA_DIR, RUN_ID, catchUp, nowIso, serverRows, settle, uuid, waitFor, type Device } from '../harness.ts'
import { AppSchema } from '../schema.ts'
import { Scenario } from '../report.ts'

const MAX_SAFE = 9_007_199_254_740_991

export async function typeMapping(a1: Device, a2: Device): Promise<Scenario> {
  const s = new Scenario('6', 'Type mapping and round trip')

  const monthId = uuid()
  const categoryId = uuid()
  const txId = uuid()
  const importedAt = '2031-02-28T10:11:12.345Z'
  await a1.db.writeTransaction(async (tx) => {
    await tx.execute('insert into budget_months (id, year, month, name, edited_at, created_at) values (?, 2031, 2, ?, ?, ?)', [
      monthId, 'Types', '2031-02-01T00:00:00.000Z', '2031-01-31T23:59:59.999Z',
    ])
    await tx.execute('insert into budget_expense_categories (id, month_id, name, sort_order) values (?, ?, ?, ?)', [categoryId, monthId, 'Types', 2_147_483_647])
    await tx.execute(
      `insert into imported_transactions (id, provider, source_key, source_reference, import_batch_id, source_file_name,
         booking_date, started_at, completed_at, description, amount_cents, fee_cents, balance_cents, currency,
         transaction_type, product, kind, category_id, imported_at)
       values (?, 'revolut-csv', ?, null, ?, 'types.csv', '2031-02-28', '2031-02-28 09:00:00', null, ?, ?, 0, ?, 'EUR', null, null, 'expense', ?, ?)`,
      // amount bound as a BigInt, balance as a plain JS number: see the precision check below.
      [txId, `types-${txId}`, uuid(), 'Ünïcödé — "quotes" and emoji 💶', BigInt(MAX_SAFE), -MAX_SAFE, categoryId, importedAt],
    )
  })
  await settle(a1)
  for (const r of await a1.db.getAll<{ op: string; table_name: string; code: string; message: string }>(
    'select op, table_name, code, message from upload_rejections where row_id in (?, ?, ?)', [monthId, categoryId, txId],
  )) {
    s.failures.push(`unexpected rejection ${r.op} ${r.table_name}: ${r.code} ${r.message}`)
  }

  const [server] = await serverRows<Record<string, string | null>>(
    `select t.amount_cents::text as amount, t.balance_cents::text as balance, t.booking_date::text as booking,
            t.imported_at::text as imported_pg, t.started_at, t.completed_at, t.description,
            c.sort_order::text as sort_order, m.created_at::text as created_pg, m.updated_at::text as updated_pg
       from imported_transactions t
       join budget_expense_categories c on c.id = t.category_id
       join budget_months m on m.id = c.month_id
      where t.id = $1`,
    [txId],
  )
  if (!server) {
    s.failures.push('the type-mapping rows did not reach Postgres')
    return s
  }
  s.expect(server.amount === String(MAX_SAFE), `bigint 2^53-1 bound as a JS BigInt reaches Postgres exactly (${server.amount})`)
  s.expect(
    server.balance === '-9007199254740990',
    `bigint -(2^53-1) bound as a plain JS number reaches Postgres as ${server.balance}: off by one, silently (the upload queue JSON holds it as a REAL)`,
  )
  s.fact(`Postgres text of timestamptz: imported_at=${server.imported_pg}, server-owned updated_at=${server.updated_pg}`)

  // A second client that only downloaded the rows.
  await catchUp(a2)
  await waitFor('types row on second client', async () => a2.db.getOptional('select id from imported_transactions where id = ?', [txId]))
  const row = await a2.db.get<Record<string, unknown>>(
    `select id, typeof(id) as t_id, amount_cents, typeof(amount_cents) as t_amount, balance_cents, fee_cents,
            booking_date, typeof(booking_date) as t_booking, imported_at, typeof(imported_at) as t_imported,
            started_at, completed_at, typeof(completed_at) as t_completed, source_reference, description, category_id
       from imported_transactions where id = ?`,
    [txId],
  )
  const month = await a2.db.get<Record<string, unknown>>('select created_at, updated_at, edited_at, year, typeof(year) as t_year from budget_months where id = ?', [monthId])
  const category = await a2.db.get<{ sort_order: unknown; t: string }>('select sort_order, typeof(sort_order) as t from budget_expense_categories where id = ?', [categoryId])
  s.fact(`client SQLite row: ${JSON.stringify(row)}`)
  s.fact(`client SQLite month: ${JSON.stringify(month)}; integer sort_order ${String(category.sort_order)} (${category.t})`)
  s.expect(row.t_id === 'text' && row.id === txId, 'uuid arrives as lowercase text, identical to the client-generated id')
  s.expect(row.t_amount === 'integer' && row.amount_cents === MAX_SAFE && typeof row.amount_cents === 'number', 'download: bigint 2^53-1 arrives as a SQLite integer and reads as an exact JS number')
  s.expect(row.booking_date === '2031-02-28' && row.t_booking === 'text', 'date arrives as text YYYY-MM-DD')
  s.expect(row.completed_at === null && row.t_completed === 'null' && row.source_reference === null, 'nullable text arrives as SQL NULL')
  s.expect(row.description === 'Ünïcödé — "quotes" and emoji 💶', 'unicode text survives the round trip')
  s.expect(row.imported_at === importedAt, `timestamptz written as toISOString() comes back byte-identical (${String(row.imported_at)}) with timestamp_max_precision: milliseconds`)
  const isoShape = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
  s.expect(isoShape.test(String(month.updated_at)), `server-owned updated_at (Postgres ${server.updated_pg}) arrives as ${String(month.updated_at)}: toISOString() shape, microseconds truncated`)
  s.expect(month.created_at === '2031-01-31T23:59:59.999Z', 'client-supplied created_at round trips unchanged')

  // Which integers bound as JS numbers survive the upload queue? Probed on a
  // throwaway database that is never connected, so nothing is uploaded.
  const probeDb = new PowerSyncDatabase({ schema: AppSchema, database: { dbFilename: `${RUN_ID}-s6-probe.db`, dbLocation: DATA_DIR } })
  await probeDb.init()
  const values: number[] = []
  for (let k = 0; k < 500; k += 1) values.push(MAX_SAFE - k)
  for (let k = 0; k < 2_000; k += 1) values.push(Math.floor(Math.random() * 1e11))
  for (let k = 0; k < 2_000; k += 1) values.push(Math.floor(Math.random() * 1e15))
  for (let k = 0; k < 2_000; k += 1) values.push(Math.floor(Math.random() * MAX_SAFE))
  await probeDb.writeTransaction(async (tx) => {
    for (const value of values) {
      await tx.execute('insert into budget_incomes (id, month_id, name, amount_cents, sort_order) values (uuid(), ?, ?, ?, 0)', [monthId, String(value), value])
    }
  })
  const probed = (await probeDb.getCrudBatch(values.length))?.crud ?? []
  await probeDb.close()
  const wrong = probed.filter((op) => op.opData?.amount_cents !== Number(op.opData?.name))
  const smallestWrong = Math.min(...wrong.map((op) => Number(op.opData?.name)))
  s.fact(
    `precision probe: ${values.length} integers bound as JS numbers; ${wrong.length} changed in the upload queue; ` +
      `smallest changed value ${smallestWrong}`,
  )
  s.expect(wrong.length > 0 && wrong.every((op) => Number(op.opData?.name) >= 1e15), 'integers below 1e15 (all budget amounts, max 1e11) survive as JS numbers; some 16-digit values change')

  // Upper-case uuid written by a client: does the id survive?
  const upper = uuid().toUpperCase()
  await a1.db.execute('insert into budget_months (id, year, month, name, edited_at) values (?, 2106, 1, ?, ?)', [upper, 'Upper-case id', nowIso()])
  await settle(a1)
  const ids = await a1.db.getAll<{ id: string }>('select id from budget_months where year = 2106 and month = 1')
  s.fact(`a month inserted locally with id ${upper} is, after sync, stored locally as ${JSON.stringify(ids.map((r) => r.id))}`)
  s.expect(ids.length === 1 && ids[0].id === upper.toLowerCase(), 'an upper-case uuid is replaced locally by its lower-case form after the round trip (the id changes; client ids must be lower-case)')

  // Going back up: edit one column on the second client.
  await a2.db.execute('update imported_transactions set description = ? where id = ?', ['Edited on client 2', txId])
  await settle(a2)
  const [after] = await serverRows<Record<string, string | null>>(
    'select amount_cents::text as amount, imported_at::text as imported_pg, description from imported_transactions where id = $1',
    [txId],
  )
  s.expect(after.amount === server.amount && after.imported_pg === server.imported_pg && after.description === 'Edited on client 2', 'a PATCH sends only the changed column: other values are untouched on the server')
  const last = a2.connector.log.at(-1)
  s.fact(`that PATCH upload: ${JSON.stringify({ ops: last?.ops, requests: last?.requests })}`)
  return s
}

export const DEFAULT_PRECISION_NOTE =
  'Without timestamp_max_precision, edition 3 sends Postgres timestamptz as YYYY-MM-DDTHH:mm:ss.ssssssZ (observed during setup: 2026-01-02T03:04:05.678000Z for a value written as 2026-01-02T03:04:05.678Z).'


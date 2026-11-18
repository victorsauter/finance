// Scenario 4: uploads the server rejects, and whether they block the queue.
import { catchUp, nowIso, openDevice, serverRows, settle, sleep, uuid, waitFor, type Device, type FetchGate } from '../harness.ts'
import { Scenario, ms } from '../report.ts'

export async function rejectedUploads(a1: Device): Promise<Scenario> {
  const s = new Scenario('4', 'Rejected uploads')
  const user = a1.user

  // A month and income that exist on the server.
  const monthId = uuid()
  const existingIncome = uuid()
  await a1.db.writeTransaction(async (tx) => {
    await tx.execute('insert into budget_months (id, year, month, name, edited_at) values (?, 2104, 1, ?, ?)', [monthId, 'Rejections', nowIso()])
    await tx.execute('insert into budget_incomes (id, month_id, name, amount_cents, sort_order) values (?, ?, ?, ?, 0)', [existingIncome, monthId, 'Existing', 1_000])
  })
  await settle(a1)
  const [{ created }] = await serverRows<{ created: string }>('select created_at::text as created from budget_incomes where id = $1', [existingIncome])

  await a1.disconnect()
  const negative = uuid()
  const validBefore = uuid()
  const duplicateMonth = uuid()
  const validAfter = uuid()
  // 1. check constraint: negative amount
  await a1.db.execute('insert into budget_incomes (id, month_id, name, amount_cents, sort_order) values (?, ?, ?, ?, 1)', [negative, monthId, 'Negative', -5])
  // 2. a valid write queued behind it
  await a1.db.execute('insert into budget_incomes (id, month_id, name, amount_cents, sort_order) values (?, ?, ?, ?, 2)', [validBefore, monthId, 'Valid before', 2_000])
  // 3. unique index: a second live month for (2104, 1)
  await a1.db.execute('insert into budget_months (id, year, month, name, edited_at) values (?, 2104, 1, ?, ?)', [duplicateMonth, 'Duplicate', nowIso()])
  // 4. update of a column without an update grant
  await a1.db.execute('update budget_incomes set created_at = ? where id = ?', ['2000-01-01T00:00:00.000Z', existingIncome])
  // 5. local hard delete (no delete grant, no delete policy)
  await a1.db.execute('delete from budget_incomes where id = ?', [existingIncome])
  // 6. another valid write
  await a1.db.execute('insert into budget_incomes (id, month_id, name, amount_cents, sort_order) values (?, ?, ?, ?, 3)', [validAfter, monthId, 'Valid after', 3_000])
  const queued = (await a1.db.getUploadQueueStats()).count
  s.fact(`queued ${queued} entries offline (each statement in its own transaction)`)

  const rejectionsBefore = (await a1.db.getAll('select id from upload_rejections')).length
  const started = performance.now()
  await a1.connect()
  await settle(a1)
  s.fact(`queue drained and checkpoint applied ${ms(performance.now() - started)} after reconnect`)

  const rejections = (
    await a1.db.getAll<{ table_name: string; op: string; code: string; message: string; row_id: string }>(
      'select table_name, op, code, message, row_id from upload_rejections order by rejected_at',
    )
  ).slice(rejectionsBefore)
  for (const r of rejections) s.fact(`rejected ${r.op} ${r.table_name}: ${r.code} "${r.message}"`)
  const codeFor = (rowId: string, op: string) => rejections.find((r) => r.row_id === rowId && r.op === op)?.code
  s.expect(codeFor(negative, 'PUT') === '23514', 'negative amount: PostgREST returns 23514 (check_violation)')
  s.expect(codeFor(duplicateMonth, 'PUT') === '23505', 'duplicate live month: 23505 (unique_violation on the partial index)')
  s.expect(codeFor(existingIncome, 'PATCH') === '42501', 'update of created_at: 42501 (no column grant)')
  s.expect(codeFor(existingIncome, 'DELETE') === '42501', 'local hard delete: 42501 (no delete grant)')

  const server = await serverRows<{ id: string }>('select id from budget_incomes where id = any($1)', [[validBefore, validAfter, negative]])
  s.expect(
    server.some((r) => r.id === validBefore) && server.some((r) => r.id === validAfter) && !server.some((r) => r.id === negative),
    'valid writes before and after the rejected ones reached Postgres: rejections do not block the queue with this connector',
  )
  const local = await a1.db.get<{ neg: number; dup: number; created: string | null; existing: number }>(
    `select (select count(*) from budget_incomes where id = ?) as neg,
            (select count(*) from budget_months where id = ?) as dup,
            (select created_at from budget_incomes where id = ?) as created,
            (select count(*) from budget_incomes where id = ?) as existing`,
    [negative, duplicateMonth, existingIncome, existingIncome],
  )
  s.expect(local.neg === 0 && local.dup === 0, 'rejected inserts disappeared from the local database at the next checkpoint')
  s.expect(local.existing === 1 && local.created?.startsWith(created.slice(0, 10)), 'the hard-deleted row came back locally and created_at was reverted to the server value')

  // Without handling: what the default "throw on error" does to the queue.
  const gate: FetchGate = { blocked: true }
  const flaky = await openDevice('s4-transient', user, { gate })
  await flaky.connect()
  await flaky.db.waitForFirstSync(AbortSignal.timeout(60_000))
  const transientId = uuid()
  await flaky.db.execute('insert into budget_incomes (id, month_id, name, amount_cents, sort_order) values (?, ?, ?, ?, 4)', [transientId, monthId, 'Transient', 4_000])
  await sleep(2_000)
  const status = flaky.db.currentStatus
  const attempts = flaky.connector.log.filter((e) => e.transientError).length
  s.expect(attempts >= 2 && (await flaky.db.getUploadQueueStats()).count === 1, `network failure: the connector threw, the SDK retried ${attempts} times in 2 s (retryDelayMs 500) and kept the write queued`)
  s.fact(`sync status during the outage: connected=${status.connected}, uploadError=${status.dataFlowStatus.uploadError?.message ?? 'none'}`)
  gate.blocked = false
  await settle(flaky)
  s.expect((await serverRows('select 1 from budget_incomes where id = $1', [transientId])).length === 1, 'after the network came back, the queued write landed')
  await flaky.close()

  // Upsert, as in the official Supabase demo connector, against these grants.
  const upserter = await openDevice('s4-upsert', user, { putMode: 'upsert' })
  await upserter.connect()
  await upserter.db.waitForFirstSync(AbortSignal.timeout(60_000))
  const upsertId = uuid()
  await upserter.db.execute('insert into budget_incomes (id, month_id, name, amount_cents, sort_order) values (?, ?, ?, ?, 5)', [upsertId, monthId, 'Upserted', 5_000])
  await settle(upserter)
  const upsertRejection = await upserter.db.getOptional<{ code: string; message: string }>('select code, message from upload_rejections where row_id = ?', [upsertId])
  s.expect(upsertRejection?.code === '42501', `PUT as upsert (demo connector) is rejected: ${upsertRejection?.code} "${upsertRejection?.message}"; plain insert is needed with these column grants`)
  await upserter.close()

  // Chosen handling for local hard deletes: translate them into soft deletes.
  const translator = await openDevice('s4-translate', user, { translateDeletes: true })
  await translator.connect()
  await translator.db.waitForFirstSync(AbortSignal.timeout(60_000))
  await translator.db.execute('delete from budget_incomes where id = ?', [validAfter])
  await settle(translator)
  const [soft] = await serverRows<{ deleted_at: Date | null }>('select deleted_at from budget_incomes where id = $1', [validAfter])
  const backLocally = await translator.db.getOptional<{ deleted_at: string | null }>('select deleted_at from budget_incomes where id = ?', [validAfter])
  s.expect(soft?.deleted_at && backLocally?.deleted_at, 'with translateDeletes, a local DELETE becomes deleted_at on the server and the row syncs back as soft-deleted')
  await translator.close()
  await catchUp(a1)
  await waitFor('a1 sees the soft delete', async () => (await a1.db.getOptional<{ d: string | null }>('select deleted_at as d from budget_incomes where id = ?', [validAfter]))?.d)
  return s
}

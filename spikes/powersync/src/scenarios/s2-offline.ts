// Scenario 2: offline writes, then reconnect.
import { catchUp, nowIso, serverRows, settle, uuid, waitFor, type Device } from '../harness.ts'
import { Scenario, ms } from '../report.ts'

export async function offlineWrites(a1: Device, a2: Device): Promise<Scenario> {
  const s = new Scenario('2', 'Offline write, then reconnect')
  const monthId = uuid()
  const incomeKeep = uuid()
  const incomeDrop = uuid()
  const accountId = uuid()
  const categoryId = uuid()
  const itemId = uuid()

  await a1.disconnect()
  s.expect(!a1.db.currentStatus.connected, 'writer is disconnected before writing')

  const writeStarted = performance.now()
  await a1.db.writeTransaction(async (tx) => {
    await tx.execute(
      'insert into budget_months (id, year, month, name, edited_at, created_at) values (?, 2101, 1, ?, ?, ?)',
      [monthId, 'Offline month', nowIso(), nowIso()],
    )
    await tx.execute(
      'insert into budget_incomes (id, month_id, name, amount_cents, sort_order) values (?, ?, ?, ?, ?), (?, ?, ?, ?, ?)',
      [incomeKeep, monthId, 'Salary', 100_000, 0, incomeDrop, monthId, 'Bonus', 5_000, 1],
    )
    await tx.execute(
      'insert into budget_accounts (id, month_id, name, planned_transfer_cents, sort_order) values (?, ?, ?, ?, ?)',
      [accountId, monthId, 'Joint', 40_000, 0],
    )
    await tx.execute(
      'insert into budget_expense_categories (id, month_id, account_id, name, sort_order) values (?, ?, ?, ?, ?)',
      [categoryId, monthId, accountId, 'Housing', 0],
    )
    await tx.execute(
      'insert into budget_expense_items (id, category_id, name, amount_cents, sort_order) values (?, ?, ?, ?, ?)',
      [itemId, categoryId, 'Rent', 90_000, 0],
    )
  })
  await a1.db.execute('update budget_incomes set amount_cents = ? where id = ?', [123_456, incomeKeep])
  await a1.db.execute('update budget_incomes set deleted_at = ? where id = ?', [nowIso(), incomeDrop])
  const localWriteMs = performance.now() - writeStarted

  const local = await a1.db.get<{ n: number; amount: number; dropped: string | null; owner: string | null; updated: string | null }>(
    `select (select count(*) from budget_incomes where month_id = ?) as n,
            (select amount_cents from budget_incomes where id = ?) as amount,
            (select deleted_at from budget_incomes where id = ?) as dropped,
            (select owner_id from budget_months where id = ?) as owner,
            (select updated_at from budget_months where id = ?) as updated`,
    [monthId, incomeKeep, incomeDrop, monthId, monthId],
  )
  s.expect(local.n === 2 && local.amount === 123_456 && local.dropped, `changes visible locally at once (${ms(localWriteMs)} for 3 local transactions)`)
  s.fact(`before upload the local month has owner_id=${local.owner} and updated_at=${local.updated} (server fills both)`)
  const queue = await a1.db.getUploadQueueStats(true)
  s.expect(queue.count === 8, `upload queue holds ${queue.count} entries (6 PUT + 2 PATCH expected), ${queue.size} bytes`)
  const onServer = await serverRows('select id from budget_months where id = $1', [monthId])
  s.expect(onServer.length === 0, 'nothing reached Postgres while disconnected')

  const reconnectStarted = performance.now()
  await a1.connect()
  await waitFor('month on the server', async () => (await serverRows('select 1 from budget_months where id = $1', [monthId])).length > 0)
  const toServerMs = performance.now() - reconnectStarted
  await settle(a1)
  const settledMs = performance.now() - reconnectStarted

  const [server] = await serverRows<{ amount: string; dropped: Date | null; owner: string; updated: string }>(
    `select i.amount_cents::text as amount, d.deleted_at as dropped, m.owner_id as owner,
            to_char(m.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as updated
       from budget_months m
       join budget_incomes i on i.id = $2
       join budget_incomes d on d.id = $3
      where m.id = $1`,
    [monthId, incomeKeep, incomeDrop],
  )
  s.expect(server?.amount === '123456' && server.dropped && server.owner === a1.user.id, 'Postgres has the edited amount, the soft delete and owner_id = the user')
  const back = await a1.db.get<{ owner: string; updated: string }>('select owner_id as owner, updated_at as updated from budget_months where id = ?', [monthId])
  s.expect(back.owner === a1.user.id && back.updated === server?.updated, `server-owned updated_at came back to the writer (${back.updated})`)
  s.fact(`reconnect to rows in Postgres: ${ms(toServerMs)}; reconnect to writer settled (queue empty and checkpoint applied): ${ms(settledMs)}`)
  s.fact(`connector log: ${JSON.stringify(a1.connector.log.slice(-3).map(({ ops, requests, ms: t }) => ({ ops, requests, ms: Math.round(t) })))}`)

  const otherStarted = performance.now()
  await catchUp(a2)
  const seen = await waitFor('second client to see the month', async () => {
    const row = await a2.db.getOptional<{ n: number; amount: number; dropped: string | null }>(
      `select (select count(*) from budget_incomes where month_id = ?) as n,
              (select amount_cents from budget_incomes where id = ?) as amount,
              (select deleted_at from budget_incomes where id = ?) as dropped`,
      [monthId, incomeKeep, incomeDrop],
    )
    return row && row.n === 2 && row.amount === 123_456 && row.dropped ? row : null
  })
  s.expect(seen, `second client of the same user received month, children, edit and soft delete (${ms(performance.now() - otherStarted)} after the writer settled)`)
  const children = await a2.db.get<{ n: number }>(
    `select (select count(*) from budget_accounts where id = ?) + (select count(*) from budget_expense_categories where id = ?)
          + (select count(*) from budget_expense_items where id = ?) as n`,
    [accountId, categoryId, itemId],
  )
  s.expect(children.n === 3, 'second client has the account, category and item')
  return s
}

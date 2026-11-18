// Scenario 3: concurrent offline edits from two clients of the same user.
// Both go offline, edit, then the first reconnects and settles, then the second.
// The upload order therefore decides "last write" on the server.
import { catchUp, nowIso, serverRows, settle, uuid, type Device } from '../harness.ts'
import { Scenario } from '../report.ts'

interface Fixture {
  monthId: string
  incomeA: string // (a) same row, same column
  incomeB: string // (b) same row, different columns
  itemC: string // (c) delete vs edit
}

async function createFixture(writer: Device, readers: Device[], year: number): Promise<Fixture> {
  const f: Fixture = { monthId: uuid(), incomeA: uuid(), incomeB: uuid(), itemC: uuid() }
  const categoryId = uuid()
  await writer.db.writeTransaction(async (tx) => {
    await tx.execute('insert into budget_months (id, year, month, name, edited_at) values (?, ?, 3, ?, ?)', [
      f.monthId, year, `Concurrent ${year}`, nowIso(),
    ])
    await tx.execute(
      'insert into budget_incomes (id, month_id, name, amount_cents, sort_order) values (?, ?, ?, ?, ?), (?, ?, ?, ?, ?)',
      [f.incomeA, f.monthId, 'Income A', 1_000, 0, f.incomeB, f.monthId, 'Income B', 2_000, 1],
    )
    await tx.execute('insert into budget_expense_categories (id, month_id, name, sort_order) values (?, ?, ?, ?)', [
      categoryId, f.monthId, 'Category', 0,
    ])
    await tx.execute('insert into budget_expense_items (id, category_id, name, amount_cents, sort_order) values (?, ?, ?, ?, ?)', [
      f.itemC, categoryId, 'Item C', 3_000, 0,
    ])
  })
  await settle(writer)
  for (const reader of readers) await catchUp(reader)
  return f
}

type Snapshot = Record<string, unknown>

async function localState(device: Device, f: Fixture, year: number): Promise<Snapshot> {
  const a = await device.db.getOptional<{ amount_cents: number }>('select amount_cents from budget_incomes where id = ?', [f.incomeA])
  const b = await device.db.getOptional<{ name: string; amount_cents: number }>('select name, amount_cents from budget_incomes where id = ?', [f.incomeB])
  const c = await device.db.getOptional<{ amount_cents: number; deleted_at: string | null }>(
    'select amount_cents, deleted_at from budget_expense_items where id = ?', [f.itemC],
  )
  const d = await device.db.getAll<{ id: string; name: string }>(
    'select id, name from budget_months where year = ? and month = 5 and deleted_at is null order by id', [year],
  )
  const dChildren = await device.db.getAll<{ name: string }>(
    'select i.name from budget_incomes i join budget_months m on m.id = i.month_id where m.year = ? and m.month = 5 order by i.name', [year],
  )
  const e = await device.db.getAll<{ name: string; sort_order: number }>(
    "select name, sort_order from budget_incomes where month_id = ? and name like 'Appended%' order by name", [f.monthId],
  )
  return {
    a: a?.amount_cents,
    b: b ? `${b.name}/${b.amount_cents}` : null,
    c: c ? `${c.amount_cents}/${c.deleted_at ? 'deleted' : 'live'}` : null,
    d: d.map((m) => m.name).join(','),
    dChildren: dChildren.map((r) => r.name).join(','),
    e: e.map((r) => `${r.name}@${r.sort_order}`).join(','),
  }
}

async function serverState(f: Fixture, year: number, owner: string): Promise<Snapshot> {
  const [a] = await serverRows<{ amount: string }>('select amount_cents::text as amount from budget_incomes where id = $1', [f.incomeA])
  const [b] = await serverRows<{ name: string; amount: string }>('select name, amount_cents::text as amount from budget_incomes where id = $1', [f.incomeB])
  const [c] = await serverRows<{ amount: string; deleted_at: Date | null }>(
    'select amount_cents::text as amount, deleted_at from budget_expense_items where id = $1', [f.itemC],
  )
  const d = await serverRows<{ name: string }>(
    'select name from budget_months where owner_id = $2 and year = $1 and month = 5 and deleted_at is null order by id', [year, owner],
  )
  const dChildren = await serverRows<{ name: string }>(
    `select i.name from budget_incomes i join budget_months m on m.id = i.month_id and m.owner_id = i.owner_id
      where m.owner_id = $2 and m.year = $1 and m.month = 5 order by i.name`, [year, owner],
  )
  const e = await serverRows<{ name: string; sort_order: number }>(
    "select name, sort_order from budget_incomes where month_id = $1 and name like 'Appended%' order by name", [f.monthId],
  )
  return {
    a: a ? Number(a.amount) : undefined,
    b: b ? `${b.name}/${b.amount}` : null,
    c: c ? `${c.amount}/${c.deleted_at ? 'deleted' : 'live'}` : null,
    d: d.map((m) => m.name).join(','),
    dChildren: dChildren.map((r) => r.name).join(','),
    e: e.map((r) => `${r.name}@${r.sort_order}`).join(','),
  }
}

async function offlineEdits(device: Device, label: 'first' | 'second', f: Fixture, year: number): Promise<void> {
  const isFirst = label === 'first'
  // (a) same row, same column
  await device.db.execute('update budget_incomes set amount_cents = ? where id = ?', [isFirst ? 1_111 : 2_222, f.incomeA])
  // (b) same row, different columns
  if (isFirst) await device.db.execute('update budget_incomes set name = ? where id = ?', ['Renamed by first', f.incomeB])
  else await device.db.execute('update budget_incomes set amount_cents = ? where id = ?', [2_500, f.incomeB])
  // (c) first soft-deletes, second edits
  if (isFirst) await device.db.execute('update budget_expense_items set deleted_at = ? where id = ?', [nowIso(), f.itemC])
  else await device.db.execute('update budget_expense_items set amount_cents = ? where id = ?', [3_333, f.itemC])
  // (d) both create the same (year, month 5) with different ids, plus a child income
  const monthId = uuid()
  await device.db.writeTransaction(async (tx) => {
    await tx.execute('insert into budget_months (id, year, month, name, edited_at) values (?, ?, 5, ?, ?)', [
      monthId, year, `May by ${label}`, nowIso(),
    ])
    await tx.execute('insert into budget_incomes (id, month_id, name, amount_cents, sort_order) values (?, ?, ?, ?, 0)', [
      uuid(), monthId, `Child of ${label}`, 700,
    ])
  })
  // (e) both append an income with the same sort_order
  await device.db.execute('insert into budget_incomes (id, month_id, name, amount_cents, sort_order) values (?, ?, ?, ?, 5)', [
    uuid(), f.monthId, `Appended by ${label}`, 900,
  ])
}

async function round(
  s: Scenario,
  first: Device,
  second: Device,
  year: number,
): Promise<{ server: Snapshot; first: Snapshot; second: Snapshot; rejections: Record<string, unknown[]> }> {
  const f = await createFixture(first, [second], year)
  await first.disconnect()
  await second.disconnect()
  const rejectionsBefore = {
    first: (await first.db.getAll('select id from upload_rejections')).length,
    second: (await second.db.getAll('select id from upload_rejections')).length,
  }
  await offlineEdits(first, 'first', f, year)
  await offlineEdits(second, 'second', f, year)
  s.fact(`[${year}] offline state, first: ${JSON.stringify(await localState(first, f, year))}`)
  s.fact(`[${year}] offline state, second: ${JSON.stringify(await localState(second, f, year))}`)

  await first.connect()
  await settle(first)
  await second.connect()
  await settle(second)
  await catchUp(first)

  const rejections: Record<string, unknown[]> = {}
  for (const [label, device] of [['first', first], ['second', second]] as const) {
    const rows = await device.db.getAll<{ table_name: string; op: string; code: string; message: string }>(
      'select table_name, op, code, message from upload_rejections order by rejected_at',
    )
    rejections[label] = rows.slice(rejectionsBefore[label]).map((r) => `${r.op} ${r.table_name}: ${r.code} ${r.message}`)
  }
  return {
    server: await serverState(f, year, first.user.id),
    first: await localState(first, f, year),
    second: await localState(second, f, year),
    rejections,
  }
}

export async function concurrentEdits(a1: Device, a2: Device, d1: Device, d2: Device): Promise<Scenario> {
  const s = new Scenario('3', 'Concurrent offline edits, same user, two clients')

  // Round 1: plain connector (per-column last write wins, as in the PowerSync docs).
  const lww = await round(s, a1, a2, 2102)
  s.fact(`[lww] server: ${JSON.stringify(lww.server)}`)
  s.fact(`[lww] first:  ${JSON.stringify(lww.first)}`)
  s.fact(`[lww] second: ${JSON.stringify(lww.second)}`)
  s.fact(`[lww] rejections recorded: ${JSON.stringify(lww.rejections)}`)
  const converged = JSON.stringify(lww.server) === JSON.stringify(lww.first) && JSON.stringify(lww.server) === JSON.stringify(lww.second)
  s.expect(converged, '[lww] server and both clients converge to the same state for (a) to (e)')
  s.expect(lww.server.a === 2_222, '(a) same column: the later upload wins (2222); the first edit (1111) is overwritten with no error or signal')
  s.expect(lww.server.b === 'Renamed by first/2500', '(b) different columns: both edits kept (PATCH carries only changed columns)')
  s.expect(lww.server.c === '3333/deleted', '(c) delete vs edit: row stays soft-deleted and the edit is applied to the deleted row, invisible to the user')
  s.expect(lww.server.d === 'May by first' && lww.server.dChildren === 'Child of first', '(d) same month twice: only the first upload exists; the second month and its child are gone')
  s.expect(
    (lww.rejections.second as string[]).some((r) => r.includes('budget_months_owner_year_month_live_key')) &&
      (lww.rejections.second as string[]).some((r) => r.includes('23503')),
    '(d) second client recorded 23505 on the partial unique index for the month and 23503 (foreign key) for its child income',
  )
  s.expect(lww.server.e === 'Appended by first@5,Appended by second@5', '(e) same sort_order: both incomes kept with sort_order 5 (no constraint), order is now ambiguous')

  // Round 2: compare-and-set connector using trackPrevious (conflict detection).
  const detect = await round(s, d1, d2, 2103)
  s.fact(`[detect] server: ${JSON.stringify(detect.server)}`)
  s.fact(`[detect] first:  ${JSON.stringify(detect.first)}`)
  s.fact(`[detect] second: ${JSON.stringify(detect.second)}`)
  s.fact(`[detect] rejections recorded: ${JSON.stringify(detect.rejections)}`)
  const convergedDetect =
    JSON.stringify(detect.server) === JSON.stringify(detect.first) && JSON.stringify(detect.server) === JSON.stringify(detect.second)
  s.expect(convergedDetect, '[detect] server and both clients converge')
  s.expect(detect.server.a === 1_111, '[detect] (a) the second write is rejected as CONFLICT and reverted; the first value (1111) stays')
  s.expect(detect.server.b === 'Renamed by first/2500', '[detect] (b) different columns still merge (no false conflict)')
  s.expect(detect.server.c === '3000/deleted', '[detect] (c) the edit on a row deleted meanwhile is rejected; the row stays deleted with its old amount')
  s.expect(
    (detect.rejections.second as string[]).filter((r) => r.includes('CONFLICT')).length === 2,
    '[detect] the second client holds 2 CONFLICT rejections the app could show',
  )
  return s
}

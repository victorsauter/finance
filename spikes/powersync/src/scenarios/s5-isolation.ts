// Scenario 5: user B never receives user A's rows and cannot write to them.
import { createHmac } from 'node:crypto'
import { readFileSync, existsSync } from 'node:fs'
import Database from 'better-sqlite3'
import { POWERSYNC_URL, localSupabase } from '../env.ts'
import { nowIso, openDevice, serverRows, settle, uuid, type Device, type TestUser } from '../harness.ts'
import { Scenario } from '../report.ts'
import { SYNCED_TABLES } from '../schema.ts'

function forgeHs256(sub: string): string {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url')
  const now = Math.floor(Date.now() / 1000)
  const body = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub, aud: 'authenticated', role: 'authenticated', iat: now, exp: now + 600 })}`
  const signature = createHmac('sha256', localSupabase().jwtSecret).update(body).digest('base64url')
  return `${body}.${signature}`
}

export async function isolation(userA: TestUser, userB: TestUser, a1: Device): Promise<Scenario> {
  const s = new Scenario('5', 'Isolation between users')
  const aMonth = await a1.db.get<{ id: string }>('select id from budget_months where deleted_at is null limit 1')
  const aIncome = await a1.db.get<{ id: string; amount_cents: number }>('select id, amount_cents from budget_incomes where deleted_at is null limit 1')

  const b1 = await openDevice('s5-b', userB)
  await b1.connect()
  await b1.db.waitForFirstSync(AbortSignal.timeout(60_000))
  const bMonth = uuid()
  await b1.db.execute('insert into budget_months (id, year, month, name, edited_at) values (?, 2105, 1, ?, ?)', [bMonth, 'B month', nowIso()])
  await settle(b1)

  // Inspect B's SQLite file directly, bypassing the SDK views, before B writes
  // anything that mentions A's ids.
  await b1.db.execute('pragma wal_checkpoint(truncate)')
  const raw = new Database(b1.file, { readonly: true, fileMustExist: true })
  const dataTables = raw.prepare("select name from sqlite_master where type = 'table' and name like 'ps_data__%'").all() as { name: string }[]
  let rowsTotal = 0
  let foreign = 0
  for (const { name } of dataTables) {
    for (const row of raw.prepare(`select data from "${name}"`).all() as { data: string }[]) {
      rowsTotal += 1
      const owner = (JSON.parse(row.data) as { owner_id?: string }).owner_id
      if (owner !== undefined && owner !== userB.id) foreign += 1
    }
  }
  const oplog = raw.prepare('select count(*) as n from ps_oplog').get() as { n: number }
  const buckets = raw.prepare('select name from ps_buckets').all() as { name: string }[]
  raw.close()
  s.fact(`B's SQLite: ${rowsTotal} rows in ${dataTables.length} ps_data__* tables, ${oplog.n} ps_oplog entries, buckets ${JSON.stringify(buckets.map((b) => b.name))}`)
  s.expect(foreign === 0, "no row in B's ps_data__* tables has another owner_id")
  let bytes = readFileSync(b1.file)
  if (existsSync(`${b1.file}-wal`)) bytes = Buffer.concat([bytes, readFileSync(`${b1.file}-wal`)])
  s.expect(!bytes.includes(Buffer.from(userA.id)) && !bytes.includes(Buffer.from(aMonth.id)), "neither A's user id nor A's month id appears anywhere in B's database file bytes")
  for (const table of SYNCED_TABLES) {
    const row = await b1.db.get<{ n: number }>(`select count(*) as n from ${table} where owner_id is not ? `, [userB.id])
    if (row.n > 0) s.failures.push(`${table} on B has ${row.n} rows not owned by B`)
  }

  // Attempts to write into A's data, each in its own transaction.
  const withAOwner = uuid()
  const pointingAtA = uuid()
  await b1.db.execute('insert into budget_incomes (id, owner_id, month_id, name, amount_cents, sort_order) values (?, ?, ?, ?, 1, 0)', [withAOwner, userA.id, bMonth, 'Carries A owner_id'])
  await b1.db.execute('insert into budget_incomes (id, month_id, name, amount_cents, sort_order) values (?, ?, ?, 1, 0)', [pointingAtA, aMonth.id, 'Points at A month'])
  await b1.db.execute('insert into budget_incomes (id, month_id, name, amount_cents, sort_order) values (?, ?, ?, 1, 0)', [aIncome.id, bMonth, 'Reuses A income id'])
  await settle(b1)
  const rejections = await b1.db.getAll<{ row_id: string; op: string; code: string; message: string }>('select row_id, op, code, message from upload_rejections')
  const codeFor = (id: string) => rejections.find((r) => r.row_id === id)?.code
  for (const r of rejections) s.fact(`B rejected ${r.op}: ${r.code} "${r.message}"`)
  s.expect(codeFor(withAOwner) === '42501', "insert carrying A's owner_id: 42501 (RLS with check)")
  s.expect(codeFor(pointingAtA) === '23503', "insert pointing at A's month: 23503 (composite owner-keyed foreign key)")
  s.expect(codeFor(aIncome.id) === 'ID_TAKEN', "insert reusing A's row id: 23505 on the primary key, then the update matches no visible row")
  s.fact("note: the 23505 on the primary key tells B that the id exists; uuids make this practically unguessable")

  const { data: updated, error: updateError } = await b1.supabase.from('budget_incomes').update({ amount_cents: 1 }).eq('id', aIncome.id).select('id')
  s.expect(!updateError && updated?.length === 0, "direct PostgREST update of A's row as B: no error, 0 rows (RLS hides it)")
  const { data: readA } = await b1.supabase.from('budget_incomes').select('id').eq('owner_id', userA.id)
  s.expect(readA?.length === 0, "direct PostgREST select of A's rows as B: 0 rows")
  const [afterA] = await serverRows<{ amount: string; owner: string }>('select amount_cents::text as amount, owner_id as owner from budget_incomes where id = $1', [aIncome.id])
  s.expect(afterA.owner === userA.id && Number(afterA.amount) === aIncome.amount_cents, "A's row is unchanged on the server")

  // Token checks against the PowerSync service itself.
  const probe = async (token: string) => {
    const response = await fetch(`${POWERSYNC_URL}/sync/stream`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ buckets: [], include_checksum: true, raw_data: true }),
      signal: AbortSignal.timeout(5_000),
    }).catch((error: unknown) => ({ status: -1, text: async () => String(error) }))
    const status = response.status
    if ('body' in response && response.body) await response.body.cancel().catch(() => undefined)
    return status
  }
  const forgedStatus = await probe(forgeHs256(userA.id))
  s.expect(forgedStatus === 401, `a token claiming sub = A, signed HS256 with the legacy local JWT secret, is refused by PowerSync (HTTP ${forgedStatus}); only the JWKS (ES256) keys are trusted`)
  const noneStatus = await probe('not-a-jwt')
  s.expect(noneStatus === 401, `a malformed token is refused (HTTP ${noneStatus})`)

  await b1.close()
  return s
}

// Scenario 7: sign-out and switching user on the same device (same SQLite file).
import { rmSync } from 'node:fs'
import path from 'node:path'
import { PowerSyncDatabase } from '@powersync/node'
import { SupabaseConnector } from '../connector.ts'
import { DATA_DIR, RUN_ID, nowIso, serverRows, signIn, uuid, waitFor, type TestUser } from '../harness.ts'
import { Scenario } from '../report.ts'
import { AppSchema, SYNCED_TABLES } from '../schema.ts'

async function openShared(name: string): Promise<PowerSyncDatabase> {
  const dbFilename = `${RUN_ID}-${name}.db`
  for (const suffix of ['', '-wal', '-shm']) rmSync(path.join(DATA_DIR, dbFilename + suffix), { force: true })
  const db = new PowerSyncDatabase({ schema: AppSchema, database: { dbFilename, dbLocation: DATA_DIR } })
  await db.init()
  return db
}

async function owners(db: PowerSyncDatabase): Promise<Record<string, number>> {
  const result: Record<string, number> = {}
  for (const table of SYNCED_TABLES) {
    for (const row of await db.getAll<{ owner_id: string | null; n: number }>(`select owner_id, count(*) as n from ${table} group by owner_id`)) {
      const key = row.owner_id ?? 'null'
      result[key] = (result[key] ?? 0) + row.n
    }
  }
  return result
}

const connectOptions = { crudUploadThrottleMs: 50, retryDelayMs: 500 }

export async function switchUser(userB: TestUser, userC: TestUser): Promise<Scenario> {
  const s = new Scenario('7', 'Sign-out and switching user on one device')
  const label = (counts: Record<string, number>) =>
    JSON.stringify(Object.fromEntries(Object.entries(counts).map(([k, v]) => [k === userB.id ? 'B' : k === userC.id ? 'C' : k, v])))

  // C owns one month so we can see whose data is on the device.
  const cClient = await signIn(userC)
  const cMonth = uuid()
  const { error: cError } = await cClient.from('budget_months').insert({ id: cMonth, year: 2107, month: 1, name: 'C month', edited_at: nowIso() })
  if (cError) throw new Error(cError.message)

  // A. Switching without clearing.
  const db = await openShared('s7-unsafe')
  await db.connect(new SupabaseConnector(await signIn(userB)), connectOptions)
  await db.waitForFirstSync(AbortSignal.timeout(60_000))
  s.fact(`[no clear] signed in as B: rows by owner ${label(await owners(db))}`)
  await db.disconnect()
  const pending = uuid()
  await db.execute('insert into budget_months (id, year, month, name, edited_at) values (?, 2107, 2, ?, ?)', [pending, 'Written by B, not uploaded', nowIso()])
  s.fact(`[no clear] B wrote a month offline; upload queue ${(await db.getUploadQueueStats()).count}`)
  await db.connect(new SupabaseConnector(await signIn(userC)), connectOptions)
  await waitFor('pending upload', async () => (await db.getUploadQueueStats()).count === 0)
  await waitFor('C rows', async () => (await owners(db))[userC.id] >= 2, 20_000).catch(() => undefined)
  const [leaked] = await serverRows<{ owner_id: string }>('select owner_id from budget_months where id = $1', [pending])
  s.expect(leaked?.owner_id === userC.id, "[no clear] B's pending write was uploaded with C's session and now belongs to C (owner_id defaults to auth.uid())")
  s.fact(`[no clear] after connecting as C: rows by owner ${label(await owners(db))}`)
  await db.close()

  // B. Signing out properly.
  const db2 = await openShared('s7-clear')
  await db2.connect(new SupabaseConnector(await signIn(userB)), connectOptions)
  await db2.waitForFirstSync(AbortSignal.timeout(60_000))
  await db2.disconnect()
  const lost = uuid()
  await db2.execute('insert into budget_months (id, year, month, name, edited_at) values (?, 2107, 3, ?, ?)', [lost, 'Pending at sign-out', nowIso()])
  await db2.execute("insert into upload_rejections (id, table_name, row_id, op, op_data, code, message, rejected_at) values (uuid(), 'x', 'x', 'PUT', '{}', 'X', 'local-only row', ?)", [nowIso()])
  const queueBefore = (await db2.getUploadQueueStats()).count
  s.fact(`[clear] before sign-out: ${queueBefore} pending upload(s); the app must warn or block sign-out while this is non-zero`)
  await db2.disconnectAndClear()
  const synced = await owners(db2)
  const localOnly = await db2.get<{ n: number }>('select count(*) as n from upload_rejections')
  const queueAfter = (await db2.getUploadQueueStats()).count
  const internal = await db2.get<{ buckets: number; oplog: number }>('select (select count(*) from ps_buckets) as buckets, (select count(*) from ps_oplog) as oplog')
  s.expect(Object.keys(synced).length === 0 && queueAfter === 0, 'disconnectAndClear() empties every synced table and the upload queue')
  s.expect(localOnly.n === 0, 'disconnectAndClear() also clears local-only tables by default (clearLocal: false keeps them)')
  s.fact(`[clear] after disconnectAndClear: ps_buckets ${internal.buckets}, ps_oplog ${internal.oplog}`)
  await db2.connect(new SupabaseConnector(await signIn(userC)), connectOptions)
  await db2.waitForFirstSync(AbortSignal.timeout(60_000))
  const afterC = await owners(db2)
  s.expect(afterC[userC.id] >= 1 && !afterC[userB.id], `after signing in as C on the same file: only C's rows (${label(afterC)})`)
  const lostOnServer = await serverRows('select 1 from budget_months where id = $1', [lost])
  s.expect(lostOnServer.length === 0, "the write pending at sign-out never reached the server: it is lost unless the app uploads or exports it first")
  await db2.close()
  return s
}

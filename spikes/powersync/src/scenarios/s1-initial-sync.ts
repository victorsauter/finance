// Scenario 1: initial sync of a realistic volume on a fresh client.
import {
  containerMemory,
  fileSizeBytes,
  memorySampler,
  openDevice,
  server,
  serverRows,
  waitFor,
  waitForReplication,
  type TestUser,
} from '../harness.ts'
import { Scenario, kib, ms } from '../report.ts'
import { SYNCED_TABLES } from '../schema.ts'
import { seedOwner, syntheticSnapshot } from '../seed.ts'

export const POWERSYNC_CONTAINER = 'finance-powersync-spike-powersync-1'

async function serverCounts(ownerId: string): Promise<Record<string, number>> {
  const counts: Record<string, number> = {}
  for (const table of SYNCED_TABLES) {
    const [row] = await serverRows<{ n: string }>(`select count(*) as n from public.${table} where owner_id = $1`, [ownerId])
    counts[table] = Number(row.n)
  }
  return counts
}

export async function initialSync(userA: TestUser, seed: number): Promise<Scenario> {
  const s = new Scenario('1', 'Initial sync of a realistic volume')
  s.data.idleMemoryBytes = containerMemory(POWERSYNC_CONTAINER)

  const snapshot = syntheticSnapshot(seed, 36, 90)
  const seedStarted = performance.now()
  const counts = await seedOwner(server(), userA.id, snapshot)
  const total = Object.values(counts).reduce((sum, n) => sum + n, 0)
  s.fact(`seeded user A with ${total} rows: ${JSON.stringify(counts)} (direct SQL, ${ms(performance.now() - seedStarted)})`)
  s.data.seedCounts = counts

  const replicationStarted = performance.now()
  await waitForReplication()
  s.fact(`PowerSync replication caught up ${ms(performance.now() - replicationStarted)} after the seed commit`)
  const [{ size }] = await serverRows<{ size: string }>("select pg_database_size('powersync_storage') as size")
  s.fact(`bucket storage database size after replication: ${kib(Number(size))}`)
  s.data.storageBytes = Number(size)

  const expected = await serverCounts(userA.id)
  const runs: { ms: number; bytes: number; peak: number }[] = []
  for (const run of [1, 2]) {
    const device = await openDevice(`s1-fresh-${run}`, userA)
    const sampler = memorySampler(POWERSYNC_CONTAINER)
    const started = performance.now()
    await device.connect()
    await device.db.waitForFirstSync(AbortSignal.timeout(120_000))
    const firstSyncMs = performance.now() - started
    await waitFor(
      'all rows locally',
      async () => {
        for (const table of SYNCED_TABLES) {
          const row = await device.db.get<{ n: number }>(`select count(*) as n from ${table}`)
          if (row.n !== expected[table]) return false
        }
        return true
      },
      60_000,
    )
    const allRowsMs = performance.now() - started
    const memory = await sampler.stop()
    await device.db.execute('pragma wal_checkpoint(truncate)')
    const bytes = fileSizeBytes(device.file)
    runs.push({ ms: allRowsMs, bytes, peak: memory.max })
    s.fact(
      `fresh client ${run}: waitForFirstSync ${ms(firstSyncMs)}, all ${total} rows readable ${ms(allRowsMs)}, ` +
        `SQLite file ${kib(bytes)}, service memory peak ${kib(memory.max)} over ${memory.count} samples`,
    )
    await device.close()
  }
  s.data.runs = runs
  s.fact(`service memory at idle before the sync: ${kib(s.data.idleMemoryBytes as number)}`)
  s.expect(runs.every((r) => r.ms < 60_000), 'first full sync completes in under 60 s on a fresh client')
  return s
}

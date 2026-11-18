// Runs every scenario against the local Supabase + PowerSync stack and prints
// one PASS/FAIL line per scenario with the observed facts. Exits non-zero on
// any failure. Results are also written to results/<run>.json (gitignored).
//
// Prerequisites: `npm run setup-db` and `npm run up` (see README).
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { POWERSYNC_URL, SPIKE_DIR, localSupabase } from './env.ts'
import {
  RUN_ID,
  closeAllDevices,
  closeServer,
  createUser,
  deleteCreatedUsers,
  memorySampler,
  openDevice,
  type Device,
} from './harness.ts'
import { Scenario, kib } from './report.ts'
import { POWERSYNC_CONTAINER, initialSync } from './scenarios/s1-initial-sync.ts'
import { offlineWrites } from './scenarios/s2-offline.ts'
import { concurrentEdits } from './scenarios/s3-concurrent.ts'
import { rejectedUploads } from './scenarios/s4-rejected.ts'
import { isolation } from './scenarios/s5-isolation.ts'
import { typeMapping, DEFAULT_PRECISION_NOTE } from './scenarios/s6-types.ts'
import { switchUser } from './scenarios/s7-switch-user.ts'
import { largeTransactions } from './scenarios/s8-large.ts'

async function guarded(id: string, title: string, run: () => Promise<Scenario>): Promise<Scenario> {
  try {
    return await run()
  } catch (error) {
    const s = new Scenario(id, title)
    s.error = error instanceof Error ? (error.stack ?? error.message) : String(error)
    return s
  }
}

async function main() {
  localSupabase()
  const probe = await fetch(`${POWERSYNC_URL}/probes/liveness`).catch(() => null)
  if (!probe?.ok) throw new Error(`PowerSync is not answering at ${POWERSYNC_URL}. Run npm run setup-db && npm run up.`)

  const seed = Number(RUN_ID.slice(-8))
  const userA = await createUser('a')
  const userB = await createUser('b')
  const userC = await createUser('c')
  const userD = await createUser('d')
  const results: Scenario[] = []
  const only = process.env.SCENARIOS?.split(',')
  const wanted = (id: string) => !only || only.includes(id)
  const memory = memorySampler(POWERSYNC_CONTAINER)
  const report = (s: Scenario) => {
    results.push(s)
    console.log(`${s.pass ? 'PASS' : 'FAIL'}  ${s.id}. ${s.title}`)
    for (const fact of s.facts) console.log(`        ${fact}`)
    for (const failure of s.failures) console.log(`   !!   expected: ${failure}`)
    if (s.error) console.log(`   !!   error: ${s.error}`)
  }

  try {
    if (wanted('1')) report(await guarded('1', 'Initial sync', () => initialSync(userA, seed)))

    const open = async (name: string, options = {}) => {
      const device = await openDevice(name, userA, options)
      await device.connect()
      await device.db.waitForFirstSync(AbortSignal.timeout(120_000))
      return device
    }
    let a1: Device | null = null
    let a2: Device | null = null
    try {
      a1 = await open('a1')
      a2 = await open('a2')
    } catch (error) {
      console.error('Could not open the shared clients of user A:', error)
    }
    if (a1 && a2) {
      const first = a1
      const second = a2
      if (wanted('2')) report(await guarded('2', 'Offline write, then reconnect', () => offlineWrites(first, second)))
      if (wanted('3')) report(
        await guarded('3', 'Concurrent offline edits', async () => {
          const d1 = await open('a3-detect', { conflictMode: 'detect' })
          const d2 = await open('a4-detect', { conflictMode: 'detect' })
          try {
            return await concurrentEdits(first, second, d1, d2)
          } finally {
            await d1.close()
            await d2.close()
          }
        }),
      )
      if (wanted('4')) report(await guarded('4', 'Rejected uploads', () => rejectedUploads(first)))
      if (wanted('5')) report(await guarded('5', 'Isolation between users', () => isolation(userA, userB, first)))
      if (wanted('6')) report(
        await guarded('6', 'Type mapping and round trip', async () => {
          const s = await typeMapping(first, second)
          s.fact(DEFAULT_PRECISION_NOTE)
          return s
        }),
      )
      if (wanted('8')) report(await guarded('8', 'Large local transactions', () => largeTransactions(first, userD, seed)))
    }
    if (wanted('7')) report(await guarded('7', 'Sign-out and switching user', () => switchUser(userB, userC)))
  } finally {
    const peak = await memory.stop()
    console.log(`PowerSync container memory over the whole run: min ${kib(peak.min)}, max ${kib(peak.max)} (${peak.count} docker stats samples)`)
    await closeAllDevices()
    if (process.env.KEEP_USERS !== '1') {
      const deleted = await deleteCreatedUsers()
      console.log(`Deleted ${deleted} synthetic users and their rows (set KEEP_USERS=1 to keep them).`)
    }
    await closeServer()
  }

  mkdirSync(path.join(SPIKE_DIR, 'results'), { recursive: true })
  const file = path.join(SPIKE_DIR, 'results', `${RUN_ID}.json`)
  writeFileSync(
    file,
    JSON.stringify(
      results.map(({ id, title, pass, facts, failures, error, data }) => ({ id, title, pass, facts, failures, error, data })),
      null,
      2,
    ),
  )
  const failed = results.filter((s) => !s.pass)
  console.log(`\n${results.length - failed.length}/${results.length} scenarios passed. Details: ${path.relative(process.cwd(), file)}`)
  process.exit(failed.length > 0 ? 1 : 0)
}

main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})

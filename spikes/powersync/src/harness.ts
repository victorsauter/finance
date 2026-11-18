// Test harness: synthetic users on the local Supabase auth, PowerSync clients
// (one SQLite file each, like separate devices), and a server-side view of the
// data through a direct Postgres connection used for verification only.
import { execFile, execFileSync } from 'node:child_process'
import { promisify } from 'node:util'
import { randomBytes, randomUUID } from 'node:crypto'
import { mkdirSync, rmSync, statSync, existsSync } from 'node:fs'
import path from 'node:path'
import { PowerSyncDatabase, type SyncStatus } from '@powersync/node'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import pg from 'pg'
import { SupabaseConnector, type ConnectorOptions } from './connector.ts'
import { SPIKE_DIR, localSupabase } from './env.ts'
import { AppSchema } from './schema.ts'

const execFileAsync = promisify(execFile)

export const DATA_DIR = path.join(SPIKE_DIR, 'data')
export const RUN_ID = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)

export interface TestUser {
  id: string
  email: string
  password: string
}

const createdUsers: TestUser[] = []

function adminClient(): SupabaseClient {
  const { apiUrl, serviceRoleKey } = localSupabase()
  return createClient(apiUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } })
}

export async function createUser(label: string): Promise<TestUser> {
  const email = `powersync-spike-${label}-${RUN_ID}@example.invalid`
  const password = randomBytes(16).toString('hex')
  const { data, error } = await adminClient().auth.admin.createUser({ email, password, email_confirm: true })
  if (error || !data.user) throw new Error(`createUser ${email}: ${error?.message}`)
  const user = { id: data.user.id, email, password }
  createdUsers.push(user)
  return user
}

/** Deletes the synthetic users; their rows go with them (on delete cascade). */
export async function deleteCreatedUsers(): Promise<number> {
  const admin = adminClient()
  let count = 0
  for (const user of createdUsers.splice(0)) {
    const { error } = await admin.auth.admin.deleteUser(user.id)
    if (!error) count += 1
  }
  return count
}

/** When `blocked` is true, REST (PostgREST) calls fail like a network error. */
export interface FetchGate {
  blocked: boolean
}

/** A supabase-js client signed in as the user (one per simulated device). */
export async function signIn(user: TestUser, gate?: FetchGate): Promise<SupabaseClient> {
  const { apiUrl, anonKey } = localSupabase()
  const gatedFetch: typeof fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (gate?.blocked && url.includes('/rest/v1/')) return Promise.reject(new TypeError('fetch failed (simulated)'))
    return fetch(input, init)
  }
  const client = createClient(apiUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: gatedFetch },
  })
  const { error } = await client.auth.signInWithPassword({ email: user.email, password: user.password })
  if (error) throw new Error(`signIn ${user.email}: ${error.message}`)
  return client
}

export interface Device {
  name: string
  user: TestUser
  db: PowerSyncDatabase
  connector: SupabaseConnector
  supabase: SupabaseClient
  file: string
  connect(): Promise<void>
  disconnect(): Promise<void>
  close(): Promise<void>
}

const openDevices: Device[] = []

export async function openDevice(
  name: string,
  user: TestUser,
  options: ConnectorOptions & { gate?: FetchGate } = {},
): Promise<Device> {
  mkdirSync(DATA_DIR, { recursive: true })
  const dbFilename = `${RUN_ID}-${name}.db`
  const file = path.join(DATA_DIR, dbFilename)
  for (const suffix of ['', '-wal', '-shm']) rmSync(file + suffix, { force: true })
  const supabase = await signIn(user, options.gate)
  const db = new PowerSyncDatabase({ schema: AppSchema, database: { dbFilename, dbLocation: DATA_DIR } })
  await db.init()
  const connector = new SupabaseConnector(supabase, options)
  const device: Device = {
    name,
    user,
    db,
    connector,
    supabase,
    file,
    connect: () =>
      db.connect(connector, { crudUploadThrottleMs: 50, retryDelayMs: 500, checkpointMode: 'requests' }),
    disconnect: () => db.disconnect(),
    close: async () => {
      await db.close()
      const index = openDevices.indexOf(device)
      if (index >= 0) openDevices.splice(index, 1)
    },
  }
  openDevices.push(device)
  return device
}

export async function closeAllDevices(): Promise<void> {
  for (const device of [...openDevices]) await device.close().catch(() => undefined)
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Polls until `check` returns a truthy value or the timeout elapses. */
export async function waitFor<T>(
  what: string,
  check: () => Promise<T | undefined | null | false>,
  timeoutMs = 20_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs
  let last: unknown
  while (Date.now() < deadline) {
    try {
      const value = await check()
      if (value) return value
    } catch (error) {
      last = error
    }
    await sleep(100)
  }
  throw new Error(`Timed out waiting for ${what}${last ? ` (last error: ${String(last)})` : ''}`)
}

export async function waitForConnected(device: Device): Promise<void> {
  await device.db.waitForStatus((status: SyncStatus) => status.connected && status.hasSynced, AbortSignal.timeout(30_000))
}

/**
 * Waits until the upload queue is empty and the local database has applied a
 * server checkpoint that includes those uploads (checkpoint requests, alpha API).
 */
export async function settle(device: Device, timeoutMs = 30_000): Promise<void> {
  await waitFor(`${device.name} upload queue to drain`, async () => (await device.db.getUploadQueueStats()).count === 0, timeoutMs)
  const checkpoint = await device.db.requestCheckpoint()
  await checkpoint.waitForSync({ signal: AbortSignal.timeout(timeoutMs) })
}

/** A checkpoint wait without uploads (for a device that only reads). */
export async function catchUp(device: Device, timeoutMs = 30_000): Promise<void> {
  const checkpoint = await device.db.requestCheckpoint()
  await checkpoint.waitForSync({ signal: AbortSignal.timeout(timeoutMs) })
}

export function fileSizeBytes(file: string): number {
  let total = 0
  for (const suffix of ['', '-wal']) {
    if (existsSync(file + suffix)) total += statSync(file + suffix).size
  }
  return total
}

// ---------------------------------------------------------------------------
// Server-side verification (direct Postgres, bypasses RLS: verification only)
// ---------------------------------------------------------------------------

let pool: pg.Pool | null = null
export function server(): pg.Pool {
  pool ??= new pg.Pool({ connectionString: localSupabase().dbUrl, max: 4 })
  return pool
}

export async function serverRows<T extends pg.QueryResultRow = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  return (await server().query<T>(sql, params)).rows
}

export async function closeServer(): Promise<void> {
  await pool?.end()
  pool = null
}

export const uuid = randomUUID

export function nowIso(): string {
  return new Date().toISOString()
}

/** Waits until PowerSync's replication slot has confirmed the current WAL position. */
export async function waitForReplication(timeoutMs = 60_000): Promise<void> {
  const [{ lsn }] = await serverRows<{ lsn: string }>('select pg_current_wal_lsn()::text as lsn')
  await waitFor(
    'replication to catch up',
    async () => {
      const rows = await serverRows<{ done: boolean }>(
        `select confirmed_flush_lsn >= $1::pg_lsn as done from pg_replication_slots
         where slot_name like 'powersync%' and active`,
        [lsn],
      )
      return rows.length > 0 && rows.every((row) => row.done)
    },
    timeoutMs,
  )
}

/** Samples `docker stats` memory of one container about once a second. */
export function memorySampler(container: string) {
  const samples: number[] = []
  let stopped = false
  const loop = (async () => {
    while (!stopped) {
      try {
        const { stdout: out } = await execFileAsync('docker', ['stats', '--no-stream', '--format', '{{.MemUsage}}', container])
        samples.push(parseMemory(out.split('/')[0].trim()))
      } catch {
        // container gone: ignore
      }
      await sleep(500)
    }
  })()
  return {
    samples,
    async stop() {
      stopped = true
      await loop
      return { max: Math.max(...samples), min: Math.min(...samples), count: samples.length }
    },
  }
}

export function parseMemory(text: string): number {
  const match = /([\d.]+)\s*([KMG]i?B|B)/.exec(text)
  if (!match) return Number.NaN
  const factor: Record<string, number> = { B: 1, KiB: 1024, MiB: 1024 ** 2, GiB: 1024 ** 3, kB: 1e3, MB: 1e6, GB: 1e9 }
  return Number(match[1]) * (factor[match[2]] ?? 1)
}

export function containerMemory(container: string): number {
  const out = execFileSync('docker', ['stats', '--no-stream', '--format', '{{.MemUsage}}', container], { encoding: 'utf8' })
  return parseMemory(out.split('/')[0].trim())
}

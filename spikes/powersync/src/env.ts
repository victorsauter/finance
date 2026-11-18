// Reads the local Supabase settings at runtime from `supabase status`, so no key
// or secret is ever written to a committed file. Refuses anything that is not
// on this machine.
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

export const SPIKE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const REPO_ROOT = path.resolve(SPIKE_DIR, '..', '..')

export const POWERSYNC_URL = process.env.POWERSYNC_URL ?? 'http://127.0.0.1:8080'

export interface LocalSupabase {
  apiUrl: string
  dbUrl: string
  anonKey: string
  serviceRoleKey: string
  /** Legacy HS256 secret, used only to forge a token PowerSync must reject. */
  jwtSecret: string
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])

/** Throws unless the URL points at this machine. */
export function assertLocal(url: string, what: string): void {
  const host = new URL(url).hostname
  if (!LOCAL_HOSTS.has(host)) {
    throw new Error(`Refusing to use ${what} on non-local host "${host}". This spike is local only.`)
  }
}

let cached: LocalSupabase | null = null

export function localSupabase(): LocalSupabase {
  if (cached) return cached
  const output = execFileSync('npx', ['--yes', 'supabase@latest', 'status', '-o', 'env'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  })
  const values = new Map<string, string>()
  for (const line of output.split('\n')) {
    const match = /^([A-Z_]+)="?(.*?)"?$/.exec(line.trim())
    if (match) values.set(match[1], match[2])
  }
  const read = (name: string) => {
    const value = values.get(name)
    if (!value) throw new Error(`supabase status did not print ${name}. Is the local stack running?`)
    return value
  }
  const result: LocalSupabase = {
    apiUrl: read('API_URL'),
    dbUrl: read('DB_URL'),
    anonKey: read('ANON_KEY'),
    serviceRoleKey: read('SERVICE_ROLE_KEY'),
    jwtSecret: read('JWT_SECRET'),
  }
  assertLocal(result.apiUrl, 'the Supabase API')
  assertLocal(result.dbUrl, 'the Supabase database')
  assertLocal(POWERSYNC_URL, 'the PowerSync service')
  cached = result
  return result
}

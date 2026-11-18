import { readFileSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'

export interface SupabaseConfig {
  url: string
  publishableKey: string
}

export const DEFAULT_NETLIFY_TOML = path.resolve(
  import.meta.dirname,
  '../../../netlify.toml',
)

/** Reads `KEY = "value"` from the production context of netlify.toml. */
export function parseNetlifyProduction(toml: string): Partial<Record<string, string>> {
  const values: Record<string, string> = {}
  let inProduction = false
  for (const raw of toml.split('\n')) {
    const line = raw.trim()
    if (line.startsWith('[')) {
      inProduction = line === '[context.production.environment]'
      continue
    }
    if (!inProduction) continue
    const match = /^([A-Z0-9_]+)\s*=\s*"([^"]*)"/.exec(line)
    if (match) values[match[1]!] = match[2]!
  }
  return values
}

/**
 * Public Supabase settings: environment first, then netlify.toml. These are
 * publishable browser values, never an admin key.
 */
export function loadSupabaseConfig(
  env: NodeJS.ProcessEnv = process.env,
  readToml: () => string = () => readFileSync(DEFAULT_NETLIFY_TOML, 'utf8'),
): SupabaseConfig {
  let url = env.VITE_SUPABASE_URL
  let publishableKey = env.VITE_SUPABASE_PUBLISHABLE_KEY
  if (!url || !publishableKey) {
    let fromToml: Partial<Record<string, string>> = {}
    try {
      fromToml = parseNetlifyProduction(readToml())
    } catch {
      // Reported below.
    }
    url ||= fromToml.VITE_SUPABASE_URL
    publishableKey ||= fromToml.VITE_SUPABASE_PUBLISHABLE_KEY
  }
  if (!url || !publishableKey) {
    throw new Error(
      'Supabase settings are missing: set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY, or keep them in netlify.toml.',
    )
  }
  if (publishableKey.startsWith('sb_secret_')) {
    throw new Error('Refusing a Supabase secret key: only the publishable key is allowed.')
  }
  return { url, publishableKey }
}

export const MAX_CHANGES_PER_CALL = 200
export const BACKUPS_TO_KEEP = 30

export function backupDirectory(env: NodeJS.ProcessEnv = process.env): string {
  return (
    env.FINANCE_MCP_BACKUP_DIR ||
    path.join(os.homedir(), 'Library', 'Application Support', 'Finance', 'mcp-backups')
  )
}

export function isReadOnly(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = env.FINANCE_MCP_READ_ONLY?.trim().toLowerCase()
  return value === '1' || value === 'true' || value === 'yes'
}

export function keychainService(env: NodeJS.ProcessEnv = process.env): string {
  return env.FINANCE_MCP_KEYCHAIN_SERVICE || 'finance-mcp'
}

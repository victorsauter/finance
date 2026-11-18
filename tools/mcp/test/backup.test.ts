// @vitest-environment node
import { readdir } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BackupStore } from '../src/backup.ts'
import { backupDirectory, isReadOnly, keychainService, loadSupabaseConfig, parseNetlifyProduction } from '../src/config.ts'
import { sampleData, temporaryDirectory } from './support.ts'

describe('BackupStore', () => {
  let temp: Awaited<ReturnType<typeof temporaryDirectory>>
  beforeEach(async () => { temp = await temporaryDirectory() })
  afterEach(() => temp.cleanup())

  it('keeps the newest 30 backups and lists them newest first', async () => {
    let time = Date.parse('2026-11-18T10:00:00.000Z')
    const store = new BackupStore(temp.directory, { clock: () => new Date((time += 1000)) })
    const data = sampleData()
    for (let revision = 1; revision <= 33; revision += 1) await store.save(data, revision, 'test')
    const files = await readdir(temp.directory)
    expect(files).toHaveLength(30)
    const listed = await store.list()
    expect(listed[0]!.revision).toBe(33)
    expect(listed.at(-1)!.revision).toBe(4)
    expect(listed[0]!.savedAt).toBe('2026-11-18T10:00:33.000Z')
    expect((await store.read(listed[0]!.file)).data).toEqual(data)
  })

  it('lists nothing when the folder does not exist yet', async () => {
    expect(await new BackupStore(path.join(temp.directory, 'missing')).list()).toEqual([])
  })
})

describe('config', () => {
  const toml = `
[context.production.environment]
  VITE_SUPABASE_URL = "https://example.supabase.co"
  VITE_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_example"
[context.deploy-preview.environment]
  VITE_SUPABASE_URL = ""
`

  it('reads the production values of netlify.toml, env first', () => {
    expect(parseNetlifyProduction(toml)).toEqual({
      VITE_SUPABASE_URL: 'https://example.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_example',
    })
    expect(loadSupabaseConfig({}, () => toml)).toEqual({ url: 'https://example.supabase.co', publishableKey: 'sb_publishable_example' })
    expect(loadSupabaseConfig({ VITE_SUPABASE_URL: 'https://other.example', VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_x' }, () => toml).url)
      .toBe('https://other.example')
    expect(() => loadSupabaseConfig({}, () => '')).toThrow(/missing/)
    expect(() => loadSupabaseConfig({ VITE_SUPABASE_URL: 'https://x', VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_secret_x' })).toThrow(/secret/)
  })

  it('reads the switches', () => {
    expect(isReadOnly({ FINANCE_MCP_READ_ONLY: '1' })).toBe(true)
    expect(isReadOnly({})).toBe(false)
    expect(backupDirectory({ FINANCE_MCP_BACKUP_DIR: '/tmp/x' })).toBe('/tmp/x')
    expect(keychainService({})).toBe('finance-mcp')
  })
})

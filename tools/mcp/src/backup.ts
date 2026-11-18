import { chmod, mkdir, readFile, readdir, stat, unlink, writeFile } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import path from 'node:path'
import type { AppData } from '../../../src/domain/budget/models.ts'
import { parseAppData } from '../../../src/domain/budget/schema.ts'
import { BACKUPS_TO_KEEP } from './config.ts'
import { ToolError } from './helpers.ts'

/** finance-2026-11-18T10-20-30-123Z-r12-1a2b3c.json: sorts chronologically. */
const NAME = /^finance-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-r\d+-[0-9a-f]{6}\.json$/

export interface BackupFile {
  savedAt: string
  revision: number
  reason: string
  data: AppData
}

export interface BackupInfo {
  file: string
  savedAt: string
  revision: number
  sizeBytes: number
}

/**
 * Local JSON copies of the document taken just before each write, so a bad
 * change made through the MCP server can be undone with restore_backup.
 */
export class BackupStore {
  readonly directory: string
  private keep: number
  private clock: () => Date

  constructor(directory: string, options: { keep?: number; clock?: () => Date } = {}) {
    this.directory = directory
    this.keep = options.keep ?? BACKUPS_TO_KEEP
    this.clock = options.clock ?? (() => new Date())
  }

  /** Writes the backup (0600 in a 0700 folder) and prunes old ones. Throws on failure. */
  async save(data: AppData, revision: number, reason: string): Promise<string> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 })
    await chmod(this.directory, 0o700)
    const savedAt = this.clock().toISOString()
    const file = `finance-${savedAt.replace(/[:.]/g, '-')}-r${revision}-${randomBytes(3).toString('hex')}.json`
    const content: BackupFile = { savedAt, revision, reason, data }
    await writeFile(path.join(this.directory, file), `${JSON.stringify(content, null, 2)}\n`, {
      mode: 0o600,
      flag: 'wx',
    })
    await this.prune()
    return file
  }

  private async names(): Promise<string[]> {
    try {
      return (await readdir(this.directory)).filter((name) => NAME.test(name)).sort()
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
  }

  async prune() {
    const names = await this.names()
    for (const name of names.slice(0, Math.max(names.length - this.keep, 0))) {
      await unlink(path.join(this.directory, name))
    }
  }

  /** Newest first. */
  async list(): Promise<BackupInfo[]> {
    const names = (await this.names()).reverse()
    return Promise.all(names.map(async (file) => {
      const full = path.join(this.directory, file)
      const info = await stat(full)
      const revision = Number(/-r(\d+)-/.exec(file)?.[1])
      const stamp = /^finance-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z/.exec(file)!
      return {
        file,
        savedAt: `${stamp[1]}T${stamp[2]}:${stamp[3]}:${stamp[4]}.${stamp[5]}Z`,
        revision,
        sizeBytes: info.size,
      }
    }))
  }

  /** Reads and validates one backup, by bare file name inside the backup folder only. */
  async read(file: string): Promise<BackupFile> {
    if (file !== path.basename(file) || !NAME.test(file)) {
      throw new ToolError('Give the bare file name of a backup, as list_backups shows it.')
    }
    let raw: string
    try {
      raw = await readFile(path.join(this.directory, file), 'utf8')
    } catch {
      throw new ToolError(`No backup named ${file}. Use list_backups.`)
    }
    let parsed: Partial<BackupFile>
    try {
      parsed = JSON.parse(raw) as Partial<BackupFile>
    } catch {
      throw new ToolError(`${file} is not valid JSON.`)
    }
    let data: AppData
    try {
      data = parseAppData(parsed.data)
    } catch (error) {
      throw new ToolError(`${file} does not contain a valid finance document: ${firstIssue(error)}`)
    }
    return {
      savedAt: String(parsed.savedAt ?? ''),
      revision: Number(parsed.revision ?? 0),
      reason: String(parsed.reason ?? ''),
      data,
    }
  }
}

export function firstIssue(error: unknown): string {
  const issues = (error as { issues?: Array<{ path: PropertyKey[]; message: string }> }).issues
  if (issues?.[0]) return `${issues[0].path.map(String).join('.')}: ${issues[0].message}`
  return error instanceof Error ? error.message : String(error)
}

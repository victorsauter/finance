import { execFile } from 'node:child_process'

export interface ExecResult {
  code: number
  stdout: string
  stderr: string
}

/** Runs a program with an argument array (never a shell) and optional stdin. */
export type ExecFn = (file: string, args: string[], input?: string) => Promise<ExecResult>

export const runCommand: ExecFn = (file, args, input) =>
  new Promise((resolve, reject) => {
    const child = execFile(file, args, { encoding: 'utf8' }, (error, stdout, stderr) => {
      if (error && typeof error.code !== 'number') {
        reject(error)
        return
      }
      resolve({ code: error ? Number(error.code) : 0, stdout, stderr })
    })
    child.stdin?.end(input ?? '')
  })

export interface StoredSession {
  userId: string
  refreshToken: string
}

/** `security` exit status when the item does not exist. */
const NOT_FOUND = 44
const ACCOUNT = 'default'
const SECURITY = '/usr/bin/security'

/** base64url keeps the stored value free of quotes and spaces. */
function encode(session: StoredSession): string {
  return Buffer.from(JSON.stringify(session), 'utf8').toString('base64url')
}

function decode(value: string): StoredSession | null {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value.trim(), 'base64url').toString('utf8'))
    if (
      parsed && typeof parsed === 'object' &&
      typeof (parsed as StoredSession).userId === 'string' &&
      typeof (parsed as StoredSession).refreshToken === 'string' &&
      (parsed as StoredSession).refreshToken.length > 0
    ) {
      return { userId: (parsed as StoredSession).userId, refreshToken: (parsed as StoredSession).refreshToken }
    }
  } catch {
    // Treated as no session.
  }
  return null
}

const SAFE = /^[A-Za-z0-9._-]+$/

/**
 * The Supabase session in the macOS login Keychain, through the `security`
 * command line tool (no native dependency). The secret is written through
 * `security -i` on stdin, so it never appears in a process argument list.
 */
export class Keychain {
  private exec: ExecFn
  readonly service: string

  constructor(service: string, exec: ExecFn = runCommand) {
    if (!SAFE.test(service)) throw new Error('Invalid Keychain service name.')
    this.service = service
    this.exec = exec
  }

  async load(): Promise<StoredSession | null> {
    const result = await this.exec(SECURITY, [
      'find-generic-password', '-s', this.service, '-a', ACCOUNT, '-w',
    ])
    if (result.code === NOT_FOUND) return null
    if (result.code !== 0) throw new Error(`Keychain read failed: ${result.stderr.trim()}`)
    return decode(result.stdout)
  }

  async save(session: StoredSession): Promise<void> {
    const value = encode(session)
    // Every interpolated value is restricted to [A-Za-z0-9._-]: no quoting issue.
    if (!SAFE.test(value)) throw new Error('Unexpected characters in the session.')
    const command = `add-generic-password -U -s "${this.service}" -a "${ACCOUNT}" -l "Finance MCP session" -w "${value}"\n`
    const result = await this.exec(SECURITY, ['-i'], command)
    if (result.code !== 0 || /error|returned -/i.test(result.stderr)) {
      throw new Error(`Keychain write failed: ${result.stderr.trim()}`)
    }
  }

  /** Returns false when there was nothing to delete. */
  async remove(): Promise<boolean> {
    const result = await this.exec(SECURITY, [
      'delete-generic-password', '-s', this.service, '-a', ACCOUNT,
    ])
    if (result.code === NOT_FOUND) return false
    if (result.code !== 0) throw new Error(`Keychain delete failed: ${result.stderr.trim()}`)
    return true
  }
}

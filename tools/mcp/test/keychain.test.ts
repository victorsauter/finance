// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { Keychain, type ExecFn } from '../src/keychain.ts'

function fakeSecurity(responses: Array<{ code: number; stdout?: string; stderr?: string }>) {
  const calls: Array<{ file: string; args: string[]; input?: string }> = []
  const exec: ExecFn = async (file, args, input) => {
    calls.push({ file, args, input })
    const next = responses.shift() ?? { code: 0 }
    return { code: next.code, stdout: next.stdout ?? '', stderr: next.stderr ?? '' }
  }
  return { exec, calls }
}

describe('Keychain', () => {
  it('saves through security -i on stdin, never in argv, and loads it back', async () => {
    const { exec, calls } = fakeSecurity([{ code: 0 }])
    const keychain = new Keychain('finance-mcp-test', exec)
    await keychain.save({ userId: 'user-1', refreshToken: 'secret-token' })
    expect(calls[0]!.file).toBe('/usr/bin/security')
    expect(calls[0]!.args).toEqual(['-i'])
    expect(calls[0]!.args.join(' ')).not.toContain('secret')
    const stored = /-w "([^"]+)"/.exec(calls[0]!.input!)![1]!
    expect(calls[0]!.input).toMatch(/^add-generic-password -U -s "finance-mcp-test" -a "default"/)

    const reader = fakeSecurity([{ code: 0, stdout: `${stored}\n` }])
    const loaded = await new Keychain('finance-mcp-test', reader.exec).load()
    expect(loaded).toEqual({ userId: 'user-1', refreshToken: 'secret-token' })
    expect(reader.calls[0]!.args).toEqual(['find-generic-password', '-s', 'finance-mcp-test', '-a', 'default', '-w'])
  })

  it('treats a missing item as no session and removes it', async () => {
    const { exec, calls } = fakeSecurity([{ code: 44 }, { code: 0 }, { code: 44 }])
    const keychain = new Keychain('finance-mcp-test', exec)
    expect(await keychain.load()).toBeNull()
    expect(await keychain.remove()).toBe(true)
    expect(await keychain.remove()).toBe(false)
    expect(calls[1]!.args).toEqual(['delete-generic-password', '-s', 'finance-mcp-test', '-a', 'default'])
  })

  it('reports failures and ignores garbage', async () => {
    const failing = new Keychain('finance-mcp-test', fakeSecurity([{ code: 0, stderr: 'add-generic-password: returned -25308' }]).exec)
    await expect(failing.save({ userId: 'u', refreshToken: 't' })).rejects.toThrow(/write failed/)
    expect(await new Keychain('x', fakeSecurity([{ code: 0, stdout: 'not base64 json' }]).exec).load()).toBeNull()
    await expect(new Keychain('x', fakeSecurity([{ code: 51, stderr: 'denied' }]).exec).load()).rejects.toThrow(/denied/)
    expect(() => new Keychain('bad name"', fakeSecurity([]).exec)).toThrow(/service/)
  })
})

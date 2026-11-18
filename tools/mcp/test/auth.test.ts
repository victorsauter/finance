// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { FinanceCloudClient } from '../../../src/data/cloud/client.ts'
import { NotSignedInError, login, restoreSession } from '../src/auth.ts'
import type { Keychain, StoredSession } from '../src/keychain.ts'

function memoryKeychain(initial: StoredSession | null) {
  const state = { value: initial, saves: [] as StoredSession[] }
  const keychain = {
    load: async () => state.value,
    save: async (session: StoredSession) => { state.value = session; state.saves.push(session) },
    remove: async () => { const had = state.value !== null; state.value = null; return had },
  } as unknown as Keychain
  return { keychain, state }
}

function session(userId: string, refreshToken: string) {
  return { user: { id: userId }, refresh_token: refreshToken, access_token: 'access' }
}

function fakeClient(options: { refresh?: unknown; verify?: unknown }) {
  const calls: Array<{ name: string; args: unknown }> = []
  let listener: ((event: string, value: unknown) => void) | undefined
  const client = {
    auth: {
      onAuthStateChange: (callback: typeof listener) => { listener = callback },
      refreshSession: async (args: unknown) => { calls.push({ name: 'refresh', args }); return options.refresh },
      signInWithOtp: async (args: unknown) => { calls.push({ name: 'otp', args }); return { error: null } },
      verifyOtp: async (args: unknown) => { calls.push({ name: 'verify', args }); return options.verify },
    },
  } as unknown as FinanceCloudClient
  return { client, calls, emit: (event: string, value: unknown) => listener?.(event, value) }
}

describe('auth', () => {
  it('fails with the login instructions when nothing is stored', async () => {
    const { keychain } = memoryKeychain(null)
    await expect(restoreSession(fakeClient({}).client, keychain)).rejects.toThrow(NotSignedInError)
    await expect(restoreSession(fakeClient({}).client, keychain)).rejects.toThrow(/npm run mcp:login/)
  })

  it('refreshes the stored token and keeps every rotated token', async () => {
    const { keychain, state } = memoryKeychain({ userId: 'u1', refreshToken: 'old' })
    const fake = fakeClient({ refresh: { data: { session: session('u1', 'new') }, error: null } })
    expect(await restoreSession(fake.client, keychain)).toEqual({ userId: 'u1' })
    expect(fake.calls[0]).toEqual({ name: 'refresh', args: { refresh_token: 'old' } })
    expect(state.value).toEqual({ userId: 'u1', refreshToken: 'new' })
    fake.emit('TOKEN_REFRESHED', session('u1', 'newer'))
    await Promise.resolve()
    expect(state.value).toEqual({ userId: 'u1', refreshToken: 'newer' })
  })

  it('rejects an expired session', async () => {
    const { keychain } = memoryKeychain({ userId: 'u1', refreshToken: 'old' })
    const fake = fakeClient({ refresh: { data: { session: null }, error: { message: 'Invalid Refresh Token' } } })
    await expect(restoreSession(fake.client, keychain)).rejects.toThrow(/expired or was revoked.*mcp:login/)
  })

  it('logs in with an email code and never creates a user', async () => {
    const { keychain, state } = memoryKeychain(null)
    const fake = fakeClient({ verify: { data: { session: session('u2', 'r2') }, error: null } })
    const answers = ['owner@example.com', '123 456']
    await login(fake.client, keychain, { ask: async () => answers.shift()! })
    expect(fake.calls[0]).toEqual({ name: 'otp', args: { email: 'owner@example.com', options: { shouldCreateUser: false } } })
    expect(fake.calls[1]).toEqual({ name: 'verify', args: { email: 'owner@example.com', token: '123456', type: 'email' } })
    expect(state.value).toEqual({ userId: 'u2', refreshToken: 'r2' })
  })
})

import { createClient, type Session } from '@supabase/supabase-js'
import type { Database } from '../../../src/data/cloud/database.types.ts'
import type { FinanceCloudClient } from '../../../src/data/cloud/client.ts'
import type { SupabaseConfig } from './config.ts'
import type { Keychain } from './keychain.ts'
import { log } from './log.ts'

export const LOGIN_HINT =
  'Sign in once from a terminal in the repository: npm run mcp:login'

export class NotSignedInError extends Error {}

/**
 * A Node Supabase client with the publishable key. The session lives in
 * memory only (persistSession false); the refresh token is kept in the
 * Keychain by the callers below. Never built with a service-role key.
 */
export function createNodeClient(
  config: SupabaseConfig,
  options: { autoRefreshToken: boolean },
): FinanceCloudClient {
  return createClient<Database>(config.url, config.publishableKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: options.autoRefreshToken,
      detectSessionInUrl: false,
    },
  })
}

function toStored(session: Session) {
  return { userId: session.user.id, refreshToken: session.refresh_token }
}

/**
 * Restores the Keychain session and keeps the rotated refresh token in the
 * Keychain: Supabase issues a new refresh token on every refresh and the old
 * one stops working shortly after.
 */
export async function restoreSession(
  client: FinanceCloudClient,
  keychain: Keychain,
): Promise<{ userId: string }> {
  const stored = await keychain.load()
  if (!stored) throw new NotSignedInError(`No Finance session in the Keychain. ${LOGIN_HINT}`)

  client.auth.onAuthStateChange((event, session) => {
    if ((event === 'TOKEN_REFRESHED' || event === 'SIGNED_IN') && session) {
      // Not awaited: Supabase advises against awaiting inside this callback.
      keychain.save(toStored(session)).catch((error: unknown) =>
        log(`Could not store the refreshed session: ${String(error)}`),
      )
    }
  })

  const { data, error } = await client.auth.refreshSession({ refresh_token: stored.refreshToken })
  if (error || !data.session) {
    throw new NotSignedInError(
      `The stored session has expired or was revoked (${error?.message ?? 'no session'}). ${LOGIN_HINT}`,
    )
  }
  if (data.session.user.id !== stored.userId) {
    throw new NotSignedInError(`The stored session belongs to another account. ${LOGIN_HINT}`)
  }
  await keychain.save(toStored(data.session))
  return { userId: data.session.user.id }
}

export interface Prompter {
  ask(question: string): Promise<string>
}

export async function login(
  client: FinanceCloudClient,
  keychain: Keychain,
  prompter: Prompter,
): Promise<{ userId: string }> {
  const email = (await prompter.ask('Email: ')).trim()
  if (!/^[^\s@]+@[^\s@]+$/.test(email)) throw new Error('That is not an email address.')
  const sent = await client.auth.signInWithOtp({ email, options: { shouldCreateUser: false } })
  if (sent.error) throw new Error(`Could not send the code: ${sent.error.message}`)
  const token = (await prompter.ask('Code from the email: ')).replace(/\s/g, '')
  const verified = await client.auth.verifyOtp({ email, token, type: 'email' })
  if (verified.error || !verified.data.session) {
    throw new Error(`The code was not accepted: ${verified.error?.message ?? 'no session'}`)
  }
  await keychain.save(toStored(verified.data.session))
  return { userId: verified.data.session.user.id }
}

/** Revokes the session server-side when possible, then forgets it locally. */
export async function logout(client: FinanceCloudClient, keychain: Keychain): Promise<boolean> {
  const stored = await keychain.load()
  if (stored) {
    const { data } = await client.auth.refreshSession({ refresh_token: stored.refreshToken })
    if (data.session) await client.auth.signOut({ scope: 'local' })
  }
  return keychain.remove()
}
